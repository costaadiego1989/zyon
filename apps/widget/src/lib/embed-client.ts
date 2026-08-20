/** Base da API HTTP sem barra final (ex.: `http://localhost:3009`). */
export function normalizeApiBase(url: string): string {
  return url.replace(/\/$/, "");
}

export const CHECKOUT_EMBED_PATHS = {
  start: "/embed/start",
  track: "/embed/track",
  cart: "/embed/cart",
  chatMessage: "/embed/chat",
  applyOffer: "/embed/offers/apply",
  applyCoupon: "/embed/coupons/apply",
  acceptCrossSell: "/embed/cross-sell/accept",
  catalogSearch: "/embed/catalog/search",
  catalogAdd: "/embed/catalog/add",
  shippingSelect: "/embed/shipping/select",
  paymentIntents: "/embed/payment/intents",
  paymentStatus: (intentId: string) => `/embed/payment/intents/${intentId}/status`,
  cryptoPaymentConfirm: (intentId: string) => `/embed/payment/intents/${intentId}/crypto/confirm`,
  stripePaymentConfirm: (intentId: string) => `/embed/payment/intents/${intentId}/stripe/confirm`,
  buyerLoginFromSession: "/buyer/login-from-session",
  consent: "/embed/checkout/consent",
} as const;

export const CHECKOUT_LEGACY_PATHS = {
  start: "/start-checkout",
  track: "/track-event",
  cart: "/cart",
  chatMessage: "/chat/message",
  applyOffer: "/offers/apply",
  applyCoupon: "/coupons/apply",
  acceptCrossSell: "/cross-sell/accept",
  catalogSearch: "/catalog/search",
  catalogAdd: "/catalog/add",
  shippingSelect: "/checkout/shipping/select",
  paymentIntents: "/payment/intents",
  paymentStatus: (intentId: string) => `/payment/intents/${intentId}/status`,
  cryptoPaymentConfirm: (intentId: string) => `/payment/intents/${intentId}/crypto/confirm`,
  stripePaymentConfirm: (intentId: string) => `/payment/intents/${intentId}/stripe/confirm`,
  buyerLoginFromSession: "/buyer/login-from-session",
  consent: "/consent",
} as const;

export const EMBED_AUTH_HEADER = "Authorization";

export function embedAuthHeaders(embedToken?: string): Record<string, string> {
  const token = embedToken?.trim();
  return token ? { [EMBED_AUTH_HEADER]: `Bearer ${token}` } : {};
}

export class CheckoutHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown
  ) {
    const code = checkoutErrorCodeFromPayload(payload);
    const detail = checkoutErrorDetailFromPayload(payload);
    super(detail || code || `Request failed: ${status}`);
    this.name = "CheckoutHttpError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkoutErrorCodeFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.code === "string" && payload.code.trim()) return payload.code.trim();
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  if (Array.isArray(payload.message)) return "validation_failed";
  return undefined;
}

function checkoutErrorDetailFromPayload(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!isRecord(payload)) return undefined;
  if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  return undefined;
}

export function checkoutErrorCode(error: unknown): string | undefined {
  if (error instanceof CheckoutHttpError) return checkoutErrorCodeFromPayload(error.payload);
  return undefined;
}

export function checkoutErrorStatus(error: unknown): number | undefined {
  return error instanceof CheckoutHttpError ? error.status : undefined;
}

async function readErrorPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("json")) return await response.json();
    return await response.text();
  } catch {
    return undefined;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

function withTimeout(timeoutMs = DEFAULT_TIMEOUT_MS): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function checkoutJson<T>(
  origin: string,
  path: string,
  options: { embedToken?: string; body: Record<string, unknown>; method?: "POST" | "PATCH"; schema?: { parse(input: unknown): T }; timeoutMs?: number }
): Promise<T> {
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  Object.assign(headers, embedAuthHeaders(options.embedToken));

  const { signal, clear } = withTimeout(options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? "POST",
      headers,
      body: JSON.stringify(options.body),
      signal
    });

    if (!response.ok) {
      throw new CheckoutHttpError(response.status, await readErrorPayload(response));
    }

    const payload = await response.json();
    return options.schema ? options.schema.parse(payload) : (payload as T);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new CheckoutHttpError(0, "Network timeout — a requisição demorou demais.");
    }
    throw err;
  } finally {
    clear();
  }
}

export async function checkoutGet<T>(
  origin: string,
  path: string,
  options: { embedToken?: string; schema?: { parse(input: unknown): T }; timeoutMs?: number } = { schema: undefined as never }
): Promise<T> {
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  Object.assign(headers, embedAuthHeaders(options.embedToken));

  const { signal, clear } = withTimeout(options.timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", headers, signal });
    if (!response.ok) {
      throw new CheckoutHttpError(response.status, await readErrorPayload(response));
    }

    const payload = await response.json();
    return options.schema ? options.schema.parse(payload) : (payload as T);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new CheckoutHttpError(0, "Network timeout — a requisição demorou demais.");
    }
    throw err;
  } finally {
    clear();
  }
}
