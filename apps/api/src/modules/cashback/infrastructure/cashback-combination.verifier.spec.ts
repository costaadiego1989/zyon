import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import type { CashbackRules, CheckoutSession, AuthorizedOffer } from "@zyon/shared-types";
import { CashbackRepository } from "./cashback.repository.js";
import { CheckoutCommercialBenefitsService } from "../application/checkout-commercial-benefits.service.js";
import { CashbackService } from "../application/cashback.service.js";
import { cashbackCombinedLimit, marginDiscountLimit } from "../domain/cashback-combination.js";

// Exclusive local QA container; no environment or project .env is read.
const databaseUrl = "postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback";
const schema = `cashback_combination_verifier_${randomUUID().replaceAll("-", "")}`;
const db = new pg.Client({ connectionString: databaseUrl });
let prisma: PrismaClient; let benefits: CheckoutCommercialBenefitsService; let cashback: CashbackService;
const rules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null,
  buyerMonthlyEarnLimitCents: null, monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0,
  expiryDays: null, minimumRedeemOrderCents: 0, maximumRedeemBps: 9000, maximumRedeemCents: null,
  allowWithDiscounts: true, terms: "Crédito promocional nesta loja.", combination: { allowCoupons: true, allowAdvancedRules: true,
    limitMode: "cashback_specific", maximumCombinedDiscountBps: 5000, maximumCombinedDiscountCents: null } };

before(async () => {
  await db.connect(); await db.query(`CREATE SCHEMA "${schema}"`); await db.query(`SET search_path TO "${schema}"`);
  await db.query(`CREATE TABLE checkout_sessions(merchant_id TEXT,session_id TEXT,global_user_id TEXT,cart JSONB,shipping JSONB,version INTEGER DEFAULT 0,updated_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(merchant_id,session_id));
    CREATE TABLE buyer_accounts(global_user_id TEXT PRIMARY KEY,display_name TEXT,email TEXT);
    CREATE TABLE buyer_identities(merchant_id TEXT,identity_key TEXT,global_user_id TEXT,PRIMARY KEY(merchant_id,identity_key));
    CREATE TABLE whatsapp_sessions(merchant_id TEXT,checkout_session_id TEXT,buyer_phone TEXT);
    CREATE TABLE merchant_rules(merchant_id TEXT PRIMARY KEY,max_discount_percent NUMERIC,minimum_margin_percent NUMERIC);
    CREATE TABLE coupons(id TEXT PRIMARY KEY,merchant_id TEXT,code TEXT,discount_type TEXT,status TEXT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ);
    CREATE TABLE coupon_redemptions(id TEXT PRIMARY KEY,coupon_id TEXT,merchant_id TEXT,session_id TEXT,discount_applied NUMERIC,status TEXT,updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE storefront_carts(merchant_id TEXT,session_id TEXT,coupon_code TEXT,discount NUMERIC);
    CREATE TABLE accepted_offers(merchant_id TEXT,session_id TEXT,offer_id TEXT,type TEXT,value NUMERIC,accepted_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE payment_intents(id TEXT PRIMARY KEY,merchant_id TEXT,session_id TEXT,status TEXT);`);
  await db.query(await readFile(new URL("../../../../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql", import.meta.url), "utf8"));
  await db.query(await readFile(new URL("../../../../prisma/migrations/20261114091000_buyer_verified_phones/migration.sql", import.meta.url), "utf8"));
  await db.query(await readFile(new URL("../../../../prisma/migrations/20261114120000_cashback/migration.sql", import.meta.url), "utf8"));
  await db.query(await readFile(new URL("../../../../prisma/migrations/20261114150000_cashback_combination/migration.sql", import.meta.url), "utf8"));
  prisma = new PrismaClient({ datasources: { db: { url: `${databaseUrl}?schema=${schema}` } } });
  benefits = new CheckoutCommercialBenefitsService(new CashbackRepository(prisma));
  cashback = new CashbackService(new CashbackRepository(prisma), benefits);
});
after(async () => { await prisma?.$disconnect(); await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end(); });
beforeEach(async () => {
  await db.query(`TRUNCATE cashback_checkout_benefits,cashback_benefit_events,cashback_event_receipts,cashback_earning_quotes,cashback_budget_periods,cashback_ledger_entries,cashback_reservations,cashback_grants,cashback_wallets,cashback_rule_versions,cashback_programs,buyer_verified_phones,buyer_identities,whatsapp_sessions,buyer_accounts,merchant_rules,checkout_sessions,coupons,coupon_redemptions,storefront_carts,accepted_offers,payment_intents CASCADE`);
  await db.query("INSERT INTO cashback_programs(merchant_id,status,published,version) VALUES('m','active',$1,1)", [JSON.stringify(rules)]);
  await db.query("INSERT INTO merchant_rules VALUES('m',50,0)");
  await db.query("INSERT INTO buyer_accounts VALUES('buyer','Buyer','buyer@example.test')");
});
function session(shipping = 10): CheckoutSession {
  const now = new Date().toISOString();
  return { merchantId: "m", sessionId: "checkout", globalUserId: "buyer", conversationId: "conversation",
    cart: { total: 100, currency: "BRL", items: [{ sku: "sku", variantId: "variant", name: "Produto", price: 100, cost: 20, quantity: 1 }] },
    shipping: { customerPrice: shipping, realCost: shipping, region: "SP" }, abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: now, updatedAt: now };
}
async function persist(s: CheckoutSession) {
  await db.query("INSERT INTO checkout_sessions(merchant_id,session_id,global_user_id,cart,shipping) VALUES($1,$2,$3,$4,$5)",
    [s.merchantId, s.sessionId, s.globalUserId, JSON.stringify(s.cart), JSON.stringify(s.shipping ?? null)]);
}
function offer(s: CheckoutSession, type: AuthorizedOffer["type"], value: number, id = randomUUID()): AuthorizedOffer {
  return { id, merchantId: s.merchantId, sessionId: s.sessionId, type, value, approved: true, reason: "authorized",
    marginAfterOffer: 0.5, expiresAt: new Date(Date.now() + 60000).toISOString() };
}
async function coupon(s: CheckoutSession, amount = 1) {
  await db.query("INSERT INTO coupons VALUES('coupon','m','PROMO','fixed','active',now()-interval '1 day',NULL)");
  await db.query("INSERT INTO coupon_redemptions(id,coupon_id,merchant_id,session_id,discount_applied,status) VALUES('redemption','coupon','m',$1,$2,'applied')", [s.sessionId, amount]);
  return { redemption_id: "redemption", discount_applied: amount, coupon: { id: "coupon", code: "PROMO" } };
}

test("VERIFIER CS-02 combined monetary cap and general boundary use exact cents outside the named example", () => {
  const result = cashbackCombinedLimit({ grossCents: 12345, netProductsCents: 11496, availableCents: 5000,
    rules: { ...rules, combination: { ...rules.combination!, limitMode: "respect_general", maximumCombinedDiscountBps: 3000 } },
    context: { generalDiscountCapBps: 1499, marginDiscountLimitCents: 10000,
      origins: { couponCents: 849, advancedRuleCents: 0, unknownCents: 0, hasCoupon: true, hasAdvancedRule: false, hasUnknown: false } } });
  assert.equal(result.combinedCapCents, 1850); assert.equal(result.maximumCashbackCents, 1001);
  const moneyLimited = cashbackCombinedLimit({ grossCents: 12345, netProductsCents: 11496, availableCents: 5000,
    rules: { ...rules, combination: { ...rules.combination!, limitMode: "respect_general", maximumCombinedDiscountBps: 3000,
      maximumCombinedDiscountCents: 1749 } },
    context: { generalDiscountCapBps: 1499, marginDiscountLimitCents: 10000,
      origins: { couponCents: 849, advancedRuleCents: 0, unknownCents: 0, hasCoupon: true, hasAdvancedRule: false, hasUnknown: false } } });
  assert.equal(moneyLimited.combinedCapCents, 1749); assert.equal(moneyLimited.maximumCashbackCents, 900);
});

test("VERIFIER CS-02 minimum margin keeps the last permissible cent after the configured four percent payment fee", () => {
  const limit = marginDiscountLimit(9999, 2460, 3800);
  assert.equal(limit, 5757);
  const net = 9999 - limit;
  assert.ok((net * 0.96 - 2460) / net >= 0.38);
  assert.ok(((net - 1) * 0.96 - 2460) / (net - 1) < 0.38);
});

test("VERIFIER CS-04 persisted coupon origin blocks cashback even when the last label could describe an advanced rule", () => {
  const result = cashbackCombinedLimit({ grossCents: 14837, netProductsCents: 14683, availableCents: 5000,
    rules: { ...rules, combination: { ...rules.combination!, allowCoupons: false, allowAdvancedRules: true } },
    context: { generalDiscountCapBps: 5000, marginDiscountLimitCents: 10000,
      origins: { couponCents: 154, advancedRuleCents: 0, unknownCents: 0, hasCoupon: true, hasAdvancedRule: false, hasUnknown: false } } });
  assert.equal(result.maximumCashbackCents, 0);
  assert.equal(result.reason, "cashback_coupon_combination_not_allowed");
});

test("VERIFIER CS-05 pending payment rejects the advanced rule and leaves journal and cart untouched", async () => {
  const s = session(); await persist(s);
  await db.query("INSERT INTO payment_intents VALUES('pending-intent','m','checkout','pending')");
  await assert.rejects(() => benefits.applyAdvancedRule(s, offer(s, "discount_fixed", 5)),
    { code: "cashback_payment_in_progress" });
  const journal = await db.query("SELECT * FROM cashback_checkout_benefits");
  const events = await db.query("SELECT * FROM cashback_benefit_events");
  const carts = await db.query("SELECT cart FROM checkout_sessions WHERE merchant_id='m' AND session_id='checkout'");
  assert.equal(journal.rowCount, 0); assert.equal(events.rowCount, 0);
  assert.deepEqual(carts.rows[0].cart, s.cart);
});

test("VERIFIER CS-06 applying a product coupon cannot revive a stale freight quote after shipping reselection", async () => {
  const s = session(10); await persist(s);
  const applied = await benefits.applyAdvancedRule(s, offer(s, "shipping_discount_fixed", 5));
  assert.equal(applied!.shipping!.customerPrice, 5);
  // The authoritative shipping service has selected a new 30-real quotation.
  const reselected = { ...applied!, shipping: { ...applied!.shipping!, customerPrice: 30, realCost: 30 } };
  await db.query("UPDATE checkout_sessions SET shipping=$1 WHERE merchant_id='m' AND session_id='checkout'", [JSON.stringify(reselected.shipping)]);
  const result = await benefits.applyCoupon(reselected, await coupon(reselected));
  // A previously authorized five-real freight benefit cannot make a newly
  // quoted thirty-real shipment cost less than twenty-five reais.
  assert.ok(result!.shipping!.customerPrice >= 25, `Freight was reset to ${result!.shipping!.customerPrice} instead of honoring the new quotation`);
});

test("VERIFIER CS-05 a freight-only change keeps a fully affordable reservation in storage and checkout presentation", async () => {
  const s = session(10); await persist(s);
  await cashback.adjustWallet("m", "buyer", { amountCents: 3000, reason: "Independent QA credit", expiryDays: null, idempotencyKey: randomUUID() }, "owner");
  await cashback.reserveCheckout(s, 1000, "freight-reserve");
  const reselected = { ...s, shipping: { ...s.shipping!, customerPrice: 20, realCost: 20 } };
  await db.query("UPDATE checkout_sessions SET shipping=$1 WHERE merchant_id='m' AND session_id='checkout'", [JSON.stringify(reselected.shipping)]);
  const quote = await cashback.quoteCheckout(reselected);
  assert.equal(quote.reservedCents, 1000);
  const persisted = await db.query("SELECT data FROM cashback_reservations WHERE merchant_id='m' AND session_id='checkout' AND state='reserved'");
  const displayed = await cashback.checkoutCashbackCents(reselected);
  assert.equal(displayed, 1000, "The affordable credit must not vanish while reading authoritative checkout totals");
  assert.equal(persisted.rows[0].data.fingerprint, quote.fingerprint, "A fingerprint-only reservation rebind must be persisted without needing an unreserve ledger entry");
  assert.equal((await cashback.wallet("m", "buyer")).balance.reservedCents, 1000);
});
