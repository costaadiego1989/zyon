import assert from "node:assert/strict";
import test from "node:test";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

test("T32 HTTP and SQL", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture();
  try {
    const transition = (a: any, action: string, expectedVersion = 1, commandId = action + "-" + a.id, auth = f.owner) =>
      f.request(f.prefix() + "/" + a.id + "/transitions", { action, expectedVersion, commandId }, auth);
    await t.test("explicit start and completion work with a pending local balance and no legacy proof/early-start gate", async () => {
      const c = await f.prepare("attendance-local"), before = await f.snapshot(c.appointment.id);
      const started = await transition(c.appointment, "start_service"); assert.equal(started.status, 201, JSON.stringify(started));
      assert.equal(started.body.appointment.operationalStatus, "in_service"); assert.equal(started.body.appointment.version, 2);
      const completed = await transition(c.appointment, "complete_service", 2); assert.equal(completed.status, 201, JSON.stringify(completed));
      const after = await f.snapshot(c.appointment.id); assert.equal(after.appointment.operationalStatus, "completed"); assert.equal(after.appointment.version, 3);
      assert.deepEqual(after.balances, before.balances); assert.equal(after.balances[0].status, "pending"); assert.equal(after.balances[0].receivedAt, null);
      assert.equal(after.audits.length, before.audits.length + 2); assert.equal(after.events.length, before.events.length + 2);
    });
    await t.test("no-show is an explicit command and neither read nor payment/time changes infer attendance", async () => {
      const c = await f.prepare("attendance-no-show"), before = await f.snapshot(c.appointment.id);
      assert.equal(before.appointment.operationalStatus, "scheduled"); assert.equal(before.appointment.noShowAt, null);
      // Synthetic local financial fact; no PSP/receipt acceptance is claimed.
      await f.prisma.appointmentPayment.updateMany({ where: { appointmentId: c.appointment.id }, data: { status: "approved", receivedAt: new Date() } });
      const financial = await f.snapshot(c.appointment.id); assert.equal(financial.appointment.operationalStatus, "scheduled"); assert.equal(financial.appointment.noShowAt, null);
      const result = await transition(c.appointment, "no_show"); assert.equal(result.status, 201, JSON.stringify(result));
      const after = await f.snapshot(c.appointment.id); assert.equal(after.appointment.operationalStatus, "no_show"); assert.ok(after.appointment.noShowAt);
      assert.deepEqual(after.balances, financial.balances); assert.equal((await transition(c.appointment, "start_service", 2, "after-no-show")).status, 409);
    });
    await t.test("original replay returns current later state without duplicate audit or outbox", async () => {
      const c = await f.prepare("attendance-replay"); assert.equal((await transition(c.appointment, "start_service", 1, "original-start")).status, 201);
      assert.equal((await transition(c.appointment, "complete_service", 2, "later-complete")).status, 201);
      const before = await f.snapshot(c.appointment.id), replay = await transition(c.appointment, "start_service", 1, "original-start");
      assert.equal(replay.status, 201); assert.equal(replay.body.replayed, true); assert.equal(replay.body.appointment.operationalStatus, "completed");
      assert.deepEqual(await f.snapshot(c.appointment.id), before);
    });
    await t.test("pending attempt, wrong state and stale version cannot be promoted by a body claim", async () => {
      const pending = await f.prepare("attendance-pending", "online"), before = await f.snapshot(pending.appointment.id);
      assert.equal((await transition(pending.appointment, "start_service")).status, 409); assert.deepEqual(await f.snapshot(pending.appointment.id), before);
      const c = await f.prepare("attendance-stale"), stable = await f.snapshot(c.appointment.id);
      assert.equal((await transition(c.appointment, "complete_service")).status, 409);
      assert.equal((await transition(c.appointment, "start_service", 2)).status, 409); assert.deepEqual(await f.snapshot(c.appointment.id), stable);
    });
    await t.test("auth, role, foreign route and strict body identity are refused without writes", async () => {
      const c = await f.prepare("attendance-scope"), before = await f.snapshot(c.appointment.id);
      assert.equal((await transition(c.appointment, "start_service", 1, "staff-denied", f.staff)).status, 403);
      assert.equal((await transition(c.appointment, "start_service", 1, "foreign-denied", f.foreign)).status, 403);
      assert.equal((await f.request(f.prefix() + "/" + c.appointment.id + "/transitions", { action: "start_service", expectedVersion: 1, commandId: "bad-body", actorId: "injected" })).status, 400);
      assert.deepEqual(await f.snapshot(c.appointment.id), before);
    });
    await t.test("actual outbox failure rolls back operational CAS and audit while leaving finance intact", async () => {
      const c = await f.prepare("attendance-rollback"), before = await f.snapshot(c.appointment.id);
      await f.runtime.db.sql("CREATE FUNCTION t32_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.in_service' THEN RAISE EXCEPTION 'synthetic_t32_event_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER t32_fail_event BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t32_fail_event();");
      try { assert.equal((await transition(c.appointment, "start_service")).status, 500); assert.deepEqual(await f.snapshot(c.appointment.id), before); }
      finally { await f.runtime.db.sql("DROP TRIGGER IF EXISTS t32_fail_event ON outbox_messages; DROP FUNCTION IF EXISTS t32_fail_event();"); }
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
