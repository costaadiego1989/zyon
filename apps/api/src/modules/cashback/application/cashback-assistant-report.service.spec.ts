import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CashbackAssistantReportService } from "./cashback-assistant-report.service.js";
import { CashbackQueriesService } from "./cashback-queries.service.js";
import { cashbackConfigurationFixture, configurationRules as rules } from "../infrastructure/__tests__/cashback-configuration.fixture.js";
import { advance, consume, grantCredit, reserve, restore } from "../domain/cashback.js";
let f: Awaited<ReturnType<typeof cashbackConfigurationFixture>>;
before(async () => { f = await cashbackConfigurationFixture(); }); beforeEach(async () => { await f.reset(); }); after(async () => { await f?.close(); });
async function credit(amount: number, time: string, merchantId = "merchant-a", due = true) {
  const now = new Date(time);
  await f.repository.transaction(merchantId, async tx => { const wallet = await f.repository.wallet(tx, merchantId, "buyer-a");
    grantCredit(wallet, { orderId: randomUUID(), amountCents: amount, eligibleBaseCents: amount * 20, rules, ruleVersion: 1, lines: [], availableAt: due ? now.toISOString() : null }, now);
    if (due) advance(wallet, now); await f.repository.saveWallet(tx, wallet); });
}
test("default report uses the current Brasilia calendar month through today even before UTC local midnight", async () => {
  const service = new CashbackAssistantReportService(f.queries, () => new Date("2026-11-01T01:00:00Z"));
  const report = await service.read("merchant-a", {}); assert.equal(report.merchantId, "merchant-a"); assert.equal(report.currency, "BRL"); assert.equal(report.timeZone, "America/Sao_Paulo");
  assert.equal(report.metrics.from, "2026-10-01T03:00:00.000Z"); assert.equal(report.metrics.to, "2026-11-01T02:59:59.999Z"); assert.equal(report.metrics.dailyMovements?.length, 31);
});
test("CBX-40 a report matches the real scoped ledger and current wallet and budget with explicit temporal scopes", async () => {
  await f.service.saveDraft("merchant-a", rules, "owner-a"); await f.service.publishProgram("merchant-a", "owner-a");
  await credit(999, "2026-11-01T02:59:59.999Z"); await credit(125, "2026-11-01T03:00:00Z"); await credit(250, "2026-11-02T02:59:59.999Z"); await credit(888, "2026-11-03T03:00:00Z"); await credit(90000, "2026-11-01T04:00:00Z", "merchant-b");
  await f.repository.transaction("merchant-a", async tx => { const wallet = await f.repository.wallet(tx, "merchant-a", "buyer-a"), now = new Date("2026-11-02T03:00:00Z");
    const r = reserve(wallet, { sessionId: "report-session", fingerprint: "report", amountCents: 75, maximumCents: 75 }, now); r.state = "payment_pending"; consume(wallet, r.id, "report-order", now); restore(wallet, "report-order", 10, now); await f.repository.saveWallet(tx, wallet); });
  const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date());
  await f.db.query("INSERT INTO cashback_budget_periods(merchant_id,period,committed_cents,issued_cents) VALUES('merchant-a',$1,1000,2000)", [month]);
  const report = await new CashbackAssistantReportService(f.queries).read("merchant-a", { from: "2026-11-01", to: "2026-11-02" });
  const metrics = report.metrics; assert.equal(metrics.grantedCents, 375); assert.equal(metrics.redeemedCents, 75); assert.equal(metrics.restoredCents, 10); assert.equal(metrics.availableCents, 2197); assert.equal(metrics.buyersGranted, 1); assert.equal(metrics.buyersRedeemed, 1); assert.equal(metrics.ordersWithCashback, 1);
  assert.equal(metrics.pendingCents, 0); assert.equal(metrics.reservedCents, 0); assert.equal(metrics.budgetCommittedCents, 1000); assert.equal(metrics.budgetIssuedCents, 2000); assert.equal(metrics.budgetLimitCents, 100000); assert.equal(report.budgetMonth, month);
  assert.deepEqual(metrics.dailyMovements, [{ date: "2026-11-01", grantedCents: 375, redeemedCents: 0 }, { date: "2026-11-02", grantedCents: 0, redeemedCents: 75 }]);
  const canonical = await f.queries.metrics("merchant-a", { from: metrics.from, to: metrics.to }); assert.deepEqual({ ...metrics, asOf: canonical.asOf }, canonical);
});
test("a genuinely empty historical report retains current stock and current budget month", async () => {
  await credit(4321, "2025-01-01T12:00:00Z");
  const report = await new CashbackAssistantReportService(f.queries).read("merchant-a", { from: "2000-01-01", to: "2000-01-02" });
  assert.equal(report.metrics.grantedCents, 0); assert.equal(report.metrics.redeemedCents, 0); assert.equal(report.metrics.availableCents, 4321); assert.equal(report.metrics.dailyMovements?.length, 2);
  assert.notEqual(report.budgetMonth, "2000-01"); assert.ok(Number.isFinite(Date.parse(report.metrics.asOf)));
});
test("business-date conversion respects a real Brasilia DST midnight transition", async () => {
  const report = await new CashbackAssistantReportService(f.queries).read("merchant-a", { from: "2018-11-04", to: "2018-11-04" });
  assert.equal(report.metrics.from, "2018-11-04T03:00:00.000Z"); assert.equal(report.metrics.to, "2018-11-05T01:59:59.999Z"); assert.equal(report.metrics.dailyMovements?.length, 1);
});
test("invalid missing contradictory and oversized report periods fail before supplying any metrics", async () => {
  const service = new CashbackAssistantReportService(f.queries);
  for (const range of [{ from: "2026-11-01" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-11-02", to: "2026-11-01" }, { from: "2024-01-01", to: "2025-01-02" }, { from: "tomorrow", to: "today" }, { from: "2026-11-01", to: "2026-11-01", merchantId: "merchant-b" }]) await assert.rejects(service.read("merchant-a", range), /cashback_.*period_invalid/);
});
test("a database read failure returns unavailable instead of an invented empty report", async () => {
  await f.db.query("ALTER TABLE cashback_ledger_entries RENAME TO cashback_ledger_unavailable");
  try { await assert.rejects(new CashbackAssistantReportService(f.queries).read("merchant-a", {}), { code: "cashback_report_unavailable", status: 503 }); }
  finally { await f.db.query("ALTER TABLE cashback_ledger_unavailable RENAME TO cashback_ledger_entries"); }
});
test("reports preserve normal automatic release reconciliation and stabilize without discretionary adjustments", async () => {
  const now = new Date(Date.now() - 86400000);
  await f.repository.transaction("merchant-a", async tx => { const wallet = await f.repository.wallet(tx, "merchant-a", "buyer-a");
    grantCredit(wallet, { orderId: "due-report", amountCents: 456, eligibleBaseCents: 9120, rules, ruleVersion: 1, lines: [], availableAt: now.toISOString() }, now); await f.repository.saveWallet(tx, wallet); });
  const report = await new CashbackAssistantReportService(f.queries).read("merchant-a", {}); assert.equal(report.metrics.pendingCents, 0); assert.equal(report.metrics.availableCents, 456);
  const ledger = (await f.db.query("SELECT type,amount_cents FROM cashback_ledger_entries ORDER BY type")).rows; assert.deepEqual(ledger.map(r => [r.type, Number(r.amount_cents)]), [["grant", 456], ["release", 456]]);
  await new CashbackAssistantReportService(new CashbackQueriesService(f.repository, f.service)).read("merchant-a", {}); assert.deepEqual((await f.db.query("SELECT type,amount_cents FROM cashback_ledger_entries ORDER BY type")).rows, ledger); assert.equal((await f.program()).status, "disabled");
});
