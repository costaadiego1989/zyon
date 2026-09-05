// Capabilities are scoped to one conversation and kept within this browser tab.
const access = new Map<string, string>();
const prefix = "aacp_conversation_access:";

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
