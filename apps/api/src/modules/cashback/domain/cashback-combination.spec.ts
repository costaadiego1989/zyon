import assert from "node:assert/strict";
import { test } from "node:test";
import type { CashbackCombinationRules, CashbackRules } from "@zyon/shared-types";
import { cashbackCombinedLimit, combinedDiscountCap, combinationEligibility, marginDiscountLimit, validateCombination, type CombinationContext } from "./cashback-combination.js";
import { advance, assertWallet, emptyWallet, grantCredit, reserve, reverseGrant, shrinkReservation, validateRules, walletBalance } from "./cashback.js";

const policy: CashbackCombinationRules = { allowCoupons: true, allowAdvancedRules: true, limitMode: "cashback_specific", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null };
const rules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null,
  monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays: null,
  minimumRedeemOrderCents: 0, maximumRedeemBps: 9000, maximumRedeemCents: null, allowWithDiscounts: true,
  terms: "Credito promocional para a mesma loja.", combination: policy };
const context: CombinationContext = { generalDiscountCapBps: 2000, marginDiscountLimitCents: 6000,
  origins: { couponCents: 1000, advancedRuleCents: 500, unknownCents: 0, hasCoupon: true, hasAdvancedRule: true, hasUnknown: false } };

test("CS-01 combination publication requires every explicit choice and at least one positive cap", () => {
  assert.deepEqual(validateCombination(policy), policy);
  for (const key of Object.keys(policy)) { const missing = { ...policy }; delete (missing as Record<string, unknown>)[key]; assert.throws(() => validateCombination(missing), /choices_required/); }
  for (const bad of [undefined, null, [], {}, { ...policy, allowCoupons: "yes" }, { ...policy, allowAdvancedRules: null }, { ...policy, limitMode: "automatic" },
    { ...policy, maximumCombinedDiscountBps: null, maximumCombinedDiscountCents: null }, { ...policy, maximumCombinedDiscountBps: 0 },
    { ...policy, maximumCombinedDiscountBps: 10001 }, { ...policy, maximumCombinedDiscountBps: 1.5 }, { ...policy, maximumCombinedDiscountCents: -1 },
    { ...policy, maximumCombinedDiscountCents: 0 }, { ...policy, additional: true }]) assert.throws(() => validateCombination(bad), /cashback_/);
  assert.deepEqual(validateCombination({ ...policy, maximumCombinedDiscountBps: null, maximumCombinedDiscountCents: 1 }), { ...policy, maximumCombinedDiscountBps: null, maximumCombinedDiscountCents: 1 });
  assert.deepEqual(validateRules(rules), rules);
});

test("CS-02 general and specific caps preserve balance, own redemption cap and minimum margin", () => {
  const calculate = (r = rules, c = context, availableCents = 9999) => cashbackCombinedLimit({ grossCents: 10000, netProductsCents: 8500, availableCents, rules: r, context: c });
  assert.equal(calculate({ ...rules, combination: { ...policy, limitMode: "respect_general" } }).maximumCashbackCents, 500);
  assert.equal(calculate().maximumCashbackCents, 1500);
  assert.equal(calculate(rules, context, 123).maximumCashbackCents, 123);
  assert.equal(calculate({ ...rules, maximumRedeemBps: 1000 }).maximumCashbackCents, 850);
  assert.equal(calculate({ ...rules, maximumRedeemCents: 400 }).maximumCashbackCents, 400);
  assert.equal(calculate(rules, { ...context, marginDiscountLimitCents: 1601 }).maximumCashbackCents, 101);
  assert.equal(combinedDiscountCap(10000, { ...policy, maximumCombinedDiscountCents: 2501 }, 2000), 2501);
  assert.equal(combinedDiscountCap(9999, { ...policy, limitMode: "respect_general" }, 1499), 1498);
  assert.equal(marginDiscountLimit(10000, 2000, 3800), 6551);
  assert.equal(marginDiscountLimit(10000, 2000, 9600), 0);
});

test("CS-03 product 10000 less coupon 1000 and advanced 500 leaves 1500 for cashback", () => {
  const quote = cashbackCombinedLimit({ grossCents: 10000, netProductsCents: 8500, availableCents: 3000, rules, context });
  assert.deepEqual(quote, { maximumCashbackCents: 1500, reason: null, combinedCapCents: 3000 });
  assert.equal(10000 - 1000 - 500 - quote.maximumCashbackCents, 7000);
});

test("CS-04 origin permissions are independent and include freight-only benefits", () => {
  const coupon = { ...context.origins, hasAdvancedRule: false, advancedRuleCents: 0 };
  const advanced = { ...context.origins, hasCoupon: false, couponCents: 0 };
  assert.equal(combinationEligibility({ ...policy, allowCoupons: false }, coupon), "cashback_coupon_combination_not_allowed");
  assert.equal(combinationEligibility({ ...policy, allowAdvancedRules: false }, advanced), "cashback_rule_combination_not_allowed");
  assert.equal(combinationEligibility({ ...policy, allowAdvancedRules: false }, coupon), null);
  assert.equal(combinationEligibility({ ...policy, allowCoupons: false }, advanced), null);
  const unknown = { ...coupon, hasCoupon: false, hasUnknown: true, unknownCents: 1000 };
  assert.equal(combinationEligibility(policy, unknown), null);
  assert.equal(combinationEligibility({ ...policy, allowAdvancedRules: false }, unknown), "cashback_unknown_benefit_origin");
  assert.equal(combinationEligibility({ ...policy, allowCoupons: false }, { ...coupon, couponCents: 0 }), "cashback_coupon_combination_not_allowed");
  assert.equal(combinationEligibility(policy, { ...coupon, couponStackable: false }), "cashback_coupon_exclusive");
});

test("CS-07 old snapshots retain their explicit legacy discount rule", () => {
  const legacy = { ...rules }; delete legacy.combination;
  assert.deepEqual(validateRules(legacy), legacy);
  assert.throws(() => cashbackCombinedLimit({ grossCents: 10000, netProductsCents: 8500, availableCents: 3000, rules: legacy, context }), /combination_required/);
});

test("CS-05 clipping keeps earliest-expiring lots and never revives a revoked source", () => {
  const now=new Date("2026-11-14T12:00:00Z"),w=emptyWallet("m","b");
  for(const [orderId,expiryDays] of [["earliest",1],["latest",90]] as const)
    grantCredit(w,{orderId,amountCents:1000,eligibleBaseCents:20000,rules:{...rules,expiryDays},ruleVersion:1,lines:[],availableAt:now.toISOString()},now);
  advance(w,now); const reservation=reserve(w,{sessionId:"checkout",fingerprint:"before",amountCents:2000,maximumCents:2000},now); const originalExpiry=reservation.expiresAt;
  shrinkReservation(w,reservation.id,1200,"after",now);
  assert.deepEqual(reservation.allocations.map(a=>a.amountCents),[1000,200]); assert.equal(walletBalance(w).availableCents,800);
  assert.equal(reservation.fingerprint,"after"); assert.equal(reservation.expiresAt,originalExpiry);
  reverseGrant(w,"earliest",20000,now); shrinkReservation(w,reservation.id,100,"again",now);
  assert.equal(walletBalance(w).availableCents,1000); assert.equal(walletBalance(w).reservedCents,100);
  shrinkReservation(w,reservation.id,0,"final",now);
  assert.equal(walletBalance(w).availableCents,1000); assert.equal(walletBalance(w).reservedCents,0); assert.equal(walletBalance(w).reversedCents,1000); assertWallet(w);
});
