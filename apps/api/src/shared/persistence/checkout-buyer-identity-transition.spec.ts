import assert from "node:assert/strict";
import test from "node:test";
import { appendCheckoutBuyerIdentityTransition, assertCheckoutBuyerIdentityTransition,
  assertCheckoutBuyerIdentityChatClaim, appendCheckoutBuyerIdentityDetachment } from "./checkout-buyer-identity-transition.js";

const now = new Date("2026-10-20T15:00:00.000Z"), scope = { merchantId: "merchant", sessionId: "checkout" };
function fixture() {
  const rows: unknown[] = [], events: unknown[] = [], active: unknown[] = [];
  const actual = { ...scope, globalUserId: "returning", version: 8 };
  const tx = { $queryRaw: async () => [], checkoutSession: { findUnique: async () => actual },
    checkoutChatRequest: { findMany: async () => active },
    outboxMessage: { create: async ({ data }: { data: unknown }) => { rows.push(structuredClone(data)); }, findMany: async () => rows },
    checkoutEvent: { create: async ({ data }: { data: unknown }) => { events.push(structuredClone(data)); },
      findFirst: async ({ where }: { where: { metadata: { equals: unknown } } }) => events.find((event: any) =>
        JSON.stringify(event.metadata) === JSON.stringify(where.metadata.equals)) } };
  const write = (patch = {}) => appendCheckoutBuyerIdentityTransition(tx as never, { ...scope, fromBuyerId: "visitor",
    toBuyerId: "returning", fromVersion: 4, toVersion: 5, acceptanceEventIds: ["acceptance"],
    basisHash: "a".repeat(64), verifiedAt: now.toISOString(), ...patch });
  const read = (from = "visitor", to = "returning", acceptance = "acceptance") =>
    assertCheckoutBuyerIdentityTransition(tx as never, scope, acceptance, from, to, 3);
  return { tx, rows, events, active, actual, write, read };
}
test("transition proof pairs actual technical event/outbox and leaves secret data absent", async () => {
  const f = fixture(); await f.write(); await f.read();
  assert.equal(f.rows.length, 1); assert.equal(f.events.length, 1);
  assert.deepEqual(Object.keys((f.rows[0] as any).payload).sort(), ["event_name", "metadata", "session_id"]);
  assert.equal((f.rows[0] as any).payload.event_name, "auth_identity_confirmed");
  assert.doesNotMatch(JSON.stringify(f.rows), /otp_code|123456|example|verificationToken|email_verified/);
});
test("multiple actual transitions form a monotonic same-session acceptance chain", async () => {
  const f = fixture(); await f.write({ toBuyerId: "intermediate" });
  await f.write({ fromBuyerId: "intermediate", fromVersion: 6, toVersion: 7 }); await f.read();
});
for (const kind of ["missing", "event", "payload", "scope", "buyer", "acceptance", "version", "fork", "clock"] as const) {
  test(`transition proof refuses ${kind}, not caller JSON or current verified flag`, async () => {
    const f = fixture(); if (kind !== "missing") await f.write();
    if (kind === "event") f.events.length = 0;
    if (kind === "payload") Reflect.set((f.rows[0] as any).payload.metadata.identity_transition, "toBuyerId", "forged");
    if (kind === "scope") f.actual.merchantId = "other";
    if (kind === "buyer") f.actual.globalUserId = "other";
    if (kind === "acceptance") return assert.rejects(f.read("visitor", "returning", "other"), /checkout_buyer_identity_review_required/);
    if (kind === "version") f.actual.version = 4;
    if (kind === "fork") await f.write({ toBuyerId: "other", fromVersion: 6, toVersion: 7 });
    if (kind === "clock") Reflect.set(f.rows[0] as object, "occurredAt", new Date(now.getTime() + 1));
    await assert.rejects(f.read(), /checkout_buyer_identity_review_required/);
  });
}
test("identity equality does not manufacture a transition", async () => {
  const f = fixture(); await f.read("returning"); assert.equal(f.rows.length, 0);
});
test("exact server-owned processing claim is allowed; another or unknown claim is not", async () => {
  const f = fixture(), claim = { requestId: "request", requestHash: "a".repeat(64) };
  f.active.push({ id: claim.requestId, ...scope, conversationId: "conversation", requestHash: claim.requestHash, status: "processing" });
  await assertCheckoutBuyerIdentityChatClaim(f.tx as never, scope, claim, "conversation");
  await assert.rejects(assertCheckoutBuyerIdentityChatClaim(f.tx as never, scope, undefined, "conversation"), /checkout_buyer_identity_review_required/);
  await assert.rejects(assertCheckoutBuyerIdentityChatClaim(f.tx as never, scope, { ...claim, requestHash: "b".repeat(64) }, "conversation"), /checkout_buyer_identity_review_required/);
  Reflect.set(f.active[0] as object, "status", "unknown");
  await assert.rejects(assertCheckoutBuyerIdentityChatClaim(f.tx as never, scope, claim, "conversation"), /checkout_buyer_identity_review_required/);
});
test("absent claim cannot whitelist a stale or unrelated processing row", async () => {
  const f = fixture(); await assertCheckoutBuyerIdentityChatClaim(f.tx as never, scope);
  await assert.rejects(assertCheckoutBuyerIdentityChatClaim(f.tx as never, scope, { requestId: "missing", requestHash: "a".repeat(64) }), /checkout_buyer_identity_review_required/);
});
test("detachment preserves only acceptance provenance, never claims OTP/account verification", async () => {
  const f = fixture(), anonymous = "usr_12345678-1234-4234-8234-123456789abc"; f.actual.globalUserId = anonymous;
  await appendCheckoutBuyerIdentityDetachment(f.tx as never, { ...scope, fromBuyerId: "visitor", toBuyerId: anonymous,
    fromVersion: 4, toVersion: 5, acceptanceEventIds: ["acceptance"], basisHash: "b".repeat(64), detachedAt: now.toISOString() });
  await f.read("visitor", anonymous);
  const row = f.rows[0] as any;
  assert.equal(row.payload.event_name, "buyer_identity_detached");
  assert.equal(row.payload.metadata.identity_detachment.protocol, "checkout_buyer_identity_detachment_v1");
  assert.doesNotMatch(JSON.stringify(row), /verifiedAt|auth_identity_confirmed|email_verified|otp_code/);
});
test("actual detachment then real OTP creates a mixed-purpose same-session chain", async () => {
  const f = fixture(), anonymous = "usr_12345678-1234-4234-8234-123456789abc";
  await appendCheckoutBuyerIdentityDetachment(f.tx as never, { ...scope, fromBuyerId: "visitor", toBuyerId: anonymous,
    fromVersion: 4, toVersion: 5, acceptanceEventIds: ["acceptance"], basisHash: "b".repeat(64), detachedAt: now.toISOString() });
  await f.write({ fromBuyerId: anonymous, fromVersion: 6, toVersion: 7 }); await f.read();
});
test("detachment cannot be relabeled as OTP authentication or target a non-anonymous account", async () => {
  const f = fixture(); await assert.rejects(appendCheckoutBuyerIdentityDetachment(f.tx as never, { ...scope, fromBuyerId: "visitor", toBuyerId: "registered",
    fromVersion: 4, toVersion: 5, acceptanceEventIds: ["acceptance"], basisHash: "b".repeat(64), detachedAt: now.toISOString() }));
  const anonymous = "usr_12345678-1234-4234-8234-123456789abc"; f.actual.globalUserId = anonymous;
  await appendCheckoutBuyerIdentityDetachment(f.tx as never, { ...scope, fromBuyerId: "visitor", toBuyerId: anonymous,
    fromVersion: 4, toVersion: 5, acceptanceEventIds: ["acceptance"], basisHash: "b".repeat(64), detachedAt: now.toISOString() });
  Reflect.set((f.rows[0] as any).payload, "event_name", "auth_identity_confirmed");
  await assert.rejects(f.read("visitor", anonymous), /checkout_buyer_identity_review_required/);
});
