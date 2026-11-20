/** Navigation only. The BuyerHub must authenticate and authorize each API request. */
export function fiscalBuyerLink(slug: string, orderId: string, intentId: string, kind?: "xml" | "danfe", environment?: "homologation" | "production"): string {
  if (!slug?.trim() || !orderId?.trim() || !intentId?.trim()) throw new Error("fiscal_portal_context_unavailable");
  const query = new URLSearchParams({ buyerHub: "orders", orderId, fiscalIntentId: intentId });
  if (kind) query.set("fiscalDocument", kind);
  if (environment) query.set("fiscalEnvironment", environment);
  return `/store/${encodeURIComponent(slug)}?${query}`;
}
