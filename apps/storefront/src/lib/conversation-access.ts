// Capabilities are scoped to one conversation and kept within this browser tab.
const access = new Map<string, string>();
const prefix = "aacp_conversation_access:";
const renewals = new Map<string, Promise<void>>();
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

function storefrontProxyUrl(url: string): string {
  if (typeof window === "undefined") return url;
  const target = new URL(url, window.location.origin);
  const api = new URL(API_BASE, window.location.origin);
  const storefrontPathStart = target.pathname.indexOf("/storefront/");
  if (target.origin !== api.origin || storefrontPathStart < 0) return url;
  return `/api/storefront-proxy${target.pathname.slice(storefrontPathStart + "/storefront".length)}${target.search}`;
}

export class ConversationSessionExpiredError extends Error {
  constructor() { super("conversation_session_expired"); }
}

export function rememberConversationAccess(conversationId: string, token: string): void {
  if (typeof window === "undefined") return;
  access.set(conversationId, token);
  try { sessionStorage.setItem(`${prefix}${conversationId}`, token); } catch { /* Private browsing may disable storage. */ }
}

export function forgetConversationAccess(conversationId: string): void {
  access.delete(conversationId);
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(`${prefix}${conversationId}`); } catch { /* Private browsing may disable storage. */ }
}

function storedConversationAccess(conversationId: string): string | undefined {
  let token = access.get(conversationId);
  if (!token && typeof window !== "undefined") {
    try { token = sessionStorage.getItem(`${prefix}${conversationId}`) ?? undefined; } catch { /* Use in-memory credentials. */ }
  }
  return token;
}

function capabilityClaims(token: string): { origin?: unknown; expiresAt?: unknown } | null {
  try {
    const payload = token.replace(/^Bearer /, "").split(".")[0];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function conversationAccessHeaders(conversationId: string, explicitToken?: string): Record<string, string> {
  const token = explicitToken ?? storedConversationAccess(conversationId);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Old sessions predate origin-bound capabilities and cannot be safely resumed. */
export function conversationAccessMatchesCurrentOrigin(conversationId: string): boolean {
  if (typeof window === "undefined" || !window.location?.origin) return false;
  const token = storedConversationAccess(conversationId);
  return Boolean(token && capabilityClaims(token)?.origin === window.location.origin);
}

/** The payload is only a scheduling hint. The API always verifies its signature and scope. */
function expiresSoon(token: string): boolean {
  const claims = capabilityClaims(token);
  const expiresAt = claims?.expiresAt;
  return typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000 + 60;
}

export async function ensureConversationAccess(conversationId: string, force = false): Promise<void> {
  const authorization = conversationAccessHeaders(conversationId).Authorization;
  if (!authorization) throw new ConversationSessionExpiredError();
  const pending = renewals.get(conversationId);
  if (pending) return pending;
  if (!force && !expiresSoon(authorization)) return;
  const renewal = (async () => {
    const response = await fetch(storefrontProxyUrl(`${API_BASE}/storefront/conversations/${encodeURIComponent(conversationId)}/access`), {
      method: "POST", headers: { Authorization: authorization },
    });
    if (response.status === 401 || response.status === 403) throw new ConversationSessionExpiredError();
    if (!response.ok) throw new Error("conversation_renewal_unavailable");
    const data = await response.json();
    if (data.conversation_id !== conversationId || typeof data.conversation_token !== "string") {
      throw new Error("invalid_conversation_renewal");
    }
    rememberConversationAccess(conversationId, data.conversation_token);
  })();
  renewals.set(conversationId, renewal);
  try { await renewal; } finally { renewals.delete(conversationId); }
}

/** Retry only an authorization rejection, before any cart/message mutation took place. */
export async function conversationFetch(conversationId: string, url: string, options: RequestInit = {}): Promise<Response> {
  await ensureConversationAccess(conversationId);
  const request = () => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", conversationAccessHeaders(conversationId).Authorization);
    return fetch(storefrontProxyUrl(url), { ...options, headers });
  };
  const usedAuthorization = conversationAccessHeaders(conversationId).Authorization;
  const response = await request();
  if (response.status !== 401 && response.status !== 403) return response;
  // Another request may already have renewed while this one was in flight.
  if (conversationAccessHeaders(conversationId).Authorization === usedAuthorization) {
    await ensureConversationAccess(conversationId, true);
  }
  const retried = await request();
  if (retried.status === 401 || retried.status === 403) throw new ConversationSessionExpiredError();
  return retried;
}
