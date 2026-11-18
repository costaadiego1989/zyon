import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Redis } from "ioredis";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { parseAppointmentLease } from "../src/shared/bookings/appointment-lease-proof.js";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

const cleanupType = "service.appointment.reschedule_hold_cleanup_requested";
test("T34 served versioned bindings and historical source cleanup", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture(); let redis: Redis | undefined;
  try {
    redis = new Redis(f.runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), f.runtime.redis.runId);
    const store = new RedisServiceSlots(redis), merchantId = f.owner.merchant_id;
    await f.runtime.db.sql("CREATE FUNCTION t34_delay_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN ('service.appointment.reschedule_hold_cleanup_requested','service.appointment.hold_cleanup_requested') THEN NEW.next_attempt_at=clock_timestamp()+interval '1 hour'; END IF; RETURN NEW; END $$; CREATE TRIGGER t34_delay_cleanup BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t34_delay_cleanup();");
    const policy = async (enabled: boolean) => {
      const current = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId } });
      const result = await f.request("/merchants/me/service-business-policy", { expectedVersion: current.version, paymentMode: "at_attendance",
        holdEnabled: enabled, ...(enabled ? { holdMinutes: 7 } : {}), admissionsEnabled: true }, f.owner, "PUT");
      assert.equal(result.status, 200, JSON.stringify(result)); return result.body;
    };
    const prepare = async (suffix: string) => {
      const c = await f.prepare(suffix), current = await policy(true);
      const result = await f.request(f.prefix() + "/manual", { ...c.command, commandId: "held-" + suffix,
        expectedPolicyVersion: current.version, startsAt: c.date + "T10:20:00.000Z" }); assert.equal(result.status, 201, JSON.stringify(result));
      const original = await f.prisma.appointmentAudit.findFirstOrThrow({ where: { appointmentId: result.body.appointment.id, action: "manual_create" } });
      const capture = parseAppointmentLease((original.after as any).privateLease); assert.ok(capture?.kind === "owned");
      return { ...c, appointment: result.body.appointment, original, capture };
    };
    const quote = async (c: any) => {
      const destination = { professionalId: c.professional.id, expectedProfessionalVersion: c.professional.version, startsAt: c.date + "T10:40:00.000Z" };
      const result = await f.request(f.prefix() + "/" + c.appointment.id + "/reschedule-quote", { expectedVersion: 1, destination });
      assert.equal(result.status, 201, JSON.stringify(result)); return { destination, expectedVersion: 1, commandId: "move-" + c.appointment.id,
        operatorRequestId: "human-move", policyHash: result.body.quote.policyHash, acceptedQuoteHash: result.body.quoteHash };
    };
    const move = (c: any, command: unknown) => f.request(f.prefix() + "/" + c.appointment.id + "/reschedule", command);
    const pending = async (c: any, eventType = cleanupType) => {
      const event = await f.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId, correlationId: c.appointment.id, eventType } });
      assert.equal(event.status, "pending"); return event;
    };
    const dispatch = async (eventId: string, handler = "service-appointment-reschedule-hold-cleanup-v1") => {
      await f.prisma.outboxMessage.update({ where: { eventId }, data: { nextAttemptAt: null } });
      const deadline = Date.now() + 10_000; let row;
      do { row = await f.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId } }); if (row.status === "delivered") break;
        await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < deadline);
      assert.equal(row!.status, "delivered", JSON.stringify(row)); assert.ok(await f.prisma.outboxHandlerExecution.findUnique({
        where: { eventId_handlerId: { eventId, handlerId: handler } } }));
    };
    const cancel = async (c: any, version: number) => {
      const policies = await f.request(f.prefix() + "/" + c.appointment.id + "/operation-policy", undefined, f.owner, "GET"); assert.equal(policies.status, 200);
      const result = await f.request(f.prefix() + "/" + c.appointment.id + "/cancel", { commandId: "cancel-" + c.appointment.id,
        expectedVersion: version, operatorRequestId: "human-cancel", policyHash: policies.body.hash }); assert.equal(result.status, 201, JSON.stringify(result));
    };
    await t.test("new deployed mirrored constraint protects the complete historical reschedule receipt", async () => {
      const name = "20261118010000_service_reschedule_receipt", bytes = readFileSync(new URL("../prisma/deploy-migrations/" + name + "/migration.sql", import.meta.url));
      assert.deepEqual(bytes, readFileSync(new URL("../prisma/migrations/" + name + "/migration.sql", import.meta.url)));
      assert.equal(await f.runtime.db.sql("SELECT checksum FROM _prisma_migrations WHERE migration_name='" + name + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;"), createHash("sha256").update(bytes).digest("hex"));
      const c = await prepare("reschedule-private-history"), before = await f.snapshot(c.appointment.id), response = await move(c, await quote(c)); assert.equal(response.status, 201, JSON.stringify(response));
      const moved = await f.prisma.appointmentAudit.findFirstOrThrow({ where: { appointmentId: c.appointment.id, action: "reschedule" } });
      const next = parseAppointmentLease((moved.after as any).privateLease); assert.ok(next?.kind === "owned"); assert.notEqual(next.generation, c.capture.generation);
      assert.equal(moved.version, 2); assert.equal((moved.before as any).startsAt, c.capture.target.startsAt); assert.deepEqual((await f.snapshot(c.appointment.id)).balances, before.balances);
      for (const secret of ["privateLease", "privateLeaseCleanup", c.capture.generation, next.generation, next.ownerHash]) assert.equal(JSON.stringify(response).includes(secret), false);
      for (const data of [{ before: { ...(moved.before as any), professionalId: "forged" } }, { action: "manual_create" }, { after: { ...(moved.after as any), priceInCents: 1 } }])
        await assert.rejects(f.prisma.appointmentAudit.update({ where: { id: moved.id }, data }), /service_reschedule_receipt_immutable/);
      const event = await pending(c); assert.deepEqual(event.payload, { originalAuditId: c.original.id, appointmentId: c.appointment.id, rescheduleVersion: 2 });
      // A later legitimate cancellation must select the NEW binding; both old
      // historical cleanup and current cancellation may then run in either order.
      await cancel(c, 2); const cancelled = await pending(c, "service.appointment.hold_cleanup_requested");
      assert.equal((cancelled.payload as any).originalAuditId, moved.id);
      await dispatch(event.eventId); assert.equal(await redis!.hexists(store.resourceKey(merchantId, c.capture.target.resourceId), c.capture.ownerHash), 0);
      assert.equal(await redis!.hexists(store.resourceKey(merchantId, next.target.resourceId), next.ownerHash), 1);
      await dispatch(cancelled.eventId, "service-appointment-hold-cleanup-v1"); assert.equal(await redis!.hexists(store.resourceKey(merchantId, next.target.resourceId), next.ownerHash), 0);
    });
    await t.test("moving held to hold-off records latest none so later cancellation never falls back to the origin", async () => {
      const c = await prepare("reschedule-to-none"); await policy(false); const result = await move(c, await quote(c)); assert.equal(result.status, 201, JSON.stringify(result));
      const moved = await f.prisma.appointmentAudit.findFirstOrThrow({ where: { appointmentId: c.appointment.id, action: "reschedule" } });
      assert.equal((moved.after as any).privateLease.kind, "none"); await cancel(c, 2);
      assert.equal(await f.prisma.outboxMessage.count({ where: { correlationId: c.appointment.id, eventType: "service.appointment.hold_cleanup_requested" } }), 0);
      await dispatch((await pending(c)).eventId); assert.equal(await redis!.hexists(store.resourceKey(merchantId, c.capture.target.resourceId), c.capture.ownerHash), 0);
    });
    await t.test("real SQL rejection preserves original and exact-cleans only the prepared destination", async () => {
      const c = await prepare("reschedule-private-rollback"), command = await quote(c), before = await f.snapshot(c.appointment.id);
      const key = store.resourceKey(merchantId, c.capture.target.resourceId), raw = await redis!.hget(key, c.capture.ownerHash);
      await f.runtime.db.sql("CREATE FUNCTION t34_reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.reschedule_hold_cleanup_requested' THEN RAISE EXCEPTION 'synthetic_reschedule_cleanup_rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER t34_reject_cleanup BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t34_reject_cleanup();");
      try { assert.equal((await move(c, command)).status, 500); assert.deepEqual(await f.snapshot(c.appointment.id), before);
        assert.equal(await redis!.hget(key, c.capture.ownerHash), raw); assert.equal(await redis!.hlen(key), 1);
        assert.equal(await f.prisma.outboxMessage.count({ where: { correlationId: c.appointment.id, eventType: cleanupType } }), 0);
      } finally { await f.runtime.db.sql("DROP TRIGGER t34_reject_cleanup ON outbox_messages; DROP FUNCTION t34_reject_cleanup();"); }
    });
    await t.test("real Redis error retains durable source cleanup until the registered worker retries", async () => {
      const c = await prepare("reschedule-private-retry"), result = await move(c, await quote(c)); assert.equal(result.status, 201, JSON.stringify(result));
      const event = await pending(c), key = store.resourceKey(merchantId, c.capture.target.resourceId), backup = key + ":t34-fault-backup";
      assert.equal(await redis!.exists(backup), 0); await redis!.rename(key, backup); await redis!.set(key, "synthetic-wrongtype");
      try {
        await f.prisma.outboxMessage.update({ where: { eventId: event.eventId }, data: { nextAttemptAt: null } }); const deadline = Date.now() + 10_000; let failed;
        do { failed = await f.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: event.eventId } }); if (failed.attempts > 0 && failed.status === "pending") break;
          await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < deadline);
        assert.ok(failed!.attempts > 0); assert.equal(failed!.status, "pending"); assert.equal(await f.prisma.outboxHandlerExecution.count({ where: { eventId: event.eventId } }), 0);
      } finally { await redis!.del(key); await redis!.rename(backup, key); }
      await dispatch(event.eventId); assert.equal(await redis!.hexists(key, c.capture.ownerHash), 0); assert.equal(await redis!.hlen(key), 1);
    });
  } finally { redis?.disconnect(); await f.close(); }
});
