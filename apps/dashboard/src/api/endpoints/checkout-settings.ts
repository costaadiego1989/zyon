import { dashboardFetch, dashboardJson } from "../http/client.js";
import { reportError } from "../../lib/observability/error-reporter.js";
import type { CheckoutSettings, CheckoutSettingsPatch } from "../types.js";

export function checkoutSettingsEndpoints(base: string, f: typeof fetch) {
  return {
    getCheckoutSettings(): Promise<CheckoutSettings> {
      return dashboardJson(base, "/checkout-settings", { method: "GET" }, f);
    },

    async patchCheckoutSettings(patch: CheckoutSettingsPatch): Promise<CheckoutSettings> {
      let ifMatchValue = "*";
      try {
        const getRes = await dashboardFetch(base, "/checkout-settings", { method: "GET" }, f);
        const etag = getRes.headers.get("etag");
        if (etag) ifMatchValue = etag;
      } catch (err) {
        // Best-effort ETag lookup; PUT will still run with "If-Match: *".
        reportError({ source: "checkout-settings.patch.etag", error: err, severity: "warning" });
      }
      return dashboardJson(base, "/checkout-settings", {
        method: "PUT",
        headers: { "If-Match": ifMatchValue },
        jsonBody: patch,
      }, f);
    },
  };
}
