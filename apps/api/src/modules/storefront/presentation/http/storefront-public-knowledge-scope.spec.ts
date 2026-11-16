import assert from "node:assert/strict";
import test from "node:test";
import { StorefrontController } from "./storefront.controller.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";

function fixture() {
  const tenant = new TenantContextService(), calls: any[] = [];
  const claims = { merchantId: "own", resourceId: "conversation", aiUserId: "visitor:verified-capability" };
  const controller = Object.assign(Object.create(StorefrontController.prototype), {
    tenantContext: tenant,
    capabilities: { verify: (token: string, purpose: string, origin: string) => {
      assert.equal(token, "synthetic-capability");assert.equal(purpose, "storefront-conversation");assert.equal(origin, "https://own.example.test");return claims;
    } },
    conversationRateLimiter: { consume: async () => { calls.push({ kind: "rate" });return { allowed: true, limit: 10, remaining: 9, resetAt: Date.now() + 10000 }; } },
    sendStoreMessage: { execute: async (input: unknown) => { calls.push({ kind: "message", input, scope: tenant.get() });return { message: "ok" }; } },
  }) as StorefrontController;
  const request = { headers: { authorization: "Bearer synthetic-capability", origin: "https://own.example.test" } };
  return { tenant, calls, controller, request };
}

test("T69 storefront binds public knowledge to the admitted capability identity", async t => {
  await t.test("anonymous conversation uses buyer-role tenant scope and restores the outer context", async () => {
    const f = fixture();await f.controller.sendMessage("conversation", { user_message: "Conte sobre a loja" }, f.request);
    const message = f.calls.find(call => call.kind === "message");
    assert.equal(message.scope?.merchantId, "own");assert.equal(message.scope?.role, "buyer");
    assert.equal(message.scope?.userId, "visitor:verified-capability");assert.equal(message.scope?.buyerGlobalUserId, undefined);
    assert.equal(f.tenant.get(), null);
  });
  await t.test("foreign existing context cannot perform rate reads or reach the public use case", async () => {
    const f = fixture();await f.tenant.run({ merchantId: "foreign", userId: "foreign", role: "buyer" }, async () => {
      await assert.rejects(f.controller.sendMessage("conversation", { user_message: "Conte sobre a loja" }, f.request), /public_storefront_tenant_mismatch/);
      assert.equal(f.tenant.get()?.merchantId, "foreign");
    });
    assert.deepEqual(f.calls, []);assert.equal(f.tenant.get(), null);
  });
  await t.test("only verified buyer identity enters scope and correlation survives without copying elevated roles", async () => {
    const f = fixture();Object.assign(f.controller, { buyerJwt: { verify: () => ({ merchantId: "own", globalUserId: "verified-buyer" }) } });
    const request = { headers: { ...f.request.headers, "x-buyer-authorization": "Bearer synthetic-buyer" } };
    await f.tenant.run({ merchantId: "own", userId: "admin", role: "owner", correlationId: "original-correlation" }, async () => {
      await f.controller.sendMessage("conversation", { user_message: "Conte sobre a loja", global_user_id: "forged-body" } as any, request);
      assert.equal(f.tenant.get()?.userId, "admin");assert.equal(f.tenant.get()?.role, "owner");
    });
    const message = f.calls.find(call => call.kind === "message");assert.equal(message.scope?.role, "buyer");
    assert.equal(message.scope?.userId, "buyer:verified-buyer");assert.equal(message.scope?.buyerGlobalUserId, "verified-buyer");
    assert.equal(message.scope?.correlationId, "original-correlation");assert.equal(message.input.global_user_id, "verified-buyer");
  });
});
