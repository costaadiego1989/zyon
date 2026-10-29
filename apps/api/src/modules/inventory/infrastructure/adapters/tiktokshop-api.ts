import { createHmac } from "node:crypto";

const API_BASE = "https://open-api.tiktokglobalshop.com";
const AUTH_BASE = "https://auth.tiktok-shops.com/api/v2/token";

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`tiktokshop_configuration_missing:${key}`);
  return value;
}

export function tiktokShopAuthorizationUrl(state: string): string {
  const query = new URLSearchParams({ service_id: requiredEnv("TIKTOKSHOP_SERVICE_ID"), state });
  return `https://services.tiktokshop.com/open/authorize?${query}`;
}

// https://partner.tiktokshop.com/docv2/page/sign-your-api-request
export function signTikTokShopRequest(path: string, params: Record<string, string>, secret: string, body = ""): string {
  const query = Object.keys(params).filter(key => key !== "sign" && key !== "access_token").sort()
    .map(key => `${key}${params[key]}`).join("");
  return createHmac("sha256", secret).update(`${secret}${path}${query}${body}${secret}`).digest("hex");
}

async function fetchEnvelope<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  } catch {
    // Token URLs contain the app secret. Never propagate a transport error's URL.
    throw new Error("tiktokshop_transport_failed");
  }
  if (!response.ok) throw new Error(`tiktokshop_http_error:${response.status}`);
  let envelope: { code?: number; data?: T };
  try { envelope = await response.json(); } catch { throw new Error("tiktokshop_invalid_response"); }
  if (!envelope || typeof envelope !== "object") throw new Error("tiktokshop_invalid_response");
  if (envelope.code !== 0) {
    const code = Number.isInteger(envelope.code) ? String(envelope.code) : "unknown";
    throw new Error(`tiktokshop_api_error:${code}`);
  }
  if (!envelope.data || typeof envelope.data !== "object") throw new Error("tiktokshop_invalid_response");
  return envelope.data;
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  access_token_expire_in: number;
  refresh_token_expire_in: number;
  user_type: number;
}

export interface TikTokShopTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

async function getTokens(endpoint: "get" | "refresh", params: Record<string, string>): Promise<TikTokShopTokens> {
  const query = new URLSearchParams({ app_key: requiredEnv("TIKTOKSHOP_APP_KEY"), app_secret: requiredEnv("TIKTOKSHOP_APP_SECRET"), ...params });
  const data = await fetchEnvelope<TokenData>(`${AUTH_BASE}/${endpoint}?${query}`, { method: "GET" });
  if (data.user_type !== 0) throw new Error("tiktokshop_seller_token_required");
  if (typeof data.access_token !== "string" || !data.access_token || typeof data.refresh_token !== "string" || !data.refresh_token) {
    throw new Error("tiktokshop_token_missing");
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(data.access_token_expire_in) || data.access_token_expire_in <= now ||
      !Number.isSafeInteger(data.refresh_token_expire_in) || data.refresh_token_expire_in <= now) {
    throw new Error("tiktokshop_token_expiry_invalid");
  }
  return {
    accessToken: data.access_token, refreshToken: data.refresh_token,
    expiresAt: new Date(data.access_token_expire_in * 1000),
    refreshExpiresAt: new Date(data.refresh_token_expire_in * 1000),
  };
}

export function exchangeTikTokShopCode(code: string): Promise<TikTokShopTokens> {
  return getTokens("get", { auth_code: code, grant_type: "authorized_code" });
}

export function refreshTikTokShopToken(refreshToken: string): Promise<TikTokShopTokens> {
  return getTokens("refresh", { refresh_token: refreshToken, grant_type: "refresh_token" });
}

export function requestTikTokShop<T>(accessToken: string, path: string, params: Record<string, string> = {}, payload?: unknown): Promise<T> {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const query = { ...params, app_key: requiredEnv("TIKTOKSHOP_APP_KEY"), timestamp: String(Math.floor(Date.now() / 1000)) };
  const sign = signTikTokShopRequest(path, query, requiredEnv("TIKTOKSHOP_APP_SECRET"), body);
  return fetchEnvelope<T>(`${API_BASE}${path}?${new URLSearchParams({ ...query, sign })}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-tts-access-token": accessToken },
    ...(payload === undefined ? {} : { body }),
  });
}

export interface TikTokShopIdentity { id: string; name: string; cipher: string; }

export async function getTikTokShopIdentity(accessToken: string, selectedShopId?: string): Promise<TikTokShopIdentity> {
  const data = await requestTikTokShop<{ shops: TikTokShopIdentity[] }>(accessToken, "/authorization/202309/shops");
  if (!Array.isArray(data.shops) || !data.shops.length) throw new Error("tiktokshop_authorized_shop_missing");
  if (!selectedShopId && data.shops.length !== 1) throw new Error("tiktokshop_shop_selection_required");
  const shop = selectedShopId ? data.shops.find(s => s.id === selectedShopId) : data.shops[0];
  if (!shop || typeof shop.id !== "string" || !shop.id || typeof shop.cipher !== "string" || !shop.cipher) {
    throw new Error("tiktokshop_authorized_shop_invalid");
  }
  return { id: shop.id, name: typeof shop.name === "string" ? shop.name : "", cipher: shop.cipher };
}
