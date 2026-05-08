/** Base da API HTTP sem barra final (ex.: `http://localhost:3009`). */
export function normalizeApiBase(url: string): string {
  return url.replace(/\/$/, "");
}

export const CHECKOUT_EMBED_PATHS = {
  start: "/embed/start",
  track: "/embed/track",
  chatMessage: "/embed/chat",
  applyOffer: "/embed/offers/apply",
  paymentIntents: "/embed/payment/intents"
} as const;

export const CHECKOUT_LEGACY_PATHS = {
  start: "/start-checkout",
  track: "/track-event",
  chatMessage: "/chat/message",
  applyOffer: "/offers/apply"
} as const;

export async function checkoutJson<T>(
  origin: string,
  path: string,
  options: { embedToken?: string; body: Record<string, unknown> }
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

  return (await response.json()) as T;
}
