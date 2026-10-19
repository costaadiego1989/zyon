import { contextualProductQuery, contextualSearchGroups } from "../../../catalog/domain/services/contextual-product-search.js";
import type { ExecutableTool, ToolResult } from "../tools/types.js";
import { allowsSalesDiscovery, countSalesDiscoveryRounds, salesDiscoveryHistory } from "./sales-discovery.js";

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
  history: Array<{ role: "user" | "assistant"; content: string }>, attachmentContext?: string) {
  history = salesDiscoveryHistory(history, userMessage).slice(-10);
  const active = allowsSalesDiscovery(userMessage, attachmentContext);
  let context = countSalesDiscoveryRounds(history) > 0
    ? [...history.filter(item => item.role === "user").slice(-3).map(item => item.content), userMessage].join(". ")
    : userMessage;
  const current = userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  // An explicit change is allowed; a model silently dropping a restriction is
  // not. Anchor consent so "não aceito perfume" never releases "sem perfume".
  const released = current.match(/^(?:(?:agora|na verdade|mudei de ideia)[,\s]+)?(?:pode ser com|pode conter|aceito(?: com)?|prefiro com|quero com)\s+([\p{L}-]+)/u)?.[1];
  if (released) context = context.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(new RegExp(`\\bsem ${released}\\b`, "gi"), "");
  const maxPrice = salesSearchMaxPrice(context);
  const constraints = contextualSearchGroups(context).map(group => group[0]!)
    .filter(term => /^(sem|nao) /.test(term) && !/^(?:nao sei|nao tenho|nao importa|sem preferencia|sem restricao)$/.test(term));
  const profile = context.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ");
  const skinType = [...profile.matchAll(/\bpele (?:e )?(oleosa|seca|mista|normal)\b/g)].at(-1)?.[1];
  const correctedSkinType = skinType && current.match(/^(?:(?:na verdade|corrigindo)[,\s]+)?(?:minha pele (?:e )?)?(oleosa|seca|mista|normal)[.!\s]*$/)?.[1];
  if (skinType) constraints.push(`pele ${correctedSkinType || skinType}`);
  for (const match of profile.matchAll(/\b(?:pele (?:e )?sensivel|cabelos? (?:e )?(?:oleosos?|secos?|mistos?|cacheados?|lisos?|tingidos?))\b/g))
    constraints.push(match[0].replace(" e ", " "));
  let searches = 0;
  let terminal = false;
  let failed = false;
  let hasMatches = false;
  let lastResult: ToolResult | undefined;

  return {
    get terminal() { return terminal; },
    get terminalMessage() { return !terminal || hasMatches ? undefined : failed
      ? "Não consegui concluir a busca com segurança agora. Tente novamente em alguns instantes."
      : "Não encontrei uma correspondência confirmada às suas preferências. Não vou indicar uma opção que ignore o que você pediu."; },
    wrap(tools: ExecutableTool[]): ExecutableTool[] {
      return !active ? tools : tools.map(tool => tool.name !== "search_products" ? tool : {
        name: tool.name, execute: async args => {
          if (searches >= 3) {
            terminal = true;
            return lastResult ?? { ok: false, error: "discovery_search_limit_reached" };
          }
          searches++;
          let query = contextualProductQuery(typeof args.query === "string" ? args.query : "*", context) ?? context;
          const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          const missing = [...new Set(constraints)].filter(term => !normalized.includes(term));
          if (missing.length) query = `${query} ${missing.join(" ")}`;
          const requestedMax = typeof args.maxPrice === "number" && Number.isSafeInteger(args.maxPrice) && args.maxPrice >= 0 ? args.maxPrice : undefined;
          const cap = maxPrice === undefined ? requestedMax : requestedMax === undefined ? maxPrice : Math.min(maxPrice, requestedMax);
          const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.max(1, Math.min(3, Math.floor(args.limit))) : 3;
          const { maxPrice: _modelMaxPrice, ...remainingArgs } = args;
          let result = await tool.execute({ ...remainingArgs, query, limit, ...(cap !== undefined ? { maxPrice: cap } : {}) });
          if (result.ok && result.data && typeof result.data === "object" && "products" in result.data && Array.isArray(result.data.products)) {
            const products = result.data.products.filter(product => cap === undefined
              || (typeof product?.price === "number" && Number.isFinite(product.price) && product.price <= cap)).slice(0, limit);
            // A later empty synonym must not erase confirmed matches from this
            // same turn or make the assistant claim nothing was found.
            if (!products.length && hasMatches && lastResult) return lastResult;
            if (products.length) hasMatches = true;
            result = { ok: true, data: { ...result.data, products, query,
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
