import type { ShoppingSearchPlan, ShoppingSearchEvidence } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { normalizeShoppingFact } from "../../domain/services/shopping-recovery.js";
import { validateStorefrontMessage } from "../../domain/tools/safety-validator.js";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function shoppingSearchEvidence(plan: ShoppingSearchPlan, count: number): ShoppingSearchEvidence {
  const preferences = plan.attributes.filter(item => item.priority === "preferred")
    .map(item => `${item.name}: ${item.operator === "not_equals" ? "diferente de " : ""}${item.value}`);
  const common = { version: 1 as const, appliedPlan: plan, unconfirmedPreferences: preferences };
  const safeCopy = (message: string, fallback: string) => validateStorefrontMessage(message).safe ? message : fallback;
  if (plan.unsupportedCriteria.length) return { ...common, status: "unsupported" as const,
    message: safeCopy(`🔎 Ainda não consigo verificar estes critérios no catálogo: ${plan.unsupportedCriteria.join(", ")}. Não vou apresentar opções como se atendessem a essas exigências. Podemos ajustar a busca?`,
      "🔎 Não consigo comprovar todos os critérios solicitados nesta busca. Não apresentei produtos como se atendessem a essas exigências. Podemos ajustar os critérios?") };
  if (plan.delivery) return { ...common, status: plan.delivery.zipCode ? "unsupported" as const : "needs_information" as const,
    message: plan.delivery.zipCode
      ? "🚚 Ainda não consigo verificar frete por produto nesta busca. A cotação real está disponível para os itens escolhidos no carrinho; nenhuma condição de custo ou prazo foi confirmada para os produtos do catálogo."
      : "📍 Para conferir uma exigência de frete, preciso do CEP de destino. A busca de frete por produto ainda não está disponível; não vou afirmar que algum item atende sem uma cotação real." };
  const filters = [
    plan.discountOnly === true ? "promoção automática vigente e aplicada, com redução de preço confirmada" : undefined,
    plan.minPriceCents !== undefined && plan.maxPriceCents !== undefined
      ? `preço de ${money(plan.minPriceCents)} a ${money(plan.maxPriceCents)}`
      : plan.minPriceCents !== undefined ? `preço a partir de ${money(plan.minPriceCents)}`
        : plan.maxPriceCents !== undefined ? `preço até ${money(plan.maxPriceCents)}` : undefined,
    plan.minRating !== undefined ? `avaliação pública aprovada de ${plan.minRating} estrelas ou mais` : undefined,
    ...plan.attributes.filter(item => item.priority === "required").map(item => `${item.name}: ${item.operator === "not_equals" ? "diferente de " : ""}${item.value}`),
  ].filter(Boolean);
  const sort = { price_asc: "menor preço primeiro", price_desc: "maior preço primeiro", rating: "melhor avaliação primeiro", newest: "mais recentes primeiro" };
  let message = count
    ? `🔎 Encontrei ${count} ${count === 1 ? "opção disponível" : "opções disponíveis"} nesta página${filters.length ? ` com ${filters.join("; ")}` : " no catálogo da loja"}.`
    : `🔎 Não encontrei produtos disponíveis${filters.length ? ` com ${filters.join("; ")}` : " para essa consulta"}.`;
  if (plan.minRating !== undefined && !count) message += " Produtos sem avaliações aprovadas não comprovam a nota mínima.";
  if (plan.sortBy) message += `\n📋 Ordem: ${sort[plan.sortBy]}.`;
  if (preferences.length) message += `\nℹ️ Preferências ainda não confirmadas: ${preferences.join("; ")}.`;
  if (!count) message += " Podemos ajustar os critérios?";
  const fallback = count
    ? `🔎 Encontrei ${count} opções disponíveis que atendem aos requisitos verificados nesta página.${preferences.length ? " Suas preferências ainda não foram confirmadas." : ""}`
    : "🔎 Não encontrei produtos disponíveis com os requisitos solicitados. Podemos ajustar os critérios?";
  return { ...common, status: "verified" as const, message: safeCopy(message, fallback) };
}

/** Public evidence only. This copy is projected directly, so a second model
 * cannot reclassify a similar item or waive the original buyer requirements. */
export function shoppingRecoveryEvidence(plan: ShoppingSearchPlan, products: Array<{ id: string; name: string;
  variants?: Array<{ attributes?: Record<string, string> }> }>, matchType: NonNullable<ShoppingSearchEvidence["matchType"]>): ShoppingSearchEvidence {
  const evidence = shoppingSearchEvidence(plan, products.length);
  evidence.matchType = matchType;
  if (matchType === "incomplete") {
    evidence.message = "🔎 A consulta ficou incompleta. Ainda não posso confirmar se existe uma opção que atenda a todos os critérios. Prefere refinar o nome ou os requisitos da busca?";
    return evidence;
  }
  if (matchType === "no_match") {
    const mandatory = plan.attributes.filter(a => a.priority === "required" || a.operator === "not_equals");
    const condition = mandatory[0];
    const question = condition
      ? `Você aceita flexibilizar ${condition.name}: ${condition.operator === "not_equals" ? "diferente de " : ""}${condition.value}${plan.maxPriceCents !== undefined ? `, mantendo o limite de ${money(plan.maxPriceCents)}` : ""}?`
      : plan.maxPriceCents !== undefined ? `Você prefere manter o limite de ${money(plan.maxPriceCents)} e procurar outra família de produtos, ou autoriza rever esse limite?`
        : "Você prefere informar outro nome ou rever alguma característica do produto?";
    evidence.message = `🔎 Não confirmei uma opção disponível com todos os requisitos nesta consulta.\n💬 ${question}`;
  } else if (matchType === "similar") {
    const preferred = plan.attributes.filter(a => a.priority === "preferred" && a.operator === "equals");
    evidence.differences = products.slice(0, 3).map(p => {
      const attributes = p.variants?.[0]?.attributes ?? {};
      const details = plan.recovery!.optionalQueryTerms.length
        ? [`Nome/modelo solicitado: ${plan.recovery!.optionalQueryTerms.join(", ")}; alternativa publicada: ${p.name.slice(0, 160)}.`] : [];
      for (const a of preferred) {
        const actual = Object.entries(attributes).find(([key]) => normalizeShoppingFact(key) === normalizeShoppingFact(a.name))?.[1];
        if (actual === undefined) details.push(`${a.name}: preferência ${a.value} não confirmada nesta variante.`);
        else if (normalizeShoppingFact(actual) !== normalizeShoppingFact(a.value)) details.push(`${a.name}: ${actual}; preferência solicitada: ${a.value}.`);
      }
      return { productId: p.id, details: details.map(detail => detail.slice(0, 400)) };
    });
    const lines = products.slice(0, 3).map((p, i) => `• *${p.name.slice(0, 100)}*: ${evidence.differences![i]!.details.slice(0, 4).map(detail => detail.slice(0, 180)).join(" ") || "Opção da mesma família publicada no catálogo."}`);
    evidence.message = `🔎 Não confirmei uma correspondência exata com todos os critérios. Estas são *alternativas semelhantes*, com os requisitos obrigatórios e preços atuais verificados.\n${lines.join("\n")}\n💬 Qual opção você quer conhecer em detalhes ou comparar?`;
  } else {
    // All positive preferences were requirements in this exact phase and were
    // checked on the selected, canonically priced variant.
    const exact = shoppingSearchEvidence({ ...plan, attributes: plan.attributes.map(a => ({ ...a, priority: "required" })) }, products.length);
    evidence.unconfirmedPreferences = [];
    evidence.message = `${exact.message}\n💬 Quer ver os detalhes ou comparar as opções?`;
  }
  if (!validateStorefrontMessage(evidence.message).safe) evidence.message = matchType === "similar"
    ? "🔎 Encontrei alternativas semelhantes com preço e requisitos obrigatórios verificados. Há diferenças em relação ao pedido original. Quer conferir os detalhes antes de escolher?"
    : "🔎 A consulta foi concluída. Quer rever os critérios ou consultar os detalhes das opções verificadas?";
  return evidence;
}
