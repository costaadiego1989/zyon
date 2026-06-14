/** Base da API HTTP sem barra final (ex.: `http://localhost:3009`). */
export function normalizeApiBase(url: string): string {
  return url.replace(/\/$/, "");
}

export const CHECKOUT_EMBED_PATHS = {
  start: "/embed/start",
  track: "/embed/track",
  chatMessage: "/embed/chat",
  applyOffer: "/embed/offers/apply",
  applyCoupon: "/embed/coupons/apply",
  acceptCrossSell: "/embed/cross-sell/accept",
  catalogSearch: "/embed/catalog/search",
  catalogAdd: "/embed/catalog/add",
  paymentIntents: "/embed/payment/intents",
  paymentStatus: (intentId: string) => `/embed/payment/intents/${intentId}/status`,
  cryptoPaymentConfirm: (intentId: string) => `/embed/payment/intents/${intentId}/crypto/confirm`,
  stripePaymentConfirm: (intentId: string) => `/embed/payment/intents/${intentId}/stripe/confirm`,
  buyerLoginFromSession: "/buyer/login-from-session"
} as const;

export const CHECKOUT_LEGACY_PATHS = {
  start: "/start-checkout",
  track: "/track-event",
  chatMessage: "/chat/message",
  applyOffer: "/offers/apply",
  applyCoupon: "/coupons/apply",
  acceptCrossSell: "/cross-sell/accept",
  catalogSearch: "/catalog/search",
  catalogAdd: "/catalog/add",
  paymentIntents: "/payment/intents",
  paymentStatus: (intentId: string) => `/payment/intents/${intentId}/status`,
  cryptoPaymentConfirm: (intentId: string) => `/payment/intents/${intentId}/crypto/confirm`,
  stripePaymentConfirm: (intentId: string) => `/payment/intents/${intentId}/stripe/confirm`,
  buyerLoginFromSession: "/buyer/login-from-session"
} as const;

export async function checkoutJson<T>(
  origin: string,
  path: string,
  options: { embedToken?: string; body: Record<string, unknown>; schema?: { parse(input: unknown): T } }
): Promise<T> {
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (options.embedToken?.trim()) {
    headers["x-aacp-embed-token"] = options.embedToken.trim();
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const payload = await response.json();
  return options.schema ? options.schema.parse(payload) : (payload as T);
}

export async function checkoutGet<T>(
  origin: string,
  path: string,
  options: { embedToken?: string; schema?: { parse(input: unknown): T } } = { schema: undefined as never }
): Promise<T> {
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (options.embedToken?.trim()) {
    headers["x-aacp-embed-token"] = options.embedToken.trim();
  }

  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const payload = await response.json();
  return options.schema ? options.schema.parse(payload) : (payload as T);
}
