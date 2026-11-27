import assert from "node:assert/strict";
import { test } from "node:test";
import type { CashbackRules } from "@zyon/shared-types";
import { advance, allocate, assertWallet, consume, earned, emptyWallet, grantCredit, release, reserve, restore, reverseGrant, validateRules, walletBalance } from "./cashback.js";

export const rules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null,
  buyerMonthlyEarnLimitCents: null, monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0,
  expiryDays: 90, minimumRedeemOrderCents: 5000, maximumRedeemBps: 2000, maximumRedeemCents: null,
  allowWithDiscounts: false, terms: "Crédito promocional para compras nesta loja; restituições mantêm a validade original." };
const now = new Date("2026-11-14T12:00:00Z");
function funded(amount = 3000, inputRules = rules) {
  const w = emptyWallet("merchant-a", "buyer-a");
  grantCredit(w, { orderId: "source", amountCents: amount, eligibleBaseCents: amount * 20, rules: inputRules, ruleVersion: 1, lines: [], availableAt: now.toISOString() }, now);
  advance(w, now); w.entries = []; return w;
}
test("CB-02 all commercial rules must be explicit and bounded", () => {
  assert.throws(() => validateRules({}), /required/);
  assert.throws(() => validateRules({ ...rules, expiryDays: undefined }), /expiryDays_required/);
  assert.throws(() => validateRules({ ...rules, maximumRedeemBps: 10000 }), /rate_out_of_range/);
  assert.throws(() => validateRules({ ...rules, monthlyBudgetCents: 0 }), /monthlyBudgetCents_invalid/);
  assert.deepEqual(validateRules(rules), rules);
  assert.deepEqual(validateRules({ ...rules, expiryDays: null, monthlyBudgetCents: null }), { ...rules, expiryDays: null, monthlyBudgetCents: null });
});
test("CB-05 eligible products of 20000 cents generate 1000 pending cents", () => {
  const w = emptyWallet("m", "b"); const amountCents = earned(20000, 0, rules);
  grantCredit(w, { orderId: "order", amountCents, eligibleBaseCents: 20000, rules, ruleVersion: 1, lines: [], availableAt: null }, now);
  assert.equal(walletBalance(w).pendingCents, 1000); assert.equal(walletBalance(w).availableCents, 0);
});
test("CB-06 2000 spent on 10000 products generates only 400 new cents", () => {
  assert.equal(earned(10000, 2000, rules), 400);
  assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(allocate(2000, [3333, 6667]), [667, 1333]);
});
test("CB-08 reserves cannot exceed unreserved balance", () => {
  const w = funded(); reserve(w, { sessionId: "a", fingerprint: "f", amountCents: 2000, maximumCents: 2000 }, now);
  assert.throws(() => reserve(w, { sessionId: "b", fingerprint: "g", amountCents: 2000, maximumCents: 2000 }, now), /insufficient/);
  assert.equal(walletBalance(w).availableCents, 1000); assert.equal(walletBalance(w).reservedCents, 2000); assertWallet(w);
});
test("CB-09 matching live reservation is idempotent in the domain", () => {
  const w = funded(); const input = { sessionId: "a", fingerprint: "f", amountCents: 2000, maximumCents: 2000 };
  const a = reserve(w, input, now); const b = reserve(w, input, now);
  assert.equal(a.id, b.id); assert.equal(w.reservations.length, 1); assert.equal(w.entries.filter(e => e.type === "reserve").length, 1);
});
test("CB-10 FEFO consumes earliest expiry and preserves reserved credit past expiry", () => {
  const w = funded(1000, { ...rules, expiryDays: 2 });
  grantCredit(w, { orderId: "later", amountCents: 1000, eligibleBaseCents: 20000, rules, ruleVersion: 1, lines: [], availableAt: now.toISOString() }, now);
  advance(w, now); const r = reserve(w, { sessionId: "a", fingerprint: "f", amountCents: 500, maximumCents: 500 }, now);
  assert.equal(r.allocations[0]!.grantId, w.grants[0]!.id); r.state = "payment_pending";
  advance(w, new Date(now.getTime() + 3 * 86400000));
  assert.equal(walletBalance(w).reservedCents, 500); assert.equal(walletBalance(w).expiredCents, 500); assert.equal(walletBalance(w).availableCents, 1000);
});
test("CB-11 refund restores original lots and reverses the exact partial gain", () => {
  const w = funded(1000); const r = reserve(w, { sessionId: "a", fingerprint: "f", amountCents: 600, maximumCents: 600 }, now);
  r.state = "payment_pending"; consume(w, r.id, "spent-order", now);
  assert.equal(restore(w, "spent-order", 300, now), 300);
  assert.equal(walletBalance(w).availableCents, 700); assert.equal(walletBalance(w).usedCents, 300);
  assert.equal(reverseGrant(w, "source", 5000, now), 250);
  assert.equal(walletBalance(w).availableCents, 450); assertWallet(w);
});
test("CB-12 source refund after cashback is spent records loss without negative balance", () => {
  const w = funded(1000); const r = reserve(w, { sessionId: "a", fingerprint: "f", amountCents: 1000, maximumCents: 1000 }, now);
  r.state = "payment_pending"; consume(w, r.id, "spent-order", now);
  reverseGrant(w, "source", 20000, now);
  assert.equal(walletBalance(w).lossCents, 1000); assert.equal(walletBalance(w).availableCents, 0); assertWallet(w);
  restore(w, "spent-order", 1000, now);
  assert.equal(walletBalance(w).lossCents, 0); assert.equal(walletBalance(w).availableCents, 0); assertWallet(w);
});
test("CB-12 reversed credit held by another checkout cannot resurrect when released", () => {
  const w = funded(1000); const r = reserve(w, { sessionId: "a", fingerprint: "f", amountCents: 1000, maximumCents: 1000 }, now);
  r.state = "payment_pending"; reverseGrant(w, "source", 20000, now);
  assert.equal(walletBalance(w).reservedCents, 1000); assertWallet(w);
  release(w, r.id, now, true);
  assert.equal(walletBalance(w).availableCents, 0); assert.equal(walletBalance(w).reservedCents, 0); assert.equal(walletBalance(w).lossCents, 0); assertWallet(w);
});
test("CB-12 committed pending use of reversed source credit records loss at consumption", () => {
  const w = funded(1000); const r = reserve(w, { sessionId: "a", fingerprint: "f", amountCents: 1000, maximumCents: 1000 }, now);
  r.state = "payment_pending"; reverseGrant(w, "source", 20000, now); consume(w, r.id, "spent", now);
  assert.equal(walletBalance(w).lossCents, 1000); assert.equal(walletBalance(w).usedCents, 1000); assertWallet(w);
});
test("CB-14 a pending or uncertain payment never releases credit by UI timeout", () => {
  const w = funded(); const r = reserve(w, { sessionId: "a", fingerprint: "f", amountCents: 2000, maximumCents: 2000 }, now);
  r.state = "payment_pending"; advance(w, new Date(now.getTime() + 86400000));
  assert.throws(() => release(w, r.id, now), /payment_in_progress/);
  assert.equal(walletBalance(w).reservedCents, 2000);
});
