import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { advance, consume, grantCredit, reserve, restore } from "../domain/cashback.js";
import { cashbackConfigurationFixture, configurationRules as rules } from "./__tests__/cashback-configuration.fixture.js";

let f: Awaited<ReturnType<typeof cashbackConfigurationFixture>>;
before(async () => { f = await cashbackConfigurationFixture(); });
beforeEach(async () => { await f.reset(); });
after(async () => { await f?.close(); });
const period = { from: "2026-11-01T00:00:00-03:00", to: "2026-11-03T23:59:59.999-03:00" };

async function credit(amountCents: number, when: string, merchantId = "merchant-a", buyerId = "buyer-a") {
  const now = new Date(when);
  await f.repository.transaction(merchantId, async tx => {
    const wallet = await f.repository.wallet(tx, merchantId, buyerId);
    grantCredit(wallet, { orderId: randomUUID(), amountCents, eligibleBaseCents: amountCents * 20,
      rules, ruleVersion: 1, lines: [], availableAt: now.toISOString() }, now);
    advance(wallet, now);
    await f.repository.saveWallet(tx, wallet);
  });
}
async function spend(amountCents: number, when: string) {
  const now = new Date(when), orderId = randomUUID();
  await f.repository.transaction("merchant-a", async tx => {
    const wallet = await f.repository.wallet(tx, "merchant-a", "buyer-a");
    const reservation = reserve(wallet, { sessionId: randomUUID(), fingerprint: "synthetic-metrics-order", amountCents, maximumCents: amountCents }, now);
    reservation.state = "payment_pending";
    consume(wallet, reservation.id, orderId, now);
    await f.repository.saveWallet(tx, wallet);
  });
  return orderId;
}

test("CBX-03 daily cents match the isolated canonical ledger at inclusive Brasília boundaries", async () => {
  await credit(999, "2026-11-01T02:59:59.999Z");
  await credit(125, "2026-11-01T03:00:00.000Z");
  await credit(250, "2026-11-02T02:59:59.999Z");
  const spentOrder = await spend(75, "2026-11-02T03:00:00.000Z");
  await credit(375, "2026-11-03T03:00:00.000Z");
  await f.repository.transaction("merchant-a", async tx => {
    const wallet = await f.repository.wallet(tx, "merchant-a", "buyer-a");
    restore(wallet, spentOrder, 10, new Date("2026-11-03T16:00:00Z"));
    await f.repository.saveWallet(tx, wallet);
  });
  await spend(50, "2026-11-04T02:59:59.999Z");
  await credit(888, "2026-11-04T03:00:00.000Z");
  await credit(90000, "2026-11-01T04:00:00.000Z", "merchant-b");
  assert.deepEqual((await f.service.reconcile("merchant-a")).issues, []);
  const metrics = await f.queries.metrics("merchant-a", period);
  assert.deepEqual(metrics.dailyMovements, [
    { date: "2026-11-01", grantedCents: 375, redeemedCents: 0 },
    { date: "2026-11-02", grantedCents: 0, redeemedCents: 75 },
    { date: "2026-11-03", grantedCents: 375, redeemedCents: 50 },
  ]);
  assert.equal(metrics.grantedCents, 750); assert.equal(metrics.redeemedCents, 125);
  assert.equal(metrics.restoredCents, 10); assert.equal(metrics.availableCents, 2522);
  assert.equal(metrics.buyersGranted, 1); assert.equal(metrics.buyersRedeemed, 1);
  assert.equal(metrics.ordersWithCashback, 2);
  assert.equal(metrics.from, "2026-11-01T03:00:00.000Z");
  assert.equal(metrics.to, "2026-11-04T02:59:59.999Z");
});

test("daily series includes zero-valued days between genuine movements", async () => {
  await credit(101, "2026-11-03T12:00:00Z");
  const metrics = await f.queries.metrics("merchant-a", { ...period, to: "2026-11-04T23:59:59.999-03:00" });
  assert.deepEqual(metrics.dailyMovements, [
    { date: "2026-11-01", grantedCents: 0, redeemedCents: 0 },
    { date: "2026-11-02", grantedCents: 0, redeemedCents: 0 },
    { date: "2026-11-03", grantedCents: 101, redeemedCents: 0 },
    { date: "2026-11-04", grantedCents: 0, redeemedCents: 0 },
  ]);
});

test("current wallet snapshot remains visible when the selected interval has no movements", async () => {
  await credit(5000, "2025-01-01T12:00:00Z");
  const metrics = await f.queries.metrics("merchant-a", period);
  assert.equal(metrics.availableCents, 5000); assert.equal(metrics.pendingCents, 0); assert.equal(metrics.reservedCents, 0);
  assert.equal(metrics.grantedCents, 0); assert.equal(metrics.redeemedCents, 0);
  assert.equal(metrics.dailyMovements?.length, 3);
  assert.ok(metrics.dailyMovements?.every(day => day.grantedCents === 0 && day.redeemedCents === 0));
  assert.ok(Number.isFinite(Date.parse(metrics.asOf)));
  assert.notEqual(metrics.asOf.slice(0, 10), "2026-11-01");
});

test("CBX-06 budget uses the current Brasília month independently of the selected period", async () => {
  await f.service.saveDraft("merchant-a", rules, "owner-a");
  await f.service.publishProgram("merchant-a", "owner-a");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const month = `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
  await f.db.query("INSERT INTO cashback_budget_periods(merchant_id,period,committed_cents,issued_cents) VALUES($1,$2,1000,2000),($1,'2000-01',91000,8000)", ["merchant-a", month]);
  const metrics = await f.queries.metrics("merchant-a", { from: "2000-01-01T00:00:00-03:00", to: "2000-01-02T23:59:59.999-03:00" });
  assert.equal(metrics.budgetCommittedCents, 1000); assert.equal(metrics.budgetIssuedCents, 2000);
  assert.equal(metrics.budgetLimitCents, 100000); assert.equal(metrics.grantedCents, 0);
});

test("daily series preserves the maximum allowed leap-year interval and rejects an extra millisecond", async () => {
  const from = "2024-01-01T03:00:00.000Z", to = "2025-01-01T03:00:00.000Z";
  const metrics = await f.queries.metrics("merchant-a", { from, to });
  assert.equal(metrics.dailyMovements?.length, 367);
  assert.deepEqual(metrics.dailyMovements?.[0], { date: "2024-01-01", grantedCents: 0, redeemedCents: 0 });
  assert.deepEqual(metrics.dailyMovements?.at(-1), { date: "2025-01-01", grantedCents: 0, redeemedCents: 0 });
  await assert.rejects(f.queries.metrics("merchant-a", { from, to: "2025-01-01T03:00:00.001Z" }), /cashback_period_invalid/);
  await assert.rejects(f.queries.metrics("merchant-a", { from: to, to: from }), /cashback_period_invalid/);
});

test("partial-day endpoints retain only ledger movements inside the actual selected timestamps", async () => {
  await credit(99, "2026-11-01T14:59:59.999Z");
  await credit(110, "2026-11-01T15:00:00.000Z");
  await credit(220, "2026-11-02T01:00:00.000Z");
  await credit(77, "2026-11-02T02:00:00.001Z");
  const metrics = await f.queries.metrics("merchant-a", { from: "2026-11-01T15:00:00Z", to: "2026-11-02T02:00:00Z" });
  assert.deepEqual(metrics.dailyMovements, [{ date: "2026-11-01", grantedCents: 330, redeemedCents: 0 }]);
  assert.equal(metrics.grantedCents, 330);
});
