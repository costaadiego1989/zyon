import type { ShoppingSearchPlan } from "../../domain/contracts/shopping-search-plan.schemas.js";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function shoppingSearchEvidence(plan: ShoppingSearchPlan, count: number) {
  const preferences = plan.attributes.filter(item => item.priority === "preferred")
    .map(item => `${item.name}: ${item.operator === "not_equals" ? "diferente de " : ""}${item.value}`);
  const common = { version: 1 as const, appliedPlan: plan, unconfirmedPreferences: preferences };
  if (plan.unsupportedCriteria.length) return { ...common, status: "unsupported" as const,
    message: `🔎 Ainda não consigo verificar estes critérios no catálogo: ${plan.unsupportedCriteria.join(", ")}. Não vou apresentar opções como se atendessem a essas exigências. Podemos ajustar a busca?` };
  if (plan.delivery) return { ...common, status: plan.delivery.zipCode ? "unsupported" as const : "needs_information" as const,
    message: plan.delivery.zipCode
      ? "🚚 Ainda não consigo verificar frete por produto nesta busca. A cotação real está disponível para os itens escolhidos no carrinho; não confirmei frete grátis, limite de custo nem prazo para os produtos do catálogo."
      : "📍 Para conferir uma exigência de frete, preciso do CEP de destino. A busca de frete por produto ainda não está disponível; não vou afirmar que algum item atende sem uma cotação real." };
  const filters = [
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
  return { ...common, status: "verified" as const, message };
}
