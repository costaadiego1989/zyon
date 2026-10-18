export type AiCostFilters = Record<string, string>;
export type AiCostMoney = { currency: string; costMicros: string; textCostMicros: string; voiceCostMicros: string; audioCostMicros: string; estimatedMicros: string; providerReportedMicros: string; reconciledMicros: string };
export type AiCostTotals = { calls: string; inputTokens: string; outputTokens: string; voiceSessions: string; pending: string; unpriced: string; rejected: string };
export type AiCostCompany = AiCostTotals & { id: string; name: string | null; stores: string; costs: AiCostMoney[] };
export type AiCostsReport = {
  period: { from: string; to: string; endExclusive: true; timezone: string }; generatedAt: string;
  summary: AiCostTotals & { costs: AiCostMoney[] }; companies: AiCostCompany[]; companiesTotal: string; page: number; limit: number;
  daily: Array<AiCostMoney & { day: string }>;
  breakdown: Array<AiCostTotals & AiCostMoney & { source: string; provider: string; model: string }>;
  coverage: { incompleteVoiceSessions: string };
};
export type AiCostEvent = { id: string; at: string; merchantId: string; merchantName: string | null; accountId: string | null; source: string; provider: string; model: string; requestedModel: string | null;
  channel: string; component: string; costCenter: string; payer: string; status: string; usageKnown: boolean; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  inputDetails: Record<string, number> | null; outputDetails: Record<string,number> | null; costMicros: string | null; audioCostMicros: string | null; currency: string | null; costStatus: string; pricingVersion: string | null;
  conversationId: string | null; voiceSessionId: string | null; providerEventId: string | null; measurementOrigin: string; latencyMs: number };
export type AiCostEvents = { items: AiCostEvent[]; nextCursor: string | null };
export const aiSourceLabels: Record<string,string> = {
  storefront_nudge: "Sugestão na loja", checkout_strategy: "Experimento do checkout",
  storefront_agent: "Conversa da loja", checkout_chat: "Chat do checkout", checkout_agent: "Agente do checkout", checkout_conversation: "Conversa do checkout", buyer_support: "Suporte ao comprador",
  product_seo: "SEO de produto", store_seo: "SEO da loja", catalog_generation: "Geração de catálogo", merchant_generation: "Conteúdo da empresa", revenue_hypothesis: "Revenue Manager",
  post_sale_copy: "Texto de pós-venda", catalog_embedding: "Busca e indexação", storefront_image: "Leitura de imagem", storefront_gateway: "Gateway da loja", voice_checkout: "Compra por voz", voice_narration: "Narração de produto",
};
export function money(micros: string | null | undefined, currency = "USD"): string {
  if (micros == null) return "Sem valor";
  try {
    const n=BigInt(micros),whole=n/1000000n,part=(n%1000000n).toString().padStart(6,"0");
    const fraction=part.replace(/0+$/,"").padEnd(2,"0");
    return `${currency === "USD" ? "US$" : currency === "BRL" ? "R$" : currency} ${new Intl.NumberFormat("pt-BR").format(whole)},${fraction}`;
  } catch { return "Indisponível"; }
}
export function integer(value: string | number | null | undefined) { if(value==null)return "—"; try { return new Intl.NumberFormat("pt-BR").format(BigInt(value)); } catch {return "—";} }
