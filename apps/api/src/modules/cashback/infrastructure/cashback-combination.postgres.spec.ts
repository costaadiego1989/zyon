import "reflect-metadata";
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import type { AuthorizedOffer, CashbackRules, CheckoutSession } from "@zyon/shared-types";
import { CashbackRepository } from "./cashback.repository.js";
import { CashbackService } from "../application/cashback.service.js";
import { CheckoutCommercialBenefitsService, type AuthorizedCouponResult } from "../application/checkout-commercial-benefits.service.js";
import { CashbackMerchantController } from "../presentation/cashback.controllers.js";
import type { CashbackQueriesService } from "../application/cashback-queries.service.js";

// Only the exclusive local QA database is used. No .env or DATABASE_URL lookup.
const databaseUrl = "postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback";
const schema = `cashback_combination_${randomUUID().replaceAll("-", "")}`;
const db = new pg.Client({ connectionString: databaseUrl });
let prisma: PrismaClient; let service: CashbackService; let benefits: CheckoutCommercialBenefitsService;
const rules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null,
  monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays: null,
  minimumRedeemOrderCents: 0, maximumRedeemBps: 9000, maximumRedeemCents: null, allowWithDiscounts: true,
  terms: "Credito promocional para a mesma loja.", combination: { allowCoupons: true, allowAdvancedRules: true, limitMode: "cashback_specific", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null } };

before(async () => {
  await db.connect(); await db.query(`CREATE SCHEMA "${schema}"`); await db.query(`SET search_path TO "${schema}"`);
  await db.query(`CREATE TABLE buyer_accounts(global_user_id TEXT PRIMARY KEY,display_name TEXT,email TEXT);
    CREATE TABLE buyer_identities(merchant_id TEXT,identity_key TEXT,global_user_id TEXT,PRIMARY KEY(merchant_id,identity_key));
    CREATE TABLE checkout_sessions(merchant_id TEXT,session_id TEXT,global_user_id TEXT,cart JSONB,shipping JSONB,version INTEGER DEFAULT 0,updated_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(merchant_id,session_id));
    CREATE TABLE whatsapp_sessions(merchant_id TEXT,checkout_session_id TEXT,buyer_phone TEXT);
    CREATE TABLE payment_intents(id TEXT PRIMARY KEY,merchant_id TEXT,session_id TEXT,idempotency_key TEXT,status TEXT,amount_cents INTEGER,amount_breakdown JSONB);
    CREATE TABLE completed_orders(id TEXT PRIMARY KEY,merchant_id TEXT,session_id TEXT,external_order_id TEXT,status TEXT,completed_at TIMESTAMPTZ DEFAULT now(),fulfilled_at TIMESTAMPTZ,order_total NUMERIC);
    CREATE TABLE merchant_rules(merchant_id TEXT PRIMARY KEY,max_discount_percent NUMERIC,minimum_margin_percent NUMERIC);
    CREATE TABLE coupons(id TEXT PRIMARY KEY,merchant_id TEXT,code TEXT,discount_type TEXT,status TEXT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ);
    CREATE TABLE coupon_redemptions(id TEXT PRIMARY KEY,coupon_id TEXT,merchant_id TEXT,session_id TEXT,discount_applied NUMERIC,status TEXT,updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE storefront_carts(merchant_id TEXT,session_id TEXT,coupon_code TEXT,discount NUMERIC,free_shipping BOOLEAN DEFAULT false,updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE accepted_offers(merchant_id TEXT,session_id TEXT,offer_id TEXT,type TEXT,value NUMERIC,accepted_at TIMESTAMPTZ DEFAULT now());`);
  for (const migration of ["20260929020000_checkout_session_write_version", "20261114091000_buyer_verified_phones", "20261114120000_cashback", "20261114150000_cashback_combination"])
    await db.query(await readFile(new URL(`../../../../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
  prisma = new PrismaClient({ datasources: { db: { url: `${databaseUrl}?schema=${schema}` } } });
  const repository = new CashbackRepository(prisma); benefits = new CheckoutCommercialBenefitsService(repository); service = new CashbackService(repository, benefits);
});
after(async () => { await prisma?.$disconnect(); await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end(); });
beforeEach(async () => {
  await db.query(`TRUNCATE cashback_checkout_benefits,cashback_benefit_events,cashback_refund_operations,cashback_buyer_aliases,cashback_event_receipts,cashback_earning_quotes,cashback_budget_periods,cashback_ledger_entries,cashback_reservations,cashback_grants,cashback_wallets,cashback_rule_versions,cashback_programs,buyer_verified_phones,buyer_identities,whatsapp_sessions,checkout_sessions,payment_intents,completed_orders,buyer_accounts,merchant_rules,coupons,coupon_redemptions,storefront_carts,accepted_offers CASCADE`);
  await db.query("INSERT INTO buyer_accounts VALUES('buyer','Ana','ana@example.test')");
  await db.query("INSERT INTO merchant_rules VALUES('m',20,0)");
  await configure();
});
async function configure(value = rules) { await service.saveDraft("m", value, "owner"); return service.publishProgram("m", "owner"); }
function session(id = "checkout"): CheckoutSession {
  const now = new Date().toISOString();
  return { merchantId: "m", sessionId: id, globalUserId: "buyer", conversationId: `conversation-${id}`,
    cart: { total: 100, currency: "BRL", items: [{ sku: "sku", variantId: "variant", name: "Produto", price: 100, cost: 20, quantity: 1, productType: "physical" }] },
    shipping: { customerPrice: 10, realCost: 10, region: "SP" }, abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: now, updatedAt: now };
}
async function persist(s: CheckoutSession) { await db.query("INSERT INTO checkout_sessions(merchant_id,session_id,global_user_id,cart,shipping) VALUES($1,$2,$3,$4,$5)", [s.merchantId,s.sessionId,s.globalUserId,JSON.stringify(s.cart),JSON.stringify(s.shipping ?? null)]); }
async function fresh(s: CheckoutSession) { const row = (await db.query("SELECT cart,shipping FROM checkout_sessions WHERE merchant_id=$1 AND session_id=$2", [s.merchantId,s.sessionId])).rows[0]; return { ...s, cart: row.cart, shipping: row.shipping } as CheckoutSession; }
function offer(s: CheckoutSession, value = 5, type: AuthorizedOffer["type"] = "discount_fixed", id = randomUUID()): AuthorizedOffer {
  return { id, merchantId: s.merchantId, sessionId: s.sessionId, type, value, approved: true, reason: "Autorizada pelo servidor", marginAfterOffer: 0.7, expiresAt: new Date(Date.now()+60000).toISOString() };
}
async function coupon(s: CheckoutSession, amount = 10, id = "coupon", redemptionId = randomUUID()): Promise<AuthorizedCouponResult> {
  await db.query("INSERT INTO coupons VALUES($1,$2,$3,'fixed','active',now()-interval '1 day',NULL) ON CONFLICT DO NOTHING", [id,s.merchantId,id.toUpperCase()]);
  await db.query("INSERT INTO coupon_redemptions(id,coupon_id,merchant_id,session_id,discount_applied,status) VALUES($1,$2,$3,$4,$5,'applied')", [redemptionId,id,s.merchantId,s.sessionId,amount]);
  return { redemption_id: redemptionId, discount_applied: amount, coupon: { id,code:id.toUpperCase() } };
}
async function fund() { return service.adjustWallet("m","buyer",{ amountCents:3000,reason:"Credito de atendimento",expiryDays:null,idempotencyKey:randomUUID() },"owner"); }

test("CS-05 coupon then rule shrinks only the reserved cashback and returns exact money to FEFO lots", async () => {
  await fund(); const s=session(); await persist(s); await service.reserveCheckout(s,3000,"reserve");
  const afterCoupon=(await benefits.applyCoupon(s,await coupon(s)))!;
  assert.equal(afterCoupon.cart.currentDiscount,10); assert.equal((await service.quoteCheckout(afterCoupon)).reservedCents,2000);
  const afterRule=(await benefits.applyAdvancedRule(afterCoupon,offer(afterCoupon)))!;
  const q=await service.quoteCheckout(afterRule); assert.equal(afterRule.cart.currentDiscount,15); assert.equal(q.maximumRedeemCents,1500); assert.equal(q.reservedCents,1500);
  const wallet=await service.wallet("m","buyer"); assert.equal(wallet.balance.availableCents,1500); assert.equal(wallet.balance.reservedCents,1500);
  const ledger=await db.query("SELECT sum(amount_cents)::int amount FROM cashback_ledger_entries WHERE type='unreserve'"); assert.equal(ledger.rows[0].amount,1500);
  assert.equal((await service.preparePayment(afterRule,"payment")).cashbackCents,1500);
  const before=await service.wallet("m","buyer");
  await assert.rejects(benefits.assertCanApplyAdvancedRule(afterRule,offer(afterRule,8)),/payment_in_progress/);
  await assert.rejects(benefits.applyAdvancedRule(afterRule,offer(afterRule,8)),/payment_in_progress/);
  assert.deepEqual((await service.wallet("m","buyer")).balance,before.balance);
});

test("CS-06 both application orders and concurrent workers retain authorized coupon plus greatest monetary rule", async () => {
  await fund(); const a=session("coupon-first"),b=session("rule-first"),c=session("concurrent"); for(const s of[a,b,c])await persist(s);
  await benefits.applyAdvancedRule((await benefits.applyCoupon(a,await coupon(a)))!,offer(a));
  await benefits.applyCoupon((await benefits.applyAdvancedRule(b,offer(b)))!,await coupon(b));
  const result=await coupon(c),concurrentOffer=offer(c); await Promise.all([benefits.applyCoupon(c,result),benefits.applyAdvancedRule(c,concurrentOffer)]);
  for(const s of[a,b,c]) { const actual=await fresh(s); assert.equal(actual.cart.currentDiscount,15); assert.equal((await service.quoteCheckout(actual)).maximumRedeemCents,1500); }
  const latest=await fresh(c); await benefits.applyAdvancedRule(latest,offer(c,3));
  await benefits.applyAdvancedRule(await fresh(c),concurrentOffer);
  assert.equal((await fresh(c)).cart.currentDiscount,15);
  const rows=await db.query("SELECT data,version FROM cashback_checkout_benefits WHERE session_id='concurrent'"); assert.equal(rows.rows[0].version,2); assert.equal(rows.rows[0].data.coupon.amountCents,1000); assert.equal(rows.rows[0].data.advanced.amountCents,500);
});

test("CS-04 and CS-06 persisted coupon origin survives nudge replacement and native storefront handoff", async () => {
  await configure({...rules,combination:{...rules.combination!,allowAdvancedRules:false}}); await fund();
  const s=session(); s.cart={...s.cart,cart_ref:"native-cart",currentDiscount:10,commercialNudge:{kind:"advanced_rule",ruleId:"untrusted-presentation",title:"x",message:"x"}}; await persist(s);
  const native={...s,sessionId:"native-cart"}; const result=await coupon(native);
  await db.query("INSERT INTO storefront_carts(merchant_id,session_id,coupon_code,discount) VALUES('m','native-cart',$1,10)",[result.coupon.code]);
  const q=await service.quoteCheckout(s); assert.equal(q.maximumRedeemCents,2000); assert.equal(q.reason,null);
  await assert.rejects(benefits.assertCanApplyAdvancedRule(s,offer(s)),/combination_not_allowed/);
  await configure({...rules,combination:{...rules.combination!,allowCoupons:false,allowAdvancedRules:true}});
  assert.equal((await service.quoteCheckout(s)).reason,"cashback_coupon_combination_not_allowed");
});

test("CS-06 second coupon, stale cart and forged coupon amounts fail without corrupting prior benefits", async () => {
  const s=session(); await persist(s); const first=await coupon(s); const current=(await benefits.applyCoupon(s,first))!;
  await assert.rejects(benefits.assertCanApplyCoupon(current,"SECOND"),/coupon_already_applied/);
  const second=await coupon(current,3,"second"); await assert.rejects(benefits.applyCoupon(current,second),/coupon_already_applied/);
  assert.equal((await db.query("SELECT status FROM coupon_redemptions WHERE id=$1",[second.redemption_id])).rows[0].status,"cancelled");
  assert.equal((await db.query("SELECT status FROM coupon_redemptions WHERE id=$1",[first.redemption_id])).rows[0].status,"applied");
  assert.equal((await fresh(s)).cart.currentDiscount,10);
  await assert.rejects(benefits.applyCoupon(current,{...first,discount_applied:20}),/coupon_authorization_missing/);
  const stale={...current,cart:{...current.cart,items:[{...current.cart.items[0]!,quantity:2}]}};
  await assert.rejects(benefits.applyAdvancedRule(stale,offer(stale)),/cart_changed/);
  const foreign=offer(current); foreign.merchantId="other"; await assert.rejects(benefits.applyAdvancedRule(current,foreign),/not_authorized/);
  assert.equal((await fresh(s)).cart.currentDiscount,10);
});

test("CS-06 new discounts over cap reject in preflight before quota and keep prior effects", async () => {
  const s=session(); await persist(s); const current=(await benefits.applyAdvancedRule(s,offer(s,25)))!;
  await assert.rejects(benefits.assertCouponResultAllowed({merchantId:"m",sessionId:s.sessionId,discount_applied:10,coupon:{id:"coupon",code:"COUPON"}}),/combined_cap_exceeded/);
  assert.equal((await db.query("SELECT count(*)::int n FROM coupon_redemptions")).rows[0].n,0);
  const result=await coupon(current); await assert.rejects(benefits.applyCoupon(current,result),/combined_cap_exceeded/);
  assert.equal((await fresh(s)).cart.currentDiscount,25);
  assert.equal((await db.query("SELECT status FROM coupon_redemptions WHERE id=$1",[result.redemption_id])).rows[0].status,"cancelled");
});

test("CS-05 policy changes shrink an unbound reservation but never release a payment-pending commitment", async () => {
  await fund(); const s=session(); await persist(s); await service.reserveCheckout(s,3000,"reserve");
  await configure({...rules,combination:{...rules.combination!,maximumCombinedDiscountBps:1500}});
  assert.equal((await service.quoteCheckout(s)).reservedCents,1500);
  await service.preparePayment(s,"payment");
  await configure({...rules,combination:{...rules.combination!,maximumCombinedDiscountBps:500}});
  assert.equal((await service.wallet("m","buyer")).balance.reservedCents,1500);
  await assert.rejects(benefits.applyCartChange({...s,cart:{...s.cart,items:[{...s.cart.items[0]!,quantity:2}]}}),/payment_in_progress/);
  assert.equal((await service.wallet("m","buyer")).balance.reservedCents,1500);
});

test("CS-07 reset releases coupon quota and cash atomically and advances journal versions 1,2,3", async () => {
  await fund(); const s=session(); await persist(s); const one=(await benefits.applyCoupon(s,await coupon(s)))!;
  await service.reserveCheckout(one,1000,"reserve");
  const reset=(await benefits.applyCartChange({...one,cart:{...one.cart,total:200,items:[{...one.cart.items[0]!,quantity:2}]},shipping:{...one.shipping!,customerPrice:30,realCost:30}}))!;
  assert.equal(reset.cart.currentDiscount,0); assert.equal(reset.cart.commercialBenefitsVersion,2); assert.equal(reset.shipping!.customerPrice,30);
  assert.equal((await service.wallet("m","buyer")).balance.reservedCents,0);
  assert.equal((await db.query("SELECT status FROM coupon_redemptions")).rows[0].status,"cancelled");
  const three=(await benefits.applyCoupon(reset,await coupon(reset,10)))!; assert.equal(three.cart.commercialBenefitsVersion,3);
  assert.deepEqual((await db.query("SELECT version FROM cashback_benefit_events ORDER BY version")).rows.map(r=>r.version),[1,2,3]);
});

test("CS-07 HTTP publication mode requires combination while legacy core stays compatible without new tables", async () => {
  const legacy={...rules}; delete legacy.combination; await service.saveDraft("m",legacy,"owner");
  await assert.rejects(service.publishProgram("m","owner",{requireCombination:true}),/combination_required/);
  await service.publishProgram("m","owner");
  // Legacy operations must not depend on the new tables, rules or coupon journal.
  await db.query("ALTER TABLE cashback_checkout_benefits RENAME TO unavailable_benefits");
  await db.query("ALTER TABLE merchant_rules RENAME TO unavailable_rules");
  try {
    const s=session(); await persist(s); await fund(); assert.equal((await service.quoteCheckout(s)).maximumRedeemCents,3000);
    assert.equal(await benefits.applyAdvancedRule(s,offer(s)),null); assert.equal(await benefits.applyCartChange(s),null); await benefits.assertMutable(s);
  } finally { await db.query("ALTER TABLE unavailable_benefits RENAME TO cashback_checkout_benefits"); await db.query("ALTER TABLE unavailable_rules RENAME TO merchant_rules"); }
});

test("CS-01 and CS-07 HTTP mutation responses retain the authoritative general cap and enforce new publication", async () => {
  const controller=new CashbackMerchantController(service,{} as CashbackQueriesService);
  const req={user:{merchantId:"m",userId:"owner",role:"owner"}};
  const legacy={...rules}; delete legacy.combination;
  const initial=await controller.getProgram(req);
  assert.equal(initial.generalDiscountCapBps,2000);
  const legacyDraft=await controller.saveDraft(req,{rules:legacy,expectedRevision:initial.configurationRevision!,idempotencyKey:"legacy-draft"});
  assert.equal(legacyDraft.generalDiscountCapBps,2000);
  await assert.rejects(controller.publish(req,{expectedRevision:legacyDraft.configurationRevision!,idempotencyKey:"legacy-publish"}),/combination_required/);
  const completeDraft=await controller.saveDraft(req,{rules,expectedRevision:legacyDraft.configurationRevision!,idempotencyKey:"complete-draft"});
  assert.equal(completeDraft.generalDiscountCapBps,2000);
  const published=await controller.publish(req,{expectedRevision:completeDraft.configurationRevision!,idempotencyKey:"complete-publish"}); assert.equal(published.generalDiscountCapBps,2000); assert.deepEqual(published.published!.combination,rules.combination);
  const paused=await controller.pause(req); assert.equal(paused.generalDiscountCapBps,2000); assert.equal(paused.status,"paused");
  const ended=await controller.end(req); assert.equal(ended.generalDiscountCapBps,2000); assert.equal(ended.status,"ended");
});

test("CS-05 and CS-07 payment retries preserve exact origin and rule snapshots after merchant policy changes", async () => {
  await fund(); const s=session(); await persist(s);
  const composed=(await benefits.applyAdvancedRule((await benefits.applyCoupon(s,await coupon(s)))!,offer(s)))!;
  await service.reserveCheckout(composed,1500,"reserve"); const prepared=await service.preparePayment(composed,"payment");
  assert.equal(prepared.cashbackCents,1500);
  const snapshot=(await db.query("SELECT data FROM cashback_earning_quotes WHERE id=$1",[prepared.earningQuoteId])).rows[0].data;
  assert.deepEqual(snapshot.rules.combination,rules.combination); assert.equal(snapshot.combinationContext.origins.couponCents,1000); assert.equal(snapshot.combinationContext.origins.advancedRuleCents,500);
  assert.equal(snapshot.cashbackCents,1500); assert.equal(snapshot.baseCents,7000); assert.equal(snapshot.orderTotalCents,8000); assert.equal(snapshot.earnCents,350);
  await configure({...rules,combination:{...rules.combination!,allowCoupons:false,maximumCombinedDiscountBps:500}});
  assert.deepEqual(await service.preparePayment(composed,"payment"),prepared);
  const preserved=(await db.query("SELECT data FROM cashback_earning_quotes WHERE id=$1",[prepared.earningQuoteId])).rows[0].data;
  assert.deepEqual(preserved,snapshot); assert.equal((await service.wallet("m","buyer")).balance.reservedCents,1500);
});
