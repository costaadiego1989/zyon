import { createHmac } from "node:crypto";

// Official authentication guide: https://open.shopee.com/developer-guide/20
function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`shopee_configuration_missing:${key}`);
  return value;
}
function baseUrl(key: string, fallback: string, allowed: string[]): string {
  const url = new URL(process.env[key]?.trim() || fallback);
  if (url.protocol !== "https:" || !allowed.includes(url.hostname) || url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.port) throw new Error("shopee_endpoint_invalid");
  return url.origin;
}
export function shopeeShopId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error("shopee_shop_id_missing");
  return id;
}
export function shopeeAuthorizationUrl(state: string): string {
  const partnerKey = required("SHOPEE_PARTNER_KEY");
  // The officially documented legacy flow remains available where the regional /auth host has no DNS.
  if (process.env.SHOPEE_AUTH_MODE === "legacy") {
    const apiBase = baseUrl("SHOPEE_API_BASE_URL", "https://partner.shopeemobile.com", ["partner.shopeemobile.com", "openplatform.sandbox.test-stable.shopee.sg"]);
    const partnerId = required("SHOPEE_PARTNER_ID"), timestamp = Math.floor(Date.now() / 1000), path = "/api/v2/shop/auth_partner";
    const redirect = new URL(required("SHOPEE_REDIRECT_URI"));
    redirect.searchParams.set("state", state);
    const query = new URLSearchParams({ partner_id: partnerId, timestamp: String(timestamp), sign: signShopeeRequest(partnerId, path, timestamp, partnerKey), redirect: redirect.toString() });
    return `${apiBase}${path}?${query}`;
  }
  const base = baseUrl("SHOPEE_AUTH_BASE_URL", "https://open.shopee.com.br", ["open.shopee.com.br", "open.sandbox.test-stable.shopee.com.br"]);
  const params = new URLSearchParams({ partner_id: required("SHOPEE_PARTNER_ID"), auth_type: "seller", redirect_uri: required("SHOPEE_REDIRECT_URI"), response_type: "code", state });
  return `${base}/auth?${params}`;
}
export function signShopeeRequest(partnerId: string, path: string, timestamp: number, partnerKey: string, accessToken = "", shopId = ""): string {
  return createHmac("sha256", partnerKey).update(`${partnerId}${path}${timestamp}${accessToken}${shopId}`).digest("hex");
}
async function request(path: string, params: Record<string, string>, payload?: unknown, accessToken = "", shopId = ""): Promise<any> {
  const partnerId = required("SHOPEE_PARTNER_ID");
  if (!/^[1-9]\d*$/.test(partnerId)) throw new Error("shopee_partner_id_invalid");
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest(partnerId, path, timestamp, required("SHOPEE_PARTNER_KEY"), accessToken, shopId);
  const base = baseUrl("SHOPEE_API_BASE_URL", "https://partner.shopeemobile.com", ["partner.shopeemobile.com", "openplatform.sandbox.test-stable.shopee.sg"]);
  const query = new URLSearchParams({ ...params, partner_id: partnerId, timestamp: String(timestamp), sign, ...(accessToken ? { access_token: accessToken, shop_id: shopId } : {}) });
  let response: Response;
  try {
    response = await fetch(`${base}${path}?${query}`, { method: payload === undefined ? "GET" : "POST", signal: AbortSignal.timeout(20000),
      ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) });
  } catch { throw new Error("shopee_transport_failed"); }
  if (!response.ok) throw new Error(`shopee_http_error:${response.status}`);
  let data: any;
  try { data = await response.json(); } catch { throw new Error("shopee_invalid_response"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("shopee_invalid_response");
  if (data.error) {
    const code = /^[a-zA-Z0-9_.-]{1,80}$/.test(String(data.error)) ? String(data.error) : "unknown";
    throw new Error(`shopee_api_error:${code}`);
  }
  return data;
}
export function requestShopee(accessToken: string, shopId: string, path: string, params: Record<string, string> = {}, payload?: unknown): Promise<any> {
  if (!accessToken) throw new Error("shopee_access_token_missing");
  return request(path, params, payload, accessToken, shopeeShopId(shopId));
}
export interface ShopeeTokens { accessToken: string; refreshToken: string; expiresAt: Date; refreshExpiresAt: Date; }
async function tokens(path: string, shopId: string, params: Record<string, unknown>): Promise<ShopeeTokens> {
  const id = shopeeShopId(shopId);
  const data = await request(path, {}, { ...params, shop_id: Number(id), partner_id: Number(required("SHOPEE_PARTNER_ID")) });
  if (typeof data.access_token !== "string" || !data.access_token || typeof data.refresh_token !== "string" || !data.refresh_token) throw new Error("shopee_token_missing");
  if (!Number.isSafeInteger(data.expire_in) || data.expire_in <= 0) throw new Error("shopee_token_expiry_invalid");
  if (data.shop_id !== undefined && String(data.shop_id) !== id) throw new Error("shopee_token_shop_mismatch");
  if (Array.isArray(data.shop_id_list) && !data.shop_id_list.some((value: unknown) => String(value) === id)) throw new Error("shopee_token_shop_mismatch");
  return { accessToken: data.access_token, refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expire_in * 1000), refreshExpiresAt: new Date(Date.now() + 30 * 86400000) };
}
export function exchangeShopeeCode(code: string, shopId: string): Promise<ShopeeTokens> {
  return tokens("/api/v2/auth/token/get", shopId, { code });
}
export function refreshShopeeToken(refreshToken: string, shopId: string): Promise<ShopeeTokens> {
  return tokens("/api/v2/auth/access_token/get", shopId, { refresh_token: refreshToken });
}
