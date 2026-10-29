import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { appendCheckoutEmailOtpDelivery, claimCheckoutEmailOtpDelivery, completeCheckoutEmailOtpDelivery,
  invalidatePendingCheckoutEmailOtpDelivery, CHECKOUT_EMAIL_OTP_DELIVERY_EVENT } from "./checkout-email-otp-outbox.js";

// Explicit transaction delegates only; not a PostgreSQL/race/rollback proof.
const reference = { merchantId: "synthetic-merchant", sessionId: "synthetic-checkout",
  deliveryId: "9ba59f85-e670-4072-928d-79223466899e", acceptanceEventId: "synthetic-acceptance",
  issuedAt: "2026-10-20T12:00:00.000Z", expiresAt: "2026-10-20T12:10:00.000Z" };
const now = new Date("2026-10-20T12:01:00Z");
function fixture() {
  let row: Record<string, unknown> | null = null;
  const calls: string[] = [], fault = { cas: false };
  const tx = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      calls.push("lock"); assert.match(parts.join("?"), /FOR UPDATE/);
      assert.ok(values.includes(reference.merchantId)); assert.ok(values.includes(reference.sessionId)); assert.ok(values.includes(reference.deliveryId)); return [];
    },
    outboxMessage: {
      async create(args: { data: Record<string, unknown> }) {
        calls.push("create"); if (row) throw new Error("synthetic_event_collision"); row = structuredClone(args.data); return row;
      },
      async findFirst(args: { where: { merchantId: string; eventId: string } }) {
        calls.push("read"); return row?.merchantId === args.where.merchantId && row.eventId === args.where.eventId ? structuredClone(row) : null;
      },
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        calls.push("update");
        if (fault.cas || !row || Object.entries(args.where).some(([key, value]) => row![key] !== value)) return { count: 0 };
        Object.assign(row, structuredClone(args.data)); return { count: 1 };
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, fault, calls,
    row: () => structuredClone(row), mutate(work: (value: Record<string, unknown>) => void) { assert.ok(row); work(row); } };
}

test("append uses private non-relay status and reference-only scoped immutable payload", async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference);
  const row = f.row()!; assert.equal(row.status, "otp_pending"); assert.equal(row.eventType, CHECKOUT_EMAIL_OTP_DELIVERY_EVENT);
  assert.equal(row.attempts, 0); assert.equal(row.merchantId, reference.merchantId); assert.equal(row.correlationId, reference.sessionId);
  assert.deepEqual(row.payload, { version: 1, sessionId: reference.sessionId, deliveryId: reference.deliveryId,
    acceptanceEventId: reference.acceptanceEventId, issuedAt: reference.issuedAt, expiresAt: reference.expiresAt });
  for (const key of ["email", "code", "otp_code", "providerMessageId"]) assert.ok(!Object.hasOwn(row.payload as object, key));
  const before = f.row(); await assert.rejects(appendCheckoutEmailOtpDelivery(f.tx, reference), /synthetic_event_collision/); assert.deepEqual(f.row(), before);
});

for (const patch of [{ code: "123456" }, { email: "buyer@example.test" }, { expiresAt: "2026-10-20T12:11:00Z" },
  { issuedAt: "invalid" }, { deliveryId: "not-uuid" }]) test(`append rejects caller financial/identity extras ${Object.keys(patch).join()}`, async () => {
  const f = fixture(); await assert.rejects(appendCheckoutEmailOtpDelivery(f.tx, { ...reference, ...patch })); assert.deepEqual(f.calls, []);
});
test("claim persists sending/one attempt/token before returning; concurrent reclaims do not reset it", async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference); f.calls.length = 0;
  const claim = await claimCheckoutEmailOtpDelivery(f.tx, reference, now); assert.equal(claim.status, "claimed");
  assert.equal(f.row()!.status, "otp_sending"); assert.equal(f.row()!.attempts, 1);
  assert.equal(f.row()!.leaseExpiresAt, null); assert.deepEqual(f.calls, ["lock", "read", "update"]);
  const before = f.row(); assert.deepEqual(await claimCheckoutEmailOtpDelivery(f.tx, reference, now), { status: "unknown" }); assert.deepEqual(f.row(), before);
});
for (const status of ["sent", "unknown"] as const) test(`completion persists ${status}, drops token, and blocks automatic replay`, async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference);
  const claim = await claimCheckoutEmailOtpDelivery(f.tx, reference, now); assert.equal(claim.status, "claimed");
  if (claim.status !== "claimed") assert.fail("claim missing");
  const outcome = status === "sent" ? { status, providerMessageId: "synthetic-message" } : { status };
  assert.equal(await completeCheckoutEmailOtpDelivery(f.tx, reference, claim.claimToken, outcome, now), status);
  const row = f.row()!; assert.equal(row.status, `otp_${status}`); assert.equal(row.leaseToken, null); assert.equal(row.attempts, 1);
  assert.deepEqual(await claimCheckoutEmailOtpDelivery(f.tx, reference, now), { status });
  await assert.rejects(completeCheckoutEmailOtpDelivery(f.tx, reference, claim.claimToken, outcome, now));
  if (status === "unknown") await assert.rejects(invalidatePendingCheckoutEmailOtpDelivery(f.tx, reference));
  else assert.equal(await invalidatePendingCheckoutEmailOtpDelivery(f.tx, reference), "sent");
});
test("only never-dispatched pending may be cancelled by explicit replacement", async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference);
  assert.equal(await invalidatePendingCheckoutEmailOtpDelivery(f.tx, reference), "cancelled");
  assert.equal(f.row()!.status, "otp_cancelled"); assert.equal(f.row()!.attempts, 0);
  assert.deepEqual(await claimCheckoutEmailOtpDelivery(f.tx, reference, now), { status: "cancelled" });
  assert.equal(await invalidatePendingCheckoutEmailOtpDelivery(f.tx, reference), "cancelled");
});
test("sending cannot be cancelled or reclaimed even after expiry", async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference); await claimCheckoutEmailOtpDelivery(f.tx, reference, now);
  const before = f.row(); await assert.rejects(invalidatePendingCheckoutEmailOtpDelivery(f.tx, reference));
  assert.deepEqual(await claimCheckoutEmailOtpDelivery(f.tx, reference, new Date("2027-01-01T00:00:00Z")), { status: "unknown" });
  assert.deepEqual(f.row(), before);
});
test("expired pending is cancelled without ever granting a sending token", async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference);
  assert.deepEqual(await claimCheckoutEmailOtpDelivery(f.tx, reference, new Date(reference.expiresAt)), { status: "cancelled" });
  assert.equal(f.row()!.attempts, 0); assert.equal(f.row()!.leaseToken, null);
});
for (const corruption of ["foreign-merchant", "foreign-session", "foreign-acceptance", "event-type", "payload-code", "payload-version", "attempts", "token", "clock"] as const)
  test(`claim refuses corrupted technical provenance ${corruption}`, async () => {
    const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference);
    f.mutate(row => {
      if (corruption === "foreign-merchant") row.merchantId = "other";
      if (corruption === "foreign-session") row.correlationId = "other";
      if (corruption === "foreign-acceptance") row.causationId = "other";
      if (corruption === "event-type") row.eventType = "cross-sell.offer.accepted";
      if (corruption === "payload-code") row.payload = { ...(row.payload as object), code: "123456" };
      if (corruption === "payload-version") row.payload = { ...(row.payload as object), version: 2 };
      if (corruption === "attempts") row.attempts = 1;
      if (corruption === "token") row.leaseToken = "57f5dbaf-d12d-4c2b-9c51-1afbe3b249e2";
    });
    const before = f.row(); f.calls.length = 0;
    await assert.rejects(claimCheckoutEmailOtpDelivery(f.tx, reference, corruption === "clock" ? new Date("invalid") : now));
    assert.deepEqual(f.row(), before); assert.ok(!f.calls.includes("update"));
  });
for (const operation of ["claim", "cancel", "complete"] as const) test(`${operation} CAS failure cannot be reported successful`, async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference);
  let token = "57f5dbaf-d12d-4c2b-9c51-1afbe3b249e2";
  if (operation === "complete") { const claim = await claimCheckoutEmailOtpDelivery(f.tx, reference, now); if (claim.status === "claimed") token = claim.claimToken; }
  const before = f.row(); f.fault.cas = true;
  await assert.rejects(operation === "claim" ? claimCheckoutEmailOtpDelivery(f.tx, reference, now)
    : operation === "cancel" ? invalidatePendingCheckoutEmailOtpDelivery(f.tx, reference)
    : completeCheckoutEmailOtpDelivery(f.tx, reference, token, { status: "unknown" }, now));
  assert.deepEqual(f.row(), before);
});
test("completion requires exact scope/reference/token, not merely a parsed sent outcome", async () => {
  const f = fixture(); await appendCheckoutEmailOtpDelivery(f.tx, reference); await claimCheckoutEmailOtpDelivery(f.tx, reference, now);
  const before = f.row();
  await assert.rejects(completeCheckoutEmailOtpDelivery(f.tx, reference, "57f5dbaf-d12d-4c2b-9c51-1afbe3b249e2", { status: "sent", providerMessageId: "synthetic" }, now));
  assert.deepEqual(f.row(), before);
});
