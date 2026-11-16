import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { TenantContextService, type TenantContext } from "../../../../shared/tenant/tenant-context.service.js";
import { SupportController } from "./support.controller.js";

function fixture(userId = "visitor:verified-identity") {
  const tenant = new TenantContextService(), scopes: Array<TenantContext | null> = [];
  let reads = 0, sends = 0, fail = false;
  const sender = { execute: async (input: any, context: any) => {
    sends++;scopes.push(structuredClone(tenant.get()));
    assert.equal(input.merchant_id, "public-store");assert.equal(context.buyerGlobalUserId, userId.startsWith("buyer:") ? userId.slice(6) : undefined);
    if (fail) throw Error("synthetic_chat_failure");
    return { reply: "Synthetic public response", safe: true };
  } };
  const settings = { execute: async (merchantId: string) => { reads++;assert.equal(merchantId, "public-store");
    scopes.push(structuredClone(tenant.get()));return { faqItems: [] }; } };
  const Controller = SupportController as any;
  const controller = new Controller(sender, settings, {}, {}, {}, {}, {},
    { assertAllowed: async (resolved: string) => { assert.equal(resolved, userId); } },
    { resolve: (input: any) => { assert.equal(input.merchantId, "public-store");return { userId, token: "synthetic-token" }; } },
    undefined, undefined, undefined, tenant);
  const body = { merchant_id: "public-store", session_id: "synthetic-session", message: "Synthetic public policy question" };
  return { tenant, scopes, controller, body, reads: () => reads, sends: () => sends, fail: () => { fail = true; } };
}

test("T68 public support caller", async t => {
  await t.test("admitted anonymous identity scopes current settings and knowledge execution then restores ALS", async () => {
    const f = fixture();
    const response = await f.controller.chatPublic(f.body, { headers: {} });
    assert.deepEqual(response, { reply: "Synthetic public response", safe: true, ai_user_token: "synthetic-token" });
    assert.equal(f.reads(), 1);assert.equal(f.sends(), 1);
    assert.deepEqual(f.scopes.map(scope => [scope?.merchantId, scope?.userId, scope?.role]),
      [["public-store", "visitor:verified-identity", "buyer"], ["public-store", "visitor:verified-identity", "buyer"]]);
    assert.equal(f.tenant.get(), null);
  });
  await t.test("verified embed mismatch is rejected before tenant context and source reads", async () => {
    const f = fixture();
    await assert.rejects(f.controller.chatPublic(f.body, { headers: {}, embedClaims: { merchantId: "another-store" } }), ForbiddenException);
    assert.equal(f.reads(), 0);assert.equal(f.sends(), 0);assert.deepEqual(f.scopes, []);assert.equal(f.tenant.get(), null);
  });
  await t.test("an existing different tenant cannot be replaced by the public request body", async () => {
    const f = fixture(), outer = { merchantId: "another-store", userId: "authenticated-user", role: "owner" };
    await f.tenant.run(outer, async () => {
      await assert.rejects(f.controller.chatPublic(f.body, { headers: {} }), ForbiddenException);
      assert.deepEqual(f.tenant.get(), outer);
    });
    assert.equal(f.reads(), 0);assert.equal(f.sends(), 0);assert.equal(f.tenant.get(), null);
  });
  await t.test("a failed support operation clears only its own admitted scope", async () => {
    const f = fixture();f.fail();
    await assert.rejects(f.controller.chatPublic(f.body, { headers: {} }), /synthetic_chat_failure/);
    assert.equal(f.scopes[1]?.merchantId, "public-store");assert.equal(f.scopes[1]?.userId, "visitor:verified-identity");
    assert.equal(f.tenant.get(), null);
  });
  await t.test("buyer context comes only from the admitted identity and ignores body identity fields", async () => {
    const f = fixture("buyer:verified-global-buyer");
    await f.controller.chatPublic({ ...f.body, buyerGlobalUserId: "forged-body-buyer", userId: "forged-body-user" }, { headers: {} });
    assert.ok(f.scopes.every(scope => scope?.merchantId === "public-store" && scope.userId === "buyer:verified-global-buyer"
      && scope.buyerGlobalUserId === "verified-global-buyer" && scope.role === "buyer"));
    assert.equal(f.scopes.length, 2);assert.equal(f.tenant.get(), null);
  });
});
