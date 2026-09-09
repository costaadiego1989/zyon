// Capabilities are scoped to one conversation and kept within this browser tab.
const access = new Map<string, string>();
const prefix = "aacp_conversation_access:";
const renewals = new Map<string, Promise<void>>();
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

export class ConversationSessionExpiredError extends Error {
  constructor() { super("conversation_session_expired"); }
}

export function rememberConversationAccess(conversationId: string, token: string): void {
  if (typeof window === "undefined") return;
  access.set(conversationId, token);
  try { sessionStorage.setItem(`${prefix}${conversationId}`, token); } catch { /* Private browsing may disable storage. */ }
}

export function conversationAccessHeaders(conversationId: string, explicitToken?: string): Record<string, string> {
  let token = explicitToken ?? access.get(conversationId);
  if (!token && typeof window !== "undefined") {
    try { token = sessionStorage.getItem(`${prefix}${conversationId}`) ?? undefined; } catch { /* Use in-memory credentials. */ }
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The payload is only a scheduling hint. The API always verifies its signature and scope. */
function expiresSoon(token: string): boolean {
  try {
    const payload = token.replace(/^Bearer /, "").split(".")[0];
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return !Number.isFinite(claims.expiresAt) || claims.expiresAt <= Date.now() / 1000 + 60;
  } catch { return true; }
}

export async function ensureConversationAccess(conversationId: string, force = false): Promise<void> {
  const authorization = conversationAccessHeaders(conversationId).Authorization;
  if (!authorization) throw new ConversationSessionExpiredError();
  const pending = renewals.get(conversationId);
  if (pending) return pending;
  if (!force && !expiresSoon(authorization)) return;
  const renewal = (async () => {
    const response = await fetch(`${API_BASE}/storefront/conversations/${encodeURIComponent(conversationId)}/access`, {
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

/** Retry only an authentication rejection, before any cart/message mutation took place. */
export async function conversationFetch(conversationId: string, url: string, options: RequestInit = {}): Promise<Response> {
  await ensureConversationAccess(conversationId);
  const request = () => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", conversationAccessHeaders(conversationId).Authorization);
    return fetch(url, { ...options, headers });
  };
  const usedAuthorization = conversationAccessHeaders(conversationId).Authorization;
  const response = await request();
  if (response.status !== 401) return response;
  // Another request may already have renewed while this one was in flight.
  if (conversationAccessHeaders(conversationId).Authorization === usedAuthorization) {
    await ensureConversationAccess(conversationId, true);
  }
  const retried = await request();
  if (retried.status === 401) throw new ConversationSessionExpiredError();
  return retried;
}
