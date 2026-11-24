import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createNativeServiceJourneyFixture } from "./service-channel-journey.fixture.js";
import { lockSupportResource } from "../src/modules/support/application/support-persistence.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// Source-only proposed regression. Actual signed ingress/worker/SQL, a real
// advisory support lock, and a changed persisted lease identity. Captured
// final transport is local; this is not provider delivery or a second-worker
// claim test. No clock, timeout, resource limit or authority override is used.
test("C21 already-human lease replacement while awaiting the real support lock admits no stale intake writes", { timeout: SERVICE_LOCAL_TEST_MS }, async () => {
  const f = await createNativeServiceJourneyFixture({ serviceReleaseFixture: "matching" });
  let release: (() => void) | undefined, holding: Promise<unknown> | undefined;
  try {
    const c = await f.make("c21-support-lock-lease");
    await f.review(c); await f.choose(c, "continue"); await f.choose(c, "confirm"); const appointment = (await f.snapshot(c)).appointments[0]!;
    await f.message(c, "Falar com atendente"); const session = await f.read(c);
    const binding = await f.prisma.whatsAppHandoffBinding.findFirstOrThrow({ where: { merchantId: c.merchantId, whatsappSessionId: session.id } });
    assert.equal(binding.mode, "waiting_human"); assert.ok(binding.ticketId);
    const snapshot = async () => ({ domain: await f.snapshot(c),
      messages: await f.prisma.supportTicketMessage.findMany({ where: { ticketId: binding.ticketId! }, orderBy: { id: "asc" } }),
      events: await f.prisma.outboxMessage.findMany({ where: { merchantId: c.merchantId, producer: "support" },
        select: { eventId: true, eventType: true, merchantId: true, payload: true, causationId: true, correlationId: true }, orderBy: { eventId: "asc" } }),
      binding: await f.prisma.whatsAppHandoffBinding.findUniqueOrThrow({ where: { id: binding.id } }) });
    const before = await snapshot();
    let announced!: (pid: number) => void;
    const locked = new Promise<number>(resolve => { announced = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    holding = f.prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pg_backend_pid()::integer AS pid`);
      await lockSupportResource(tx, "support:" + binding.ticketId!); announced(row!.pid); await released;
    });
    const blocker = await locked;
    const wire = f.wire(c, "Preciso remarcar o agendamento #" + appointment.id), raw = JSON.stringify(wire.payload);
    const response = await f.request("/webhooks/whatsapp/meta", wire.payload, { "x-hub-signature-256": f.runtime.whatsapp.signature(raw) });
    assert.equal(response.status, 200); assert.deepEqual(response.body, { received: true });
    const inbox = await f.wait(async () => { const row = await f.prisma.whatsAppWebhookInbox.findFirst({ where: { eventId: wire.eventId } });
      return row?.status === "processing" && row.leaseToken ? row : undefined; }, "actual_c21_inbox_was_not_claimed");
    const waiting = await f.wait(async () => { const rows = await f.prisma.$queryRaw<Array<{ pid: number }>>(Prisma.sql`
      SELECT pid::integer AS pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND ${blocker}::integer=ANY(pg_blocking_pids(pid))
    `); return rows[0]; }, "actual_c21_worker_did_not_wait_on_support_lock");
    assert.notEqual(waiting.pid, blocker);
    // Run-owned durable lease mutation precondition. Keep the ORIGINAL expiry
    // and all guards; a second valid worker is not started or impersonated.
    const replacement = randomUUID();
    const changed = await f.prisma.$executeRaw(Prisma.sql`
      UPDATE whatsapp_webhook_inbox SET lease_token=${replacement}
      WHERE id=${inbox.id} AND merchant_id=${c.merchantId} AND status='processing' AND lease_token=${inbox.leaseToken}
    `); assert.equal(changed, 1);
    release!(); await holding; holding = undefined;
    await f.wait(async () => { const rows = await f.prisma.$queryRaw<Array<{ finished: boolean }>>(Prisma.sql`
      SELECT xact_start IS NULL AS finished FROM pg_stat_activity WHERE pid=${waiting.pid}::integer
    `); return rows[0]?.finished === true; }, "actual_c21_blocked_writer_transaction_did_not_finish");
    assert.deepEqual(await snapshot(), before, "a stale lease must not persist a buyer message, context or support event before receipt rejection");
    const current = await f.prisma.whatsAppWebhookInbox.findUniqueOrThrow({ where: { id: inbox.id } });
    assert.equal(current.leaseToken, replacement); assert.equal(current.status, "processing");
    assert.equal((current.responseState as any)?.receipt?.inboxId, undefined);
    assert.equal(await f.prisma.supportTicketMessage.count({ where: { ticketId: binding.ticketId!, metadata: { path: ["inboxId"], equals: inbox.id } } }), 0);
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally {
    release?.(); if (holding) await holding; await f.close();
  }
});
