import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";
import { captureAppointmentLease, noAppointmentLease } from "../../../shared/bookings/appointment-lease-proof.js";
import { slotFingerprint } from "../../../shared/bookings/redis-service-slots.js";
import { ServiceAppointmentHoldCleanupConsumer, SERVICE_APPOINTMENT_HOLD_CLEANUP,
  SERVICE_APPOINTMENT_RESCHEDULE_HOLD_CLEANUP } from "./service-appointment-hold-cleanup.consumer.js";

function fixture() {
  const now = new Date("2030-01-02T09:00Z"), source = { resourceId: "professional:p", slotId: "source-a",
    startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T10:20:00.000Z" };
  const destination = { ...source, slotId: "dest-c", startsAt: "2030-01-02T11:00:00.000Z", endsAt: "2030-01-02T11:20:00.000Z" };
  const capture = (owner: string, generation: string, slot: typeof source) => captureAppointmentLease("m", owner,
    { merchantId: "m", ownerHash: createHash("sha256").update(owner).digest("hex"), generation,
      fingerprint: slotFingerprint([slot]), expiresAt: "2030-01-02T09:17:00.000Z", slots: [slot] }, slot);
  const old = capture("original", "00000000-0000-4000-8000-000000000001", source);
  const next = capture("destination", "00000000-0000-4000-8000-000000000002", destination);
  const event = { eventId: "reschedule-event", eventType: SERVICE_APPOINTMENT_RESCHEDULE_HOLD_CLEANUP, schemaVersion: 1,
    merchantId: "m", correlationId: "a", causationId: "move-command", payload: { originalAuditId: "origin", appointmentId: "a", rescheduleVersion: 2 } };
  Object.defineProperty(event, "deliveryLeaseToken", { value: "claim", enumerable: false });
  const outbox: any = { ...event, producer: "service-booking-private", status: "processing", leaseToken: "claim", leaseExpiresAt: new Date(now.getTime() + 30_000) };
  const original: any = { id: "origin", merchantId: "m", appointmentId: "a", version: 1, after: { privateLease: old } };
  const moved: any = { id: "moved", merchantId: "m", appointmentId: "a", commandId: "move-command", action: "reschedule", version: 2,
    before: { professionalId: "p", startsAt: source.startsAt, endsAt: source.endsAt, version: 1 },
    after: { professionalId: "p", startsAt: destination.startsAt, endsAt: destination.endsAt, version: 2,
      privateLease: next, privateLeaseCleanup: { originalAuditId: "origin" } } };
  const current = { id: "a", merchantId: "m", professionalId: "p", startsAt: new Date(destination.startsAt), endsAt: new Date(destination.endsAt), version: 2, operationalStatus: "scheduled" };
  const active = new Set(["source-a", "sibling-b", "dest-c", "newer-d"]); let effects = 0, calls = 0, reads = 0, fail = "";
  const tx = { $queryRaw: async () => [{ now }], outboxMessage: { findFirst: async () => {
    reads++; if (fail === "after-redis" && reads === 2) { fail = ""; throw Error("synthetic_after_redis"); } return outbox; } },
    appointmentAudit: { findFirst: async ({ where }: any) => where.id === "origin" ? original : moved },
    serviceAppointment: { findFirst: async () => current } };
  const prisma = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  const events = new InMemoryDomainEventBus(), tenant = { get: () => null, run: (_scope: unknown, work: () => unknown) => work() } as unknown as TenantContextService;
  const consumer = new ServiceAppointmentHoldCleanupConsumer(prisma, events, tenant, () => ({ releaseCaptured: async (merchantId, proof) => {
    calls++; assert.equal(merchantId, "m"); assert.deepEqual(proof, old);
    if (fail === "redis") { fail = ""; throw Error("synthetic_redis_error"); }
    if (active.delete(proof.target.slotId)) effects++; return { released: true };
  } }));
  return { consumer, events, event, outbox, original, moved, current, old, next, source, destination, active,
    get calls() { return calls; }, get effects() { return effects; }, fail: (stage: string) => { fail = stage; }, resetReads: () => { reads = 0; } };
}

test("T34 committed historical reschedule source cleanup", async t => {
  await t.test("registers a separate stable handler without widening cancellation's event grammar", async () => {
    const f = fixture(); f.consumer.onModuleInit();
    assert.equal(f.events.handlersFor(SERVICE_APPOINTMENT_RESCHEDULE_HOLD_CLEANUP)[0].handlerId, "service-appointment-reschedule-hold-cleanup-v1");
    assert.equal(f.events.handlersFor(SERVICE_APPOINTMENT_HOLD_CLEANUP)[0].handlerId, "service-appointment-hold-cleanup-v1");
    await f.consumer.handle(f.event); assert.equal(f.effects, 1); assert.deepEqual([...f.active], ["sibling-b", "dest-c", "newer-d"]);
  });
  await t.test("later legitimate moves cancellation or financial versions retain historical source authority", async () => {
    for (const status of ["pending", "scheduled", "completed", "cancelled"]) {
      const f = fixture(); Object.assign(f.current, { version: 7, operationalStatus: status, professionalId: "later", startsAt: new Date("2030-01-03T12:00Z") });
      await f.consumer.handle(f.event); assert.equal(f.effects, 1); assert.ok(f.active.has("dest-c")); assert.ok(f.active.has("newer-d"));
    }
  });
  await t.test("explicit new none binding permits source cleanup and cannot resurrect an old binding", async () => {
    const f = fixture(); f.moved.after.privateLease = noAppointmentLease(f.destination, "hold_off");
    await f.consumer.handle(f.event); assert.equal(f.effects, 1); assert.ok(f.active.has("sibling-b"));
  });
  await t.test("forged event claim cancel payload stale lease or private pointer mismatch cannot release", async () => {
    const forged = fixture(); await assert.rejects(forged.consumer.handle({ ...forged.event, deliveryLeaseToken: "claim" }), /service_reschedule_hold_cleanup_claim_required/);
    assert.equal(forged.calls, 0);
    const stale = fixture(); stale.outbox.leaseToken = "new-claim";
    await assert.rejects(stale.consumer.handle(stale.event), /service_reschedule_hold_cleanup_lease_lost/); assert.equal(stale.calls, 0);
    const wrong = fixture(); wrong.moved.after.privateLeaseCleanup.originalAuditId = "other";
    await assert.rejects(wrong.consumer.handle(wrong.event), /service_reschedule_hold_cleanup_original_required/); assert.equal(wrong.calls, 0);
    for (const eventType of [SERVICE_APPOINTMENT_RESCHEDULE_HOLD_CLEANUP, SERVICE_APPOINTMENT_HOLD_CLEANUP]) {
      const f = fixture(), crossed = { ...f.event, eventType, payload: eventType === SERVICE_APPOINTMENT_HOLD_CLEANUP
        ? { originalAuditId: "origin", appointmentId: "a", rescheduleVersion: 2 }
        : { originalAuditId: "origin", appointmentId: "a", cancelVersion: 2 } };
      Object.defineProperty(crossed, "deliveryLeaseToken", { value: "claim", enumerable: false });
      await assert.rejects(f.consumer.handle(crossed), /cleanup_claim_required/); assert.equal(f.calls, 0);
    }
  });
  await t.test("source before must match original capture and new binding cannot reuse the same generation", async () => {
    for (const change of [(f: ReturnType<typeof fixture>) => { f.moved.before.professionalId = "foreign"; },
      (f: ReturnType<typeof fixture>) => { f.moved.after.privateLease = f.old; },
      (f: ReturnType<typeof fixture>) => { f.original.merchantId = "foreign"; }]) {
      const f = fixture(); change(f); await assert.rejects(f.consumer.handle(f.event), /service_reschedule_hold_cleanup_original_required/); assert.equal(f.calls, 0);
    }
  });
  await t.test("Redis failure remains durable and crash after Redis before acknowledgment replays idempotently", async () => {
    const f = fixture(); f.fail("redis"); await assert.rejects(f.consumer.handle(f.event), /synthetic_redis_error/); assert.equal(f.effects, 0);
    f.fail("after-redis"); f.resetReads(); await assert.rejects(f.consumer.handle(f.event), /synthetic_after_redis/); assert.equal(f.effects, 1);
    f.resetReads(); await f.consumer.handle(f.event); assert.equal(f.effects, 1); assert.ok(f.active.has("sibling-b")); assert.ok(f.active.has("dest-c"));
  });
});
