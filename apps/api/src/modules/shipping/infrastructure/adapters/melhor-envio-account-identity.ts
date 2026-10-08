import { marketplaceShippingNativeUserId, type MarketplaceShippingAccountIdentity } from "../../domain/marketplace-shipping-account-identity.js";
import { MELHOR_ENVIO_USER_AGENT } from "../melhor-envio-config.js";

/** Fresh native GET /me; no cache, token persistence or personal profile logs.
 * This observation does not certify wallet debits, cancellation credits or fees. */
export async function readMelhorEnvioAccountIdentity(input: {
  base: string; token: string; originMerchantId: string;
}, transport: typeof fetch = fetch): Promise<MarketplaceShippingAccountIdentity> {
  const environment = input.base === "https://sandbox.melhorenvio.com.br" ? "test" :
    input.base === "https://melhorenvio.com.br" ? "live" : undefined;
  if (!environment || !input.token?.trim() || !input.originMerchantId?.trim()) throw Error("marketplace_shipment_account_identity_unavailable");
  const response = await transport(`${input.base}/api/v2/me`, { method: "GET", redirect: "error",
    headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json", "User-Agent": MELHOR_ENVIO_USER_AGENT },
    signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error("marketplace_shipment_account_identity_unavailable");
  const profile: unknown = await response.json();
  const providerUserId = profile && typeof profile === "object" && !Array.isArray(profile) ?
    marketplaceShippingNativeUserId((profile as Record<string, unknown>).id) : undefined;
  if (!providerUserId) throw Error("marketplace_shipment_account_identity_unavailable");
  return { version: 1, provider: "melhor-envio", environment, originMerchantId: input.originMerchantId, providerUserId };
}
