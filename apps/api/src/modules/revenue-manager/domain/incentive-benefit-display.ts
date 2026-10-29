import type { StrategyIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

const reais = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const percent = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

/** Describe only the benefit actually granted by the financial authority. */
export function incentiveBenefitDisplay(recommendation: StrategyIncentiveRecommendation, amountCents: number, stage?: 0 | 1) {
  if (recommendation.status !== "recommended" || !Number.isSafeInteger(amountCents) || amountCents <= 0
    || amountCents > recommendation.test.maxDiscountCents) throw new Error("INVALID_INCENTIVE_DISPLAY");
  const test = recommendation.test;
  const currentStage = stage === undefined ? undefined : test.stages?.[stage];
  if (stage !== undefined && (!currentStage || amountCents > currentStage.maxDiscountCents)) throw new Error("INVALID_INCENTIVE_DISPLAY");
  const applied = `${reais(amountCents)} aplicados nesta compra.`;
  const coupon = test.delivery?.mode === "coupon_code";
  if (test.kind === "capped_progressive_discount") {
    if (!currentStage) throw new Error("INVALID_INCENTIVE_DISPLAY");
    return { title: "Desconto progressivo aplicado", message: `Etapa ${stage! + 1} de 2: ${percent(currentStage.discountPercent)}% de desconto, limitado a ${reais(currentStage.maxDiscountCents)} nesta etapa. ${applied}` };
  }
  if (test.kind === "capped_shipping_discount") return {
    title: "Desconto no frete aplicado",
    message: `${reais(amountCents)} de desconto no frete, abatidos uma vez do total deste pedido. Limite de ${reais(test.maxDiscountCents)} por pedido.`,
  };
  return { title: coupon ? "Cupom personalizado aplicado" : "Desconto aplicado", message: test.kind === "capped_percentage_discount"
    ? `${percent(test.discountPercent)}% de desconto, limitado a ${reais(test.maxDiscountCents)} por pedido. ${applied}`
    : `${applied} Limite de ${reais(test.maxDiscountCents)} por pedido.` };
}
