import type { FiscalEnvironment } from "../api/fiscal.js";

/** Published dashboards always operate on real sales; local fixtures retain homologation. */
export function fiscalDashboardEnvironment(requested: FiscalEnvironment): FiscalEnvironment {
  return import.meta.env.PROD ? "production" : requested;
}
