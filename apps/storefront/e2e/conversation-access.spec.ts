import { test, expect } from "@playwright/test";
import {
  conversationAccessMatchesCurrentOrigin,
  conversationFetch,
  forgetConversationAccess,
  rememberConversationAccess,
  ConversationSessionExpiredError,
} from "../src/lib/conversation-access";

const token = (expiresAt: number, origin?: string) => `${Buffer.from(JSON.stringify({ expiresAt, ...(origin ? { origin } : {}) })).toString("base64url")}.test-signature`;

test("only restores a conversation capability that belongs to this storefront origin", () => {
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "https://store.example" } }, configurable: true });
  try {
    rememberConversationAccess("bound", token(Date.now() / 1000 + 3600, "https://store.example"));
    rememberConversationAccess("legacy", token(Date.now() / 1000 + 3600));
    expect(conversationAccessMatchesCurrentOrigin("bound")).toBe(true);
    expect(conversationAccessMatchesCurrentOrigin("legacy")).toBe(false);
  } finally {
    forgetConversationAccess("bound");
    forgetConversationAccess("legacy");
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("expired chat and cart access renew once and preserve the resource", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://localhost:3001" } }, configurable: true });
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

test("GET and HEAD authorization failures renew once and preserve the original identity", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://localhost:3001" } }, configurable: true });
  const id = "rejected_cart";
  rememberConversationAccess(id, token(Date.now() / 1000 + 3600));
  try {
    for (const method of ["GET", "HEAD"]) for (const status of [401, 403]) {
      let calls = 0;
      globalThis.fetch = async url => {
        calls++;
        if (String(url).endsWith("/access")) return Response.json({ conversation_id: id, conversation_token: token(Date.now() / 1000 + 3700) });
        return new Response(null, { status: calls === 1 ? status : 200 });
      };
      expect((await conversationFetch(id, "/cart/rejected_cart", { method })).status).toBe(200);
      expect(calls).toBe(3);
    }
  } finally {
    globalThis.fetch = originalFetch;
    forgetConversationAccess(id);
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("POST, PATCH and DELETE rejection never renews and replays a possibly applied command", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://localhost:3001" } }, configurable: true });
  const id = "uncertain_command";
  try {
    for (const method of ["POST", "PATCH", "DELETE"]) for (const status of [401, 403]) {
      rememberConversationAccess(id, token(Date.now() / 1000 + 3600));
      const calls: string[] = [];
      globalThis.fetch = async url => { calls.push(String(url)); return Response.json({}, { status }); };
      await expect(conversationFetch(id, "/cart/uncertain_command", { method })).rejects.toBeInstanceOf(ConversationSessionExpiredError);
      expect(calls).toEqual(["/cart/uncertain_command"]);
    }
  } finally {
    globalThis.fetch = originalFetch;
    forgetConversationAccess(id);
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("an explicitly non-replayable GET is never repeated after authorization failure", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://localhost:3001" } }, configurable: true });
  const id = "non_replayable_read";
  rememberConversationAccess(id, token(Date.now() / 1000 + 3600));
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}, { status: 401 }); };
  try {
    await expect(conversationFetch(id, "/cart/non_replayable_read", { method: "GET" }, { replayAuthorizationFailure: false })).rejects.toBeInstanceOf(ConversationSessionExpiredError);
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    forgetConversationAccess(id);
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("a rejected read renewal stops before a second read dispatch", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://localhost:3001" } }, configurable: true });
  const id = "rejected_renewal";
  rememberConversationAccess(id, token(Date.now() / 1000 + 3600));
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}, { status: 401 }); };
  try {
    await expect(conversationFetch(id, "/cart/rejected_renewal")).rejects.toBeInstanceOf(ConversationSessionExpiredError);
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    forgetConversationAccess(id);
    Reflect.deleteProperty(globalThis, "window");
  }
});
