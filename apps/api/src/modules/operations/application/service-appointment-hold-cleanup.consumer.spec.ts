import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";
import { captureAppointmentLease } from "../../../shared/bookings/appointment-lease-proof.js";
import { slotFingerprint } from "../../../shared/bookings/redis-service-slots.js";
import { ServiceAppointmentHoldCleanupConsumer, SERVICE_APPOINTMENT_HOLD_CLEANUP } from "./service-appointment-hold-cleanup.consumer.js";
function fixture() {
  const now = new Date("2030-01-02T09:00:00Z"), slot = { resourceId: "professional:p", slotId: "slot-a", startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T10:20:00.000Z" };
  const proof = captureAppointmentLease("m", "checkout", { merchantId: "m", ownerHash: createHash("sha256").update("checkout").digest("hex"),
    generation: "00000000-0000-4000-8000-000000000001", fingerprint: slotFingerprint([slot]), slots: [slot], expiresAt: "2030-01-02T09:17:00.000Z" }, slot);
  const event = { eventId: "private-event", eventType: SERVICE_APPOINTMENT_HOLD_CLEANUP, merchantId: "m", schemaVersion: 1,
    correlationId: "a", causationId: "cancel-command", payload: { originalAuditId: "original", appointmentId: "a", cancelVersion: 2 } };
  Object.defineProperty(event, "deliveryLeaseToken", { value: "original-claim", enumerable: false });
  const row: any = { ...event, producer: "service-booking-private", status: "processing", leaseToken: "original-claim", leaseExpiresAt: new Date(now.getTime() + 30_000) };
  const original: any = { id: "original", merchantId: "m", appointmentId: "a", version: 1, after: { privateLease: proof } };
  const cancelled: any = { id: "cancel-audit", merchantId: "m", appointmentId: "a", version: 2, action: "cancel", commandId: "cancel-command",
    after: { operationalStatus: "cancelled", version: 2, privateLeaseCleanup: { originalAuditId: "original" } } };
  const appointment = { id: "a", merchantId: "m", professionalId: "p", startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), version: 2, operationalStatus: "cancelled" };
  const active = new Set(["slot-a", "slot-b"]); let effects = 0, calls = 0, failRedis = false, crashAfterRedis = false, reads = 0;
  const tx = { $queryRaw: async () => [{ now }],
    outboxMessage: { findFirst: async () => { reads++; if (crashAfterRedis && reads === 2) { crashAfterRedis = false; throw Error("synthetic_after_redis_before_ack"); } return row; } },
    serviceAppointment: { findFirst: async () => appointment },
    appointmentAudit: { findFirst: async ({ where }: any) => where.id === "original" ? original : cancelled },
  };
  const prisma = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  const tenant = { get: () => undefined, run: (_scope: unknown, work: () => unknown) => work() } as unknown as TenantContextService;
  const events = new InMemoryDomainEventBus();
  const store = { releaseCaptured: async (merchantId: string, capture: typeof proof) => {
    calls++; assert.equal(merchantId, "m"); assert.deepEqual(capture, proof);
    if (failRedis) { failRedis = false; throw Error("synthetic_redis_unavailable"); }
    if (active.delete(capture.target.slotId)) effects++;
    return { released: true };
  } };
  const consumer = new ServiceAppointmentHoldCleanupConsumer(prisma, events, tenant, () => store);
  return { consumer, event, row, original, cancelled, appointment, proof, active, events, get effects() { return effects; }, get calls() { return calls; },
    redisFail: () => { failRedis = true; }, crash: () => { crashAfterRedis = true; }, resetReads: () => { reads = 0; } };
}
test("T33 durable exact hold cleanup consumer", async t => {
  await t.test("registers one stable private handler and reads proof only from committed original audit", async () => {
    const f = fixture(); f.consumer.onModuleInit(); assert.equal(f.events.handlersFor(SERVICE_APPOINTMENT_HOLD_CLEANUP).length, 1);
    assert.equal(f.events.handlersFor(SERVICE_APPOINTMENT_HOLD_CLEANUP)[0].handlerId, "service-appointment-hold-cleanup-v1");
    await f.consumer.handle(f.event); assert.deepEqual([...f.active], ["slot-b"]); assert.equal(f.effects, 1);
    assert.equal(JSON.stringify(f.event).includes(f.proof.generation), false); assert.equal(JSON.stringify(f.event).includes(f.proof.ownerHash), false);
  });
  await t.test("enumerable forged or stale outbox authority performs no Redis mutation", async () => {
    const forged = fixture(); await assert.rejects(forged.consumer.handle({ ...forged.event, deliveryLeaseToken: "original-claim" }), /service_hold_cleanup_claim_required/);
    assert.equal(forged.calls, 0);
    const stale = fixture(); stale.row.leaseToken = "new-claim";
    await assert.rejects(stale.consumer.handle(stale.event), /service_hold_cleanup_lease_lost/); assert.equal(stale.calls, 0);
  });
  await t.test("foreign original proof or a different cancellation pointer cannot release another appointment", async () => {
    const foreign = fixture(); foreign.original.merchantId = "foreign";
    await assert.rejects(foreign.consumer.handle(foreign.event), /service_hold_cleanup_original_required/); assert.equal(foreign.calls, 0);
    const changed = fixture(); changed.cancelled.after.privateLeaseCleanup.originalAuditId = "different";
    await assert.rejects(changed.consumer.handle(changed.event), /service_hold_cleanup_original_required/); assert.equal(changed.calls, 0);
  });
  await t.test("later legitimate financial versions retain the immutable cancellation authority", async () => {
    const f = fixture(); f.appointment.version = 7;
    await f.consumer.handle(f.event); assert.equal(f.effects, 1); assert.deepEqual([...f.active], ["slot-b"]);
  });
  await t.test("Redis failure remains a handler failure for the existing durable dispatcher to retry", async () => {
    const f = fixture(); f.redisFail(); await assert.rejects(f.consumer.handle(f.event), /synthetic_redis_unavailable/);
    assert.deepEqual([...f.active], ["slot-a", "slot-b"]); assert.equal(f.effects, 0);
    await f.consumer.handle(f.event); assert.deepEqual([...f.active], ["slot-b"]); assert.equal(f.effects, 1);
  });
  await t.test("crash after Redis before acknowledgment replays without another effect or sibling deletion", async () => {
    const f = fixture(); f.crash(); await assert.rejects(f.consumer.handle(f.event), /synthetic_after_redis_before_ack/);
    assert.deepEqual([...f.active], ["slot-b"]); assert.equal(f.effects, 1);
    f.resetReads(); await f.consumer.handle(f.event); assert.equal(f.effects, 1); assert.equal(f.calls, 2); assert.deepEqual([...f.active], ["slot-b"]);
  });
});
