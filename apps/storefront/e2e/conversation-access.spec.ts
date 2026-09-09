import { test, expect } from "@playwright/test";
import { conversationFetch, rememberConversationAccess, ConversationSessionExpiredError } from "../src/lib/conversation-access";

const token = (expiresAt: number) => `${Buffer.from(JSON.stringify({ expiresAt })).toString("base64url")}.test-signature`;

test("expired chat and cart access renew once and preserve the resource", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  const old = token(Date.now() / 1000 - 10);
  const fresh = token(Date.now() / 1000 + 3600);
  const id = "expired_cart";
  rememberConversationAccess(id, old);
  let renewals = 0;
  const sent: string[] = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/access")) {
      renewals++;
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${old}`);
      await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json({ conversation_id: id, conversation_token: fresh });
    }
    expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${fresh}`);
    sent.push(String(url));
    return Response.json({ ok: true });
  };
  try {
    await Promise.all([
      conversationFetch(id, `/cart/${id}`, { method: "PATCH", body: '{"quantity":2}' }),
      conversationFetch(id, `/conversations/${id}/messages`, { method: "POST" }),
    ]);
    expect(renewals).toBe(1);
    expect(sent).toEqual([`/cart/${id}`, `/conversations/${id}/messages`]);
    let requests = 0;
    globalThis.fetch = async () => { requests++; return Response.json({}, { status: 503 }); };
    expect((await conversationFetch(id, `/cart/${id}`, { method: "PATCH" })).status).toBe(503);
    expect(requests).toBe(1);
    globalThis.fetch = async () => { requests++; throw new TypeError("network"); };
    await expect(conversationFetch(id, `/cart/${id}`, { method: "PATCH" })).rejects.toThrow("network");
    expect(requests).toBe(2);
    await expect(conversationFetch("unsigned_cart", "/cart/unsigned_cart")).rejects.toBeInstanceOf(ConversationSessionExpiredError);
    expect(requests).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("authentication is retried once after renewal; invalid renewal stops", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  const id = "rejected_cart";
  rememberConversationAccess(id, token(Date.now() / 1000 + 3600));
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    if (String(url).endsWith("/access")) return Response.json({ conversation_id: id, conversation_token: token(Date.now() / 1000 + 3700) });
    return Response.json({}, { status: calls === 1 ? 401 : 200 });
  };
  try {
    expect((await conversationFetch(id, "/cart/rejected_cart", { method: "PATCH" })).status).toBe(200);
    expect(calls).toBe(3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({}, { status: 401 }); };
    await expect(conversationFetch(id, "/cart/rejected_cart")).rejects.toBeInstanceOf(ConversationSessionExpiredError);
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, "window");
  }
});
