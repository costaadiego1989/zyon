import { createHmac } from "node:crypto";

export function requiredMarketplaceEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error("erp_provider_not_configured");
  return value;
}

export function shopeeApiBase(): string {
  return process.env.SHOPEE_SANDBOX === "true"
    ? "https://openplatform.sandbox.test-stable.shopee.sg"
    : "https://openplatform.shopee.com.br";
}

export function shopeeSignedUrl(path: string, accessToken?: string, shopId?: string, extra: Record<string, string> = {}, timestamp = Math.floor(Date.now() / 1000)): string {
  const partnerId = requiredMarketplaceEnv("SHOPEE_PARTNER_ID");
  const partnerKey = requiredMarketplaceEnv("SHOPEE_PARTNER_KEY");
  if (accessToken && !shopId) throw new Error("erp_shopee_shop_id_missing");
  const base = `${partnerId}${path}${timestamp}${accessToken ?? ""}${shopId ?? ""}`;
  const sign = createHmac("sha256", partnerKey).update(base).digest("hex");
  const params = new URLSearchParams({ ...extra, partner_id: partnerId, timestamp: String(timestamp), sign });
  if (accessToken) params.set("access_token", accessToken);
  if (shopId) params.set("shop_id", shopId);
  return `${shopeeApiBase()}${path}?${params}`;
}

/** TikTok signs exact body bytes, with the secret surrounding path + query + body. */
export function tiktokSignature(path: string, params: Record<string, string>, secret: string, body = ""): string {
  const query = Object.keys(params).filter(key => key !== "sign" && key !== "access_token").sort().map(key => `${key}${params[key]}`).join("");
  return createHmac("sha256", secret).update(`${secret}${path}${query}${body}${secret}`).digest("hex");
}

export async function marketplaceJson(provider: string, url: string, init?: RequestInit): Promise<any> {
  // Provider payloads and request URLs may contain credentials. Only bounded,
  // machine-generated error codes cross the application/log boundary.
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error(`erp_${provider}_request_failed`);
  }
  if (!response.ok) throw new Error(`erp_${provider}_http_${response.status}`);
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error(`erp_${provider}_response_invalid`);
  if (provider === "shopee" && data.error) throw new Error("erp_shopee_api_error");
  if (provider === "tiktokshop" && data.code !== 0) throw new Error("erp_tiktokshop_api_error");
  return data;
}

export function marketplaceQuantity(value: unknown): number {
  if (value === undefined || value === null || value === "") throw new Error("erp_marketplace_stock_missing");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("erp_marketplace_stock_invalid");
  return number;
}

export function marketplacePrice(value: unknown, currency?: string): number | undefined {
  if (currency && currency !== "BRL") return undefined;
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : undefined;
}

export function marketplaceId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("erp_marketplace_id_invalid");
  return id;
}

export function shopeeNumericId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("erp_shopee_id_invalid");
  return id;
}
