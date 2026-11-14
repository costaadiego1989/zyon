import { conversationFetch } from "./conversation-access";
import { getValidBuyer } from "./buyer-auth";

type Scope = { merchantId: string; cartRef: string };
type Request = Scope & { previousToken?: string };
type Slot = { token?: string; pending?: { previous?: string; promise: Promise<string> } };

// Explicit browser-tab credential resources, never server/session authority.
const slots = new Map<string, Slot>();
const prefix = "aacp_checkout_continuity:";
function unavailable(): never { throw new Error("checkout_session_unavailable"); }
function token(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 8192;
}
function context(input: Scope) {
  if (typeof window === "undefined" || !window.location?.origin || !input
    || [input.merchantId, input.cartRef].some(value => typeof value !== "string" || !value.trim() || value.length > 120)) return unavailable();
  const origin = window.location.origin;
  if (new URL(origin).origin !== origin) return unavailable();
  return { key: prefix + JSON.stringify([origin, input.merchantId, input.cartRef]), origin };
}
function persist(key: string, value: string): void {
  try { sessionStorage.setItem(key, JSON.stringify({ version: 1, token: value })); } catch { /* Keep the same-page memory proof. */ }
}
function stored(key: string): string | undefined {
  let raw: string | null;
  try { raw = sessionStorage.getItem(key); } catch { return undefined; }
  if (raw === null) return undefined;
  if (raw.length > 10000) return unavailable();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2 || !("version" in value) || value.version !== 1
    || !("token" in value) || !token(value.token)) return unavailable();
  return value.token;
}

/** Always validate continuity on the existing server route. A browser token is
 * only a proof to submit, never permission to select/transfer a checkout. */
export async function requestStorefrontCheckoutToken(input: Request): Promise<string> {
  try {
    const { key, origin } = context(input);
    if (input.previousToken !== undefined && !token(input.previousToken)) return unavailable();
    let slot = slots.get(key);
    if (!slot) { slot = { token: stored(key) }; slots.set(key, slot); }
    if (input.previousToken !== undefined && slot.token !== undefined && input.previousToken !== slot.token) return unavailable();
    const previous = input.previousToken ?? slot.token;
    if (slot.pending) {
      if (slot.pending.previous !== previous) return unavailable();
      return await slot.pending.promise;
    }
    if (previous && !slot.token) { slot.token = previous; persist(key, previous); }
    const resource = slot;
    const pending = (async () => {
      const response = await conversationFetch(input.cartRef, "/api/checkout-token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant_id: input.merchantId, cart_ref: input.cartRef, allowed_origin: origin,
          ...(previous ? { previous_embed_token: previous } : {}), buyer_access_token: getValidBuyer()?.token }),
      });
      if (!response.ok) return unavailable();
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("embed_session_token" in data) || !token(data.embed_session_token)
        || !("expires_at_unix" in data) || !Number.isSafeInteger(data.expires_at_unix)
        || typeof data.expires_at_unix !== "number" || data.expires_at_unix <= 0 || slots.get(key) !== resource) return unavailable();
      resource.token = data.embed_session_token;
      persist(key, resource.token);
      return resource.token;
    })();
    resource.pending = { previous, promise: pending };
    try { return await pending; } finally { if (resource.pending?.promise === pending) resource.pending = undefined; }
  } catch { return unavailable(); }
}

/** Invalidate this exact context, including in-flight receipts. Other carts and
 * tenants are untouched; no network command or server-side release is implied. */
export function forgetStorefrontCheckoutToken(input: Scope): void {
  try {
    const { key } = context(input);
    slots.delete(key);
    try { sessionStorage.removeItem(key); } catch { /* Memory fence still applies. */ }
  } catch { /* Invalid/SSR scope has no local resource to clear. */ }
}
