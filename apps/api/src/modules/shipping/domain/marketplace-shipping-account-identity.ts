import { marketplaceShippingContractHash as hash } from "./marketplace-shipping-contract.js";

/** Native user UUID, never a token, email, CPF or company ID. */
export type MarketplaceShippingAccountIdentity = {
  version: 1; provider: "melhor-envio"; environment: "test" | "live";
  originMerchantId: string; providerUserId: string;
};
export function marketplaceShippingNativeUserId(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) return undefined;
  return value.toLowerCase();
}
export function assertMarketplaceShippingAccountIdentity(value: unknown, input: {
  environment: "test" | "live"; originMerchantId: string; accountFingerprint: string;
}): MarketplaceShippingAccountIdentity {
  const identity = value as MarketplaceShippingAccountIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity) ||
      Object.keys(identity).sort().join(",") !== "environment,originMerchantId,provider,providerUserId,version" ||
      identity.version !== 1 || identity.provider !== "melhor-envio" || identity.environment !== input.environment ||
      !["test", "live"].includes(identity.environment) || typeof identity.originMerchantId !== "string" ||
      !identity.originMerchantId.trim() || identity.originMerchantId !== identity.originMerchantId.trim() || identity.originMerchantId.length > 200 ||
      identity.originMerchantId !== input.originMerchantId || marketplaceShippingNativeUserId(identity.providerUserId) !== identity.providerUserId ||
      hash(identity) !== input.accountFingerprint) throw Error("marketplace_shipment_account_identity_invalid");
  return structuredClone(identity);
}
