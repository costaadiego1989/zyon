export interface BuyerFiscalNavigation {
  orderId: string;
  intentId: string;
  environment: "homologation" | "production";
  document?: "xml" | "danfe";
}
export function readBuyerFiscalNavigation(
  search: string
): BuyerFiscalNavigation | null {
  const p = new URLSearchParams(search),
    orderId = p.get("orderId"),
    intentId = p.get("fiscalIntentId"),
    environment = p.get("fiscalEnvironment"),
    document = p.get("fiscalDocument");
  if (
    p.get("buyerHub") !== "orders" ||
    !orderId ||
    orderId.length > 191 ||
    !intentId ||
    intentId.length > 191 ||
    !["homologation", "production"].includes(environment ?? "") ||
    (document && !["xml", "danfe"].includes(document))
  )
    return null;
  return {
    orderId,
    intentId,
    environment: environment as BuyerFiscalNavigation["environment"],
    ...(document ? { document: document as "xml" | "danfe" } : {}),
  };
}
export function safeFiscalBuyerHref(href: string): string | null {
  if (!/^\/store\/[^/?#]+\?/.test(href) || href.startsWith("//")) return null;
  const url = new URL(href, "https://navigation.invalid");
  if (
    url.hash ||
    !readBuyerFiscalNavigation(url.search) ||
    [...url.searchParams.keys()].some(
      (k) =>
        ![
          "buyerHub",
          "orderId",
          "fiscalIntentId",
          "fiscalEnvironment",
          "fiscalDocument",
        ].includes(k)
    )
  )
    return null;
  return href;
}
export function openFiscalBuyerHref(href: string) {
  const safe = safeFiscalBuyerHref(href);
  if (!safe) return;
  const target = new URL(safe, window.location.origin);
  if (target.pathname !== window.location.pathname) {
    window.location.assign(safe);
    return;
  }
  window.history.pushState(window.history.state, "", safe);
  window.dispatchEvent(new CustomEvent("aacp:open-buyer-hub", { detail: { tab: "orders" } }));
}
