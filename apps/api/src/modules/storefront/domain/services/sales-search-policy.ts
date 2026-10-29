import { contextualProductQuery, contextualSearchGroups } from "../../../catalog/domain/services/contextual-product-search.js";
import type { ExecutableTool, ToolResult } from "../tools/types.js";
import { allowsSalesDiscovery } from "./sales-discovery.js";
import { normalizeSalesText, recommendationIntent, salesRecommendationContext, similarRecommendationMessage, similarRecommendationQuery } from "./sales-recommendation-intent.js";

export function salesSearchMaxPrice(text: string): number | undefined {
  const budget = [...text.matchAll(/(?:at[eé]|m[aá]ximo(?: de)?|or[çc]amento(?: de)?|limite(?: de)?)\s*(?:R\$\s*)?(\d+(?:[.,]\d+)*)/gi)].at(-1)?.[1];
  const amount = budget?.includes(",") ? budget.replace(/\./g, "").replace(",", ".")
    : budget && /^\d{1,3}(?:\.\d{3})+$/.test(budget) ? budget.replace(/\./g, "") : budget;
  const cents = amount ? Math.round(Number(amount) * 100) : undefined;
  return cents !== undefined && Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

/** Bounded recommendation lookups, not navigation or commerce admission.
 * The model may change synonyms, never the buyer's budget/negative constraints.
 * Counter/results are request-local and shared by primary/fallback providers. */
export function createSalesSearchPolicy(userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>, attachmentContext?: string, discoveryEnabled = true) {
  const active = discoveryEnabled && allowsSalesDiscovery(userMessage, attachmentContext);
  let context = salesRecommendationContext(userMessage, history);
  const current = userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  // An explicit change is allowed; a model silently dropping a restriction is
  // not. Anchor consent so "não aceito perfume" never releases "sem perfume".
  const released = current.match(/^(?:(?:agora|na verdade|mudei de ideia)[,\s]+)?(?:pode ser com|pode conter|aceito(?: com)?|prefiro com|quero com)\s+([\p{L}-]+)/u)?.[1];
  if (released) context = context.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(new RegExp(`\\bsem ${released}\\b`, "gi"), "");
  const maxPrice = salesSearchMaxPrice(context);
  // Preserve the explicitly requested purpose across synonym searches too.
  // Product cards must not include another care step merely because it shares
  // the same brand. Hydration has a stable published lexical family.
  const intent = recommendationIntent(context);
  const hydrationRequired = intent.hydrationRequired;
  const constraints = [...intent.negatives];
  const profile = context.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ");
  const skinType = intent.profile;
  const correctedSkinType = skinType && current.match(/^(?:(?:na verdade|corrigindo)[,\s]+)?(?:minha pele (?:e )?)?(oleosa|seca|mista|normal)[.!\s]*$/)?.[1];
  if (skinType) constraints.push(`pele ${correctedSkinType || skinType}`);
  for (const match of profile.matchAll(/\b(?:pele (?:e )?sensivel|cabelos? (?:e )?(?:oleosos?|secos?|mistos?|cacheados?|lisos?|tingidos?))\b/g))
    constraints.push(match[0].replace(" e ", " "));
  let searches = 0;
  let terminal = false;
  let failed = false;
  let hasMatches = false;
  let lastResult: ToolResult | undefined;
  let relatedLabels: string[] | undefined;

  return {
    // Similar results already have an authoritative disclosure. Do not pay for
    // another model response that would immediately be replaced by that text.
    get terminal() { return terminal || !!relatedLabels; },
    get recommendationMessage() { return relatedLabels ? similarRecommendationMessage(relatedLabels) : undefined; },
    get terminalMessage() { return !terminal || hasMatches ? undefined : failed
      ? "Não consegui concluir a busca com segurança agora. Tente novamente em alguns instantes."
      : "Não encontrei uma correspondência confirmada, nem alternativas relacionadas que preservem suas exigências. Podemos tentar outro produto sem mudar seu orçamento ou suas restrições."; },
    wrap(tools: ExecutableTool[]): ExecutableTool[] {
      return !active ? tools : tools.map(tool => tool.name !== "search_products" ? {
        name: tool.name, execute: async args => relatedLabels
          && ["add_item_to_cart", "update_cart_item", "remove_cart_item", "clear_cart", "apply_coupon", "remove_coupon", "create_checkout_session"].includes(tool.name)
          ? { ok: false, error: "similar_product_requires_confirmation" } : tool.execute(args),
      } : {
        name: tool.name, execute: async args => {
          // A typed general criteria plan already separates product purpose,
          // hard requirements and preferences. Do not concatenate them back
          // into the lexical query or relax them in synonym searches.
          if (args.criteria !== undefined) return tool.execute(args);
          if (relatedLabels && lastResult) return lastResult;
          if (searches >= 3) {
            terminal = true;
            return lastResult ?? { ok: false, error: "discovery_search_limit_reached" };
          }
          let query = contextualProductQuery(typeof args.query === "string" ? args.query : "*", context) ?? context;
          query = query.replace(/(?:at[eé]|m[aá]ximo(?: de)?|or[çc]amento(?: de)?|limite(?: de)?)\s*(?:R\$\s*)?\d+(?:[.,]\d+)*(?:\s*reais)?/gi, "");
          const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          const missing = [...new Set(constraints)].filter(term => !normalized.includes(term));
          if (missing.length) query = `${query} ${missing.join(" ")}`;
          if (hydrationRequired && !/hidrat/.test(normalized)) query = `${query} hidratação`;
          // The model may select synonyms, but must retain the product family
          // and intended use when broadening (running shoes are not casual shoes).
          for (const anchor of intent.anchors) {
            const variants = contextualSearchGroups(anchor)[0] ?? [normalizeSalesText(anchor)];
            if (!variants.some(term => normalizeSalesText(query).includes(term))) query += ` ${anchor}`;
          }
          // Optional attributes are tried exactly first, even if the model
          // omitted them. Only a later, disclosed alternative can relax them.
          for (const preference of intent.soft) if (!normalizeSalesText(query).includes(preference.exact)) query += ` ${preference.exact}`;
          const requestedMax = typeof args.maxPrice === "number" && Number.isSafeInteger(args.maxPrice) && args.maxPrice >= 0 ? args.maxPrice : undefined;
          const cap = maxPrice ?? requestedMax;
          const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.max(1, Math.min(3, Math.floor(args.limit))) : 3;
          const { maxPrice: _modelMaxPrice, ...remainingArgs } = args;
          const lookup = async (searchQuery: string): Promise<ToolResult> => {
            searches++;
            return tool.execute({ ...remainingArgs, query: searchQuery, inStockOnly: true, limit, ...(cap !== undefined ? { maxPrice: cap } : {}) });
          };
          let result = await lookup(query);
          let matchedAsRelated = false;
          const filterProducts = (value: ToolResult) => value.ok && value.data && typeof value.data === "object" && "products" in value.data && Array.isArray(value.data.products)
            ? value.data.products.filter(product => product?.inStock !== false && (cap === undefined
              || (typeof product?.price === "number" && Number.isFinite(product.price) && product.price <= cap))
              && (!intent.skin || !/\b(cabel\w*|capilar)\b/.test(normalizeSalesText(`${product?.name ?? ""} ${product?.description ?? ""}`))
                || /\b(facial|rosto|skincare)\b/.test(normalizeSalesText(`${product?.name ?? ""} ${product?.description ?? ""}`)))
              && (!hydrationRequired || /hidrat/i.test(`${product?.name ?? ""} ${product?.description ?? ""}`))).slice(0, limit) : undefined;
          // Do not depend on another paid model turn to recover from a strict
          // zero-match. This is the same shared three-lookup budget, not extra
          // requests per provider. Errors never mean an exact match is absent.
          if (!hasMatches && filterProducts(result)?.length === 0 && searches < 3) {
            const related = similarRecommendationQuery(query, intent);
            if (related) {
              query = related;
              result = await lookup(query);
              matchedAsRelated = !!filterProducts(result)?.length;
            }
          }
          if (result.ok && result.data && typeof result.data === "object" && "products" in result.data && Array.isArray(result.data.products)) {
            const products = filterProducts(result)!;
            // A later empty synonym must not erase confirmed matches from this
            // same turn or make the assistant claim nothing was found.
            if (!products.length && hasMatches && lastResult) return lastResult;
            if (products.length) hasMatches = true;
            if (matchedAsRelated) relatedLabels = intent.soft.map(item => item.label);
            result = { ok: true, data: { ...result.data, products, query,
              ...(relatedLabels ? { recommendationMatch: { type: "similar", unconfirmedPreferences: relatedLabels },
                note: similarRecommendationMessage(relatedLabels) } : {}),
              discoverySearchScope: "Consulta contextual, não é uma listagem de todo o catálogo. Mantenha as restrições do comprador." } };
            if (searches >= 3 && !hasMatches) terminal = true;
          } else {
            failed = true;
            if (searches >= 3) terminal = true;
            if (hasMatches && lastResult) return lastResult;
          }
          lastResult = result;
          return result;
        },
      });
    },
  };
}
