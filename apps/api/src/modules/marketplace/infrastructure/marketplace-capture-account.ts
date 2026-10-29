import { createHash } from "node:crypto";
import type { MarketplaceCaptureAccount } from "../../payment/domain/ports/payment-provider.port.js";

/** Local validation shared by creation and capture reconciliation. No network. */
export function marketplaceCaptureAccount(provider: "stripe" | "asaas", environment: "test" | "live",
  key: string | undefined, asaasOrigin?: string): MarketplaceCaptureAccount {
  if (!["stripe", "asaas"].includes(provider) || !["test", "live"].includes(environment) || !key) {
    throw new Error("marketplace_capture_account_not_configured");
  }
  let identity = key;
  if (provider === "stripe") {
    if (!key.startsWith(environment === "test" ? "sk_test_" : "sk_live_")) throw new Error("marketplace_capture_environment_mismatch");
  } else {
    let origin: URL;
    try { origin = new URL(asaasOrigin!); } catch { throw new Error("marketplace_capture_environment_mismatch"); }
    if (origin.protocol !== "https:" || origin.hostname !== (environment === "test" ? "api-sandbox.asaas.com" : "api.asaas.com") ||
        origin.port || origin.username || origin.password || origin.search || origin.hash ||
        !["/", "/v3", "/v3/"].includes(origin.pathname) || !key.startsWith(environment === "test" ? "$aact_hmlg_" : "$aact_prod_")) {
      throw new Error("marketplace_capture_environment_mismatch");
    }
    identity = `${asaasOrigin}\0${key}`;
  }
  return { provider, environment, accountFingerprint: createHash("sha256").update(identity).digest("hex") };
}
