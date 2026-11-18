import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Redis } from "ioredis";
import type { Prisma } from "@prisma/client";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { parseAppointmentLease } from "../src/shared/bookings/appointment-lease-proof.js";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

const cleanupType = "service.appointment.hold_cleanup_requested";
test("T33 served cancellation original hold cleanup", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture(); let redis: Redis | undefined;
  try {
    redis = new Redis(f.runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000,
      connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), f.runtime.redis.runId);
    const store = new RedisServiceSlots(redis), merchantId = f.owner.merchant_id;
    // Test-only queue hold. The served application still performs normal claims,
    // the registered consumer and durable acknowledgments when explicitly woken.
    await f.runtime.db.sql("CREATE FUNCTION t33_delay_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.hold_cleanup_requested' THEN NEW.next_attempt_at=clock_timestamp()+interval '1 hour'; END IF; RETURN NEW; END $$; CREATE TRIGGER t33_delay_cleanup BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t33_delay_cleanup();");
    const policy = async (mode: "online" | "at_attendance") => {
      const current = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId } });
      const response = await f.request("/merchants/me/service-business-policy", { expectedVersion: current.version,
        paymentMode: mode, holdEnabled: true, holdMinutes: 7, admissionsEnabled: true }, f.owner, "PUT");
      assert.equal(response.status, 200, JSON.stringify(response)); return response.body;
    };
    const original = async (appointmentId: string) => {
      const row = await f.prisma.appointmentAudit.findFirstOrThrow({ where: { merchantId, appointmentId,
        after: { path: ["privateLease", "kind"], equals: "owned" } } });
      const capture = parseAppointmentLease((row.after as any).privateLease); assert.ok(capture?.kind === "owned");
      return { row, capture };
    };
    const assertPrivate = (response: unknown, capture: Awaited<ReturnType<typeof original>>["capture"]) => {
      const json = JSON.stringify(response);
      for (const secret of [capture.generation, capture.ownerHash, "privateLease", "privateLeaseCleanup"])
        assert.equal(json.includes(secret), false, "private hold capture must not be a public response");
    };
    const cancel = async (appointment: any) => {
      const view = await f.request(f.prefix() + "/" + appointment.id + "/operation-policy", undefined, f.owner, "GET");
      assert.equal(view.status, 200, JSON.stringify(view));
      return f.request(f.prefix() + "/" + appointment.id + "/cancel", { expectedVersion: appointment.version,
        commandId: "cancel-" + appointment.id, operatorRequestId: "human-" + appointment.id, policyHash: view.body.hash });
    };
    const pending = async (appointmentId: string) => {
      const event = await f.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId, correlationId: appointmentId,
        eventType: cleanupType, producer: "service-booking-private" } });
      assert.equal(event.status, "pending"); assert.equal(event.attempts, 0); return event;
    };
    const dispatch = async (eventId: string) => {
      await f.prisma.outboxMessage.update({ where: { eventId }, data: { nextAttemptAt: null } });
      const deadline = Date.now() + 10_000; let row;
      do {
        row = await f.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId } });
        if (row.status === "delivered") break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      assert.equal(row!.status, "delivered", JSON.stringify(row));
      assert.ok(await f.prisma.outboxHandlerExecution.findUnique({ where: { eventId_handlerId: {
        eventId, handlerId: "service-appointment-hold-cleanup-v1" } } }));
    };
    const manual = async (suffix: string, mode: "online" | "at_attendance" = "at_attendance") => {
      const seed = await f.prepare(suffix, mode), current = await policy(mode);
      const response = await f.request(f.prefix() + "/manual", { ...seed.command, commandId: "held-" + suffix,
        expectedPolicyVersion: current.version, startsAt: seed.date + "T10:20:00.000Z" });
      assert.equal(response.status, 201, JSON.stringify(response));
      return { ...seed, appointment: response.body.appointment, response };
    };
    const embed = async (token: string, origin: string, path: string, body: unknown) => {
      const response = await fetch(f.runtime.apiOrigin + path, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "x-aacp-embed-token": token, origin }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const buyer = async (suffix: string, count: number) => {
      const seeds = []; for (let i = 0; i < count; i++) seeds.push(await f.prepare(suffix + "-" + i));
      const current = await policy("at_attendance"), origin = "https://t33-cleanup.example.test";
      await f.prisma.merchantBillingSubscription.upsert({ where: { merchantId },
        create: { merchantId, planKey: "starter", status: "active" }, update: { planKey: "starter", status: "active" } });
      if (!await f.prisma.merchantRule.findUnique({ where: { merchantId } })) await f.prisma.merchantRule.create({ data: {
        merchantId, maxDiscountPercent: 0, minimumMarginPercent: 0, allowFreeShipping: false, allowShippingDiscount: false,
        allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false, autonomousEngineEnabled: false,
        freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0, offerExpirationMinutes: 10,
        blockedRegions: [], brandVoice: "Cordial", originZip: "01310000" } });
      const issued = await f.request("/embed-sessions", { allowed_origin: origin, scopes: ["checkout:start", "checkout:track", "appointments:confirm"] });
      assert.equal(issued.status, 201, JSON.stringify(issued)); const token = issued.body.embed_session_token;
      const cart = { currency: "BRL", total: count * 50, items: seeds.map(seed => ({ sku: seed.product.variants[0].sku,
        product_id: seed.product.id, variantId: seed.product.variants[0].id, name: "Synthetic public service", price: 50, quantity: 1,
        productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: { slotId: "display-only",
          professionalId: seed.professional.id, professionalVersion: seed.professional.version, policyVersion: current.version,
          date: seed.date, startsAt: seed.date + "T10:20:00.000Z", endsAt: seed.date + "T10:40:00.000Z", timeZone: "UTC", durationMinutes: 20 } })) };
      const start = await embed(token, origin, "/embed/start", { cart, customer: { fullName: "Synthetic buyer", email: "buyer@t33.example.test" } });
      assert.equal(start.status, 201, JSON.stringify(start)); const sessionId = start.body.session_id;
      const command = { session_id: sessionId, command_id: "confirm-" + suffix, cart_fingerprint: start.body.service_checkout.cart_fingerprint };
      const confirm = await embed(token, origin, "/embed/service-appointments/confirm", command);
      assert.equal(confirm.status, 201, JSON.stringify(confirm)); assert.equal(confirm.body.appointments.length, count);
      return { token, origin, command, sessionId, appointments: confirm.body.appointments, confirm };
    };
    await t.test("the actual configured migration deploy applies the exact mirrored private receipt constraints", async () => {
      const name = "20261118000000_service_appointment_original_lease";
      const deployed = readFileSync(new URL("../prisma/deploy-migrations/" + name + "/migration.sql", import.meta.url));
      const mirror = readFileSync(new URL("../prisma/migrations/" + name + "/migration.sql", import.meta.url));
      assert.deepEqual(deployed, mirror);
      const checksum = createHash("sha256").update(deployed).digest("hex");
      assert.equal(await f.runtime.db.sql("SELECT checksum FROM _prisma_migrations WHERE migration_name='" + name
        + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;"), checksum);
    });
    await t.test("real local and pending manual acquisitions retain proof across receipt rewrite and private cleanup", async () => {
      for (const mode of ["online", "at_attendance"] as const) {
        const c = await manual("private-manual-" + mode, mode), { row, capture } = await original(c.appointment.id);
        assert.equal(row.action, "manual_create"); assert.equal(c.appointment.operationalStatus, mode === "online" ? "pending" : "scheduled");
        assertPrivate(c.response, capture); const before = await f.snapshot(c.appointment.id);
        const result = await cancel(c.appointment); assert.equal(result.status, 201, JSON.stringify(result)); assertPrivate(result, capture);
        const event = await pending(c.appointment.id); assert.deepEqual(event.payload, { originalAuditId: row.id, appointmentId: c.appointment.id, cancelVersion: 2 });
        assert.equal(JSON.stringify(event.payload).includes(capture.generation), false);
        assert.equal(await redis!.hexists(store.resourceKey(merchantId, capture.target.resourceId), capture.ownerHash), 1);
        await dispatch(event.eventId);
        assert.equal(await redis!.hexists(store.resourceKey(merchantId, capture.target.resourceId), capture.ownerHash), 0);
        assert.deepEqual((await f.snapshot(c.appointment.id)).balances, before.balances);
      }
    });
    await t.test("real two-slot buyer cancellation keeps the sibling lease and SQL appointment untouched", async () => {
      const c = await buyer("cart-ab", 2), [a, b] = c.appointments;
      const first = await original(a.id), second = await original(b.id); assertPrivate(c.confirm, first.capture);
      assert.equal(first.row.action, "checkout_confirm"); assert.equal(first.capture.generation, second.capture.generation);
      const siblingBefore = await f.snapshot(b.id), originalHold = await store.get(merchantId, c.sessionId); assert.equal(originalHold!.slots.length, 2);
      const result = await cancel(a); assert.equal(result.status, 201, JSON.stringify(result));
      await dispatch((await pending(a.id)).eventId);
      const remaining = await store.get(merchantId, c.sessionId); assert.deepEqual(remaining!.slots, [second.capture.target]);
      assert.equal(remaining!.expiresAt, originalHold!.expiresAt); assert.deepEqual(await f.snapshot(b.id), siblingBefore);
      assert.equal((await store.assertActive(merchantId, c.sessionId, remaining!.slots)).generation, second.capture.generation);
    });
    await t.test("old generation cannot bind a new attempt while cleanup is pending; delayed cleanup preserves same-owner new generation", async () => {
      const c = await buyer("cart-aba", 1), a = c.appointments[0], { capture } = await original(a.id);
      assert.equal((await cancel(a)).status, 201); const event = await pending(a.id);
      const before = await f.prisma.serviceAppointment.count({ where: { merchantId } });
      const reused = await embed(c.token, c.origin, "/embed/service-appointments/confirm", { ...c.command, command_id: "new-attempt-old-generation" });
      assert.equal(reused.status, 409, JSON.stringify(reused)); assert.match(JSON.stringify(reused.body), /service_hold_generation_consumed/);
      assert.equal(await f.prisma.serviceAppointment.count({ where: { merchantId } }), before);
      const hold = await store.get(merchantId, c.sessionId); assert.ok(hold);
      await store.release(merchantId, c.sessionId); await store.acquire(merchantId, c.sessionId, hold.slots, 420_000);
      const newer = await store.assertActive(merchantId, c.sessionId, hold.slots); assert.notEqual(newer.generation, capture.generation); assert.equal(newer.fingerprint, capture.fingerprint);
      const parent = await redis!.get(store.checkoutKey(merchantId, c.sessionId));
      await dispatch(event.eventId); assert.equal(await redis!.get(store.checkoutKey(merchantId, c.sessionId)), parent);
      assert.equal((await store.assertActive(merchantId, c.sessionId, hold.slots)).generation, newer.generation);
    });
    await t.test("private-intent SQL rollback preserves the original held manual target and all prior SQL facts", async () => {
      const c = await manual("private-rollback"), { capture } = await original(c.appointment.id), before = await f.snapshot(c.appointment.id);
      const resource = store.resourceKey(merchantId, capture.target.resourceId), raw = await redis!.hget(resource, capture.ownerHash);
      await f.runtime.db.sql("CREATE FUNCTION t33_reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.hold_cleanup_requested' THEN RAISE EXCEPTION 'synthetic_private_cleanup_rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER t33_reject_cleanup BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t33_reject_cleanup();");
      try {
        assert.equal((await cancel(c.appointment)).status, 500); assert.deepEqual(await f.snapshot(c.appointment.id), before);
        assert.equal(await redis!.hget(resource, capture.ownerHash), raw);
        assert.equal(await f.prisma.outboxMessage.count({ where: { eventType: cleanupType, correlationId: c.appointment.id } }), 0);
      } finally { await f.runtime.db.sql("DROP TRIGGER IF EXISTS t33_reject_cleanup ON outbox_messages; DROP FUNCTION IF EXISTS t33_reject_cleanup();"); }
    });
    let heldForForeignScope: Awaited<ReturnType<typeof manual>> | undefined;
    await t.test("SQL immutable capture and unique generation-target constraint survive manual action rewrites", async () => {
      const c = await manual("private-index"), { row, capture } = await original(c.appointment.id); heldForForeignScope = c; assert.equal(row.action, "manual_create");
      await assert.rejects(f.prisma.appointmentAudit.update({ where: { id: row.id }, data: { after: { operationalStatus: "scheduled" } } }), /service_hold_capture_immutable/);
      await assert.rejects(f.prisma.appointmentAudit.update({ where: { id: row.id }, data: { commandId: "retroactive-admission" } }), /service_hold_capture_immutable/);
      await f.prisma.appointmentAudit.update({ where: { id: row.id }, data: { action: "manual_create" } });
      const before = await f.prisma.serviceAppointment.count({ where: { merchantId } });
      await assert.rejects(f.prisma.$transaction(async tx => {
        const source = await tx.serviceAppointment.findUniqueOrThrow({ where: { id: c.appointment.id } });
        const another = await tx.serviceAppointment.create({ data: { ...source, id: randomUUID(), operationalStatus: "pending",
          idempotencyKey: randomUUID(), customerSnapshot: source.customerSnapshot as Prisma.InputJsonValue,
          policySnapshot: source.policySnapshot as Prisma.InputJsonValue } });
        await tx.appointmentAudit.create({ data: { merchantId, appointmentId: another.id, commandId: randomUUID(), version: 1,
          action: "manual_create", actorId: f.owner.user_id, origin: "manual", after: { privateLease: capture } } });
      }), /Unique constraint|P2002|appointment_audits_owned_lease_target_key/);
      assert.equal(await f.prisma.serviceAppointment.count({ where: { merchantId } }), before);
      assert.deepEqual((await original(c.appointment.id)).capture, capture);
    });
    await t.test("an actual Redis command error leaves durable pending work and the normal retry later completes", async () => {
      const c = await manual("private-redis-retry"), { capture } = await original(c.appointment.id);
      assert.equal((await cancel(c.appointment)).status, 201); const event = await pending(c.appointment.id);
      const resource = store.resourceKey(merchantId, capture.target.resourceId), backup = resource + ":t33-fault-backup";
      assert.equal(await redis!.hlen(resource), 1); assert.equal(await redis!.exists(backup), 0);
      // Fault only this new synthetic professional's owned index, preserving the
      // full hash and TTL under an isolated backup while HGET returns WRONGTYPE.
      await redis!.rename(resource, backup); await redis!.set(resource, "synthetic-t33-wrong-type");
      try {
        await f.prisma.outboxMessage.update({ where: { eventId: event.eventId }, data: { nextAttemptAt: null } });
        const deadline = Date.now() + 10_000; let failed;
        do {
          failed = await f.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: event.eventId } });
          if (failed.status === "pending" && failed.attempts > 0) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        } while (Date.now() < deadline);
        assert.equal(failed!.status, "pending", JSON.stringify(failed)); assert.ok(failed!.attempts > 0);
        assert.ok(failed!.nextAttemptAt); assert.equal(failed!.deliveredAt, null);
        assert.equal(await f.prisma.outboxHandlerExecution.count({ where: { eventId: event.eventId } }), 0);
        assert.equal((await f.snapshot(c.appointment.id)).appointment.operationalStatus, "cancelled");
      } finally {
        assert.equal(await redis!.get(resource), "synthetic-t33-wrong-type");
        await redis!.del(resource); await redis!.rename(backup, resource);
      }
      await dispatch(event.eventId);
      assert.equal(await redis!.hexists(resource, capture.ownerHash), 0);
    });
    await t.test("foreign operator cannot cancel or alter a captured held target", async () => {
      assert.ok(heldForForeignScope);
      const c = heldForForeignScope, { capture } = await original(c.appointment.id), before = await f.snapshot(c.appointment.id);
      const raw = await redis!.hget(store.resourceKey(merchantId, capture.target.resourceId), capture.ownerHash);
      assert.equal(before.appointment.operationalStatus, "scheduled");
      assert.equal(before.appointment.version, 1);
      assert.notEqual(raw, null);
      const response = await f.request(f.prefix() + "/" + c.appointment.id + "/cancel", { expectedVersion: 1,
        commandId: "foreign-held", operatorRequestId: "foreign", policyHash: "a".repeat(64) }, f.foreign);
      assert.equal(response.status, 403); assert.deepEqual(await f.snapshot(c.appointment.id), before);
      assert.equal(await redis!.hget(store.resourceKey(merchantId, capture.target.resourceId), capture.ownerHash), raw);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { redis?.disconnect(); await f.close(); }
});
