import test from "node:test";
import assert from "node:assert/strict";
import { MetaCloudSenderAdapter } from "./meta-cloud-sender.adapter.js";

const activeConfig = {
  id: "config-meta", merchantId: "merchant-meta", enabled: true, provider: "META_CLOUD", status: "ACTIVE",
  credentials: { accessToken: "merchant-token", wabaId: "123456789", phoneNumberId: "987654321" },
  createdAt: new Date(0), updatedAt: new Date(0),
};

test("sends a conversational response through the connected merchant Meta phone", async t => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mock = t.mock.method(globalThis, "fetch", async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ messages: [{ id: "wamid-outbound" }] });
  });
  const adapter = new MetaCloudSenderAdapter({
    findById: async (id: string) => id === activeConfig.id ? activeConfig : null,
  } as any);

  assert.deepEqual(await adapter.sendText({
    provider: "META_CLOUD", deviceId: "META_CLOUD:config-meta", toNumber: "+55 (11) 98888-8888", text: "Olá, Ana!",
  }), { messageId: "wamid-outbound", status: "sent" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://graph.facebook.com/v23.0/987654321/messages");
  assert.equal(new Headers(calls[0]?.init?.headers).get("Authorization"), "Bearer merchant-token");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    messaging_product: "whatsapp", to: "5511988888888", type: "text", text: { body: "Olá, Ana!" },
  });
  mock.mock.restore();
});

test("does not use platform credentials when the Meta connection is unavailable", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => {
    assert.fail("must not call Graph API without an active merchant connection");
  });
  const adapter = new MetaCloudSenderAdapter({ findById: async () => null } as any);
  assert.deepEqual(await adapter.sendText({
    provider: "META_CLOUD", deviceId: "META_CLOUD:missing", toNumber: "5511988888888", text: "Olá",
  }), { messageId: "", status: "failed" });
  mock.mock.restore();
});

test("invalid media is rejected before any provider request", async t => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("invalid payload must not reach Meta"); });
  const adapter = new MetaCloudSenderAdapter({ findById: async () => activeConfig } as any);
  const result = await adapter.sendMedia({ deviceId: "META_CLOUD:config-meta", toNumber: "552171191446", text: "", mediaUrl: "http://example.com/image.jpg", mimetype: "image/jpeg" });
  assert.deepEqual(result, { messageId: "", status: "failed" });
});

test("native lists, media and correlation are sent as Meta payloads and transport uncertainty is not a rejection", async t => {
  let request: any;
  const mock = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => { request = JSON.parse(String(init?.body)); return Response.json({ messages: [{ id: "wamid.native" }] }); });
  const adapter = new MetaCloudSenderAdapter({ findById: async () => activeConfig } as any);
  const base = { deviceId: "META_CLOUD:config-meta", toNumber: "552171191446", text: "", correlationId: "zyon:turn:0" };
  const interactive = { type: "list", body: { text: "Produtos" }, action: { button: "Ver", sections: [{ rows: [{ id: "exact-product-id", title: "Produto" }] }] } };
  await adapter.sendText({ ...base, uiMessage: { type: "interactive", interactive } });
  assert.deepEqual(request.interactive, interactive); assert.equal(request.biz_opaque_callback_data, base.correlationId);
  assert.equal(request.to, "552171191446");
  await adapter.sendMedia({ ...base, mediaUrl: "https://example.com/product.jpg", mimetype: "image/jpeg" });
  assert.equal(request.type, "image"); assert.equal(request.image.link, "https://example.com/product.jpg");
  mock.mock.mockImplementation(async () => { throw new Error("connection lost after submission"); });
  assert.equal((await adapter.sendText(base)).status, "unknown");
});
