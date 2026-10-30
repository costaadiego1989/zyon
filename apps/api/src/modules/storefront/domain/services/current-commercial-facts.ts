import { storefrontToolOutputSchemas } from "../contracts/storefront-tool-output.schemas.js";

const readTools = new Set(["list_promotions", "get_daily_deals", "get_product_details", "get_product_availability", "get_store_policies"]);
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const publicText = (value: string, limit: number) => value.replace(/[\r\n\t]+/g, " ").trim().slice(0, limit);

export interface CurrentCommercialFactsInput {
  intent: string;
  requiresTool: boolean;
  productDiscovery: boolean;
  hasWriteAttempt: boolean;
  toolsUsed: readonly string[];
  toolResults: Record<string, unknown>;
  allowStackDiscountAndFreeShipping?: boolean;
  now: Date;
}

/** Project current public facts after failed narration; never repair model text.
 * Both mandatory reads must be confirmed in this turn. A failed/unknown read or
 * any write attempt keeps the original limitation/outcome authoritative.
 */
export function buildCurrentCommercialFacts(input: CurrentCommercialFactsInput): string | undefined {
  try {
    if (input.intent !== "NEGOTIATE_PRICE" || input.requiresTool !== true || input.productDiscovery !== false
      || input.hasWriteAttempt !== false || !Number.isFinite(input.now.getTime())
      || !input.toolsUsed.includes("list_promotions") || !input.toolsUsed.includes("get_daily_deals")) return undefined;
    for (const name of input.toolsUsed) {
      if (!readTools.has(name)) return undefined;
      const value = input.toolResults[name];
      if (!value || typeof value !== "object" || Array.isArray(value) || "error" in value
        || "ok" in value && value.ok === false || "success" in value && value.success === false) return undefined;
      if (!storefrontToolOutputSchemas[name as keyof typeof storefrontToolOutputSchemas].safeParse(value).success) return undefined;
    }
    const promotions = storefrontToolOutputSchemas.list_promotions.parse(input.toolResults.list_promotions);
    const deals = storefrontToolOutputSchemas.get_daily_deals.parse(input.toolResults.get_daily_deals);
    const currentDeals = deals.deals.filter(deal => Number.isSafeInteger(deal.price)
      && (!deal.expiresAt || Date.parse(deal.expiresAt) > input.now.getTime()));
    const lines = ["📋 *Condições consultadas*"];
    if (currentDeals.length) {
      for (const deal of currentDeals.slice(0, 3)) {
        const reference = deal.originalPrice !== undefined && Number.isSafeInteger(deal.originalPrice)
          && deal.originalPrice > deal.price ? ` (referência: ${currency.format(deal.originalPrice / 100)})` : "";
        lines.push(`• *${publicText(deal.name, 160)}*: ${currency.format(deal.price / 100)}${reference}`);
        if (deal.expiresAt && deal.expiresAtFormatted) lines.push(`  🕒 ${publicText(deal.expiresAtFormatted, 140)}`);
      }
    } else lines.push("Esta consulta não retornou oferta com preço confirmado e validade vigente.");
    // A public coupon or progressive ceiling does not establish buyer eligibility.
    // Do not turn their descriptions/limits into a granted discount or freight.
    const couponCount = promotions.coupons.filter(coupon => !coupon.expiresAt
      || Number.isFinite(Date.parse(coupon.expiresAt)) && Date.parse(coupon.expiresAt) > input.now.getTime()).length;
    if (couponCount) lines.push(`🎟️ ${couponCount} cupom(ns) publicado(s) nesta consulta; a elegibilidade depende do carrinho.`);
    lines.push(input.allowStackDiscountAndFreeShipping === false
      ? "⚖️ A regra atual da loja não permite acumular desconto e isenção de frete."
      : "⚖️ Esta consulta não confirma a elegibilidade conjunta dos benefícios.");
    lines.push("_A elegibilidade é conferida no checkout. Esta consulta não aplica benefícios nem altera seu carrinho._",
      "_Seleção limitada às condições retornadas; pode haver outras opções no catálogo._");
    return lines.join("\n\n");
  } catch { return undefined; }
}
