import type { FiscalEnvironment } from "../api/fiscal.js";
import { fiscalDashboardEnvironment } from "../lib/fiscal-environment.js";
export function fiscalHash(
  tab: "fiscal-settings" | "fiscal-invoices" | "fiscal-detail",
  environment: FiscalEnvironment,
  intentId?: string
) {
  const p = new URLSearchParams({ environment: fiscalDashboardEnvironment(environment) });
  if (intentId) p.set("intentId", intentId);
  return `#${tab}?${p}`;
}
export function readFiscalNavigation(hash: string) {
  const p = new URLSearchParams(hash.split("?")[1] ?? "");
  return {
    environment: fiscalDashboardEnvironment(p.get("environment") === "production"
      ? "production"
      : "homologation"),
    intentId: p.get("intentId"),
  };
}
