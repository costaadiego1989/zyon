import { dashboardFetch, dashboardJson } from "../http/client.js";
import { reportError } from "../../lib/observability/error-reporter.js";
import type { CheckoutSettings, CheckoutSettingsPatch } from "../types.js";

export function checkoutSettingsEndpoints(base: string, f: typeof fetch) {
  return {
    getCheckoutSettings(): Promise<CheckoutSettings> {
      return dashboardJson(base, "/checkout-settings", { method: "GET", cache: "no-store" }, f);
    },

    async patchCheckoutSettings(patch: CheckoutSettingsPatch): Promise<CheckoutSettings> {
      let ifMatchValue = "*";
      try {
        // This read is the concurrency baseline for the following PUT. It must
        // never be satisfied from a browser cache, otherwise a stale ETag
        // produces a 412 even when the merchant is the only editor.
        const getRes = await dashboardFetch(
          base,
          "/checkout-settings",
          { method: "GET", cache: "no-store" },
          f,
        );
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
