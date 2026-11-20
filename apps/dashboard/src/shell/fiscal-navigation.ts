import type { FiscalEnvironment } from "../api/fiscal.js";
export function fiscalHash(
  tab: "fiscal-settings" | "fiscal-invoices" | "fiscal-detail",
  environment: FiscalEnvironment,
  intentId?: string
) {
  const p = new URLSearchParams({ environment });
  if (intentId) p.set("intentId", intentId);
  return `#${tab}?${p}`;
}
export function readFiscalNavigation(hash: string) {
  const p = new URLSearchParams(hash.split("?")[1] ?? "");
  return {
    environment: (p.get("environment") === "production"
      ? "production"
      : "homologation") as FiscalEnvironment,
    intentId: p.get("intentId"),
  };
}
