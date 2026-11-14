import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import type { CheckoutSession, CashbackRules } from "@zyon/shared-types";
import { CashbackRepository } from "./cashback.repository.js";
import { CashbackService } from "../application/cashback.service.js";
import { CashbackQueriesService } from "../application/cashback-queries.service.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";

// Never reads DATABASE_URL or a project .env. This is the dedicated local test container.
const databaseUrl = "postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback";
const schema = `cashback_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const bootstrap = new pg.Client({ connectionString: databaseUrl });
let prisma: PrismaClient; let service: CashbackService; let queries: CashbackQueriesService;
const rules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null,
  monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays: 90,
  minimumRedeemOrderCents: 5000, maximumRedeemBps: 2000, maximumRedeemCents: null, allowWithDiscounts: false,
  terms: "Crédito nesta loja; restituições mantêm a validade original e ganhos gastos revogados são perdas da loja." };

before(async () => {
  await bootstrap.connect(); await bootstrap.query(`CREATE SCHEMA "${schema}"`); await bootstrap.query(`SET search_path TO "${schema}"`);
  await bootstrap.query(`CREATE TABLE buyer_accounts(global_user_id TEXT PRIMARY KEY,display_name TEXT,email TEXT);
    CREATE TABLE buyer_identities(merchant_id TEXT,identity_key TEXT,global_user_id TEXT,PRIMARY KEY(merchant_id,identity_key));
    CREATE TABLE checkout_sessions(merchant_id TEXT,session_id TEXT,global_user_id TEXT,cart JSONB,shipping JSONB,PRIMARY KEY(merchant_id,session_id));
    CREATE TABLE whatsapp_sessions(merchant_id TEXT,checkout_session_id TEXT,buyer_phone TEXT);
    CREATE TABLE payment_intents(id TEXT PRIMARY KEY,merchant_id TEXT,session_id TEXT,idempotency_key TEXT,status TEXT,amount_cents INTEGER,amount_breakdown JSONB);
    CREATE TABLE completed_orders(id TEXT PRIMARY KEY,merchant_id TEXT,session_id TEXT,external_order_id TEXT,status TEXT,completed_at TIMESTAMPTZ DEFAULT now(),fulfilled_at TIMESTAMPTZ,order_total DECIMAL(12,4));`);
  await bootstrap.query(await readFile(new URL("../../../../prisma/migrations/20261114091000_buyer_verified_phones/migration.sql", import.meta.url), "utf8"));
  await bootstrap.query(await readFile(new URL("../../../../prisma/migrations/20261114120000_cashback/migration.sql", import.meta.url), "utf8"));
  prisma = new PrismaClient({ datasources: { db: { url: `${databaseUrl}?schema=${schema}` } } });
  const repository = new CashbackRepository(prisma); service = new CashbackService(repository); queries = new CashbackQueriesService(repository, service);
});
after(async () => { await prisma?.$disconnect(); await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await bootstrap.end(); });
beforeEach(async () => {
  await bootstrap.query(`TRUNCATE cashback_refund_operations,cashback_buyer_aliases,cashback_event_receipts,cashback_earning_quotes,cashback_budget_periods,cashback_ledger_entries,cashback_reservations,cashback_grants,cashback_wallets,cashback_rule_versions,cashback_programs,buyer_verified_phones,buyer_identities,whatsapp_sessions,checkout_sessions,payment_intents,completed_orders,buyer_accounts CASCADE`);
});
async function account(id = "buyer-a", name = "Ana") { await bootstrap.query("INSERT INTO buyer_accounts VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [id, name, `${id}@example.test`]); }
function session(id: string, buyerId = "buyer-a", merchantId = "merchant-a", productType: "physical" | "digital" | "service" | "food" = "physical", amount = 100): CheckoutSession {
  const now = new Date().toISOString();
  return { merchantId, sessionId: id, globalUserId: buyerId, conversationId: `conv-${id}`, cart: { currency: "BRL", total: amount, items: [{ sku: "sku-a", variantId: "variant-a", name: "Produto", price: amount, quantity: 1, productType }] }, abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: now, updatedAt: now };
}
async function persist(s: CheckoutSession) { await bootstrap.query("INSERT INTO checkout_sessions VALUES($1,$2,$3,$4,$5)", [s.merchantId, s.sessionId, s.globalUserId, JSON.stringify(s.cart), JSON.stringify(s.shipping ?? null)]); }
async function configure(merchantId = "merchant-a", value = rules) { await service.saveDraft(merchantId, value, "owner"); return service.publishProgram(merchantId, "owner"); }
async function fund(buyerId = "buyer-a", amountCents = 3000, merchantId = "merchant-a") { return service.adjustWallet(merchantId, buyerId, { amountCents, reason: "Crédito de atendimento", expiryDays: null, idempotencyKey: randomUUID() }, "owner"); }
async function createPayment(s: CheckoutSession, key: string, orderId: string, status = "approved") {
  const binding = await service.preparePayment(s, key); const id = randomUUID();
  const gross = s.cart.items.reduce((n, i) => n + Math.round(i.price * 100) * i.quantity, 0);
  const discountCents = Math.round((s.cart.currentDiscount ?? 0) * 100); const shipping = Math.round((s.shipping?.customerPrice ?? 0) * 100);
  const total = gross - discountCents - binding.cashbackCents + shipping;
  const breakdown = { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(s), itemsSubtotalCents: gross, discountCents, cashbackCents: binding.cashbackCents,
    cashbackReservationId: binding.reservationId, cashbackEarningQuoteId: binding.earningQuoteId, shippingCents: shipping, platformFeeCents: 99, totalCents: total + 99 };
  await bootstrap.query("INSERT INTO payment_intents VALUES($1,$2,$3,$4,$5,$6,$7)", [id, s.merchantId, s.sessionId, key, status, total + 99, JSON.stringify(breakdown)]);
  await service.bindPayment(s.merchantId, s.sessionId, key, id);
  if (status === "approved") await bootstrap.query("INSERT INTO completed_orders(id,merchant_id,session_id,external_order_id,status,order_total) VALUES($1,$2,$3,$4,'approved',$5)", [randomUUID(), s.merchantId, s.sessionId, orderId, total / 100]);
  return { id, total, binding, confirm: () => service.confirmedPayment({ merchantId: s.merchantId, paymentIntentId: id, session: s, orderId, orderTotalCents: total }) };
}

test("CB-01 absent program is disabled with no prefilled rules", async () => {
  assert.deepEqual(await service.getProgram("merchant-a"), { merchantId: "merchant-a", status: "disabled", draft: null, published: null, version: 0, updatedAt: null });
  await service.saveDraft("merchant-a", {}, "owner"); await assert.rejects(service.publishProgram("merchant-a", "owner"), /required/);
});
test("CB-03 publication versions snapshots and pause preserves existing credit", async () => {
  await account(); await configure(); await fund(); const s = session("site"); await persist(s);
  await service.saveDraft("merchant-a", { ...rules, earnRateBps: 1000 }, "owner");
  assert.equal((await service.getProgram("merchant-a")).published!.earnRateBps, 500);
  assert.equal((await service.publishProgram("merchant-a", "owner")).version, 2);
  await service.pauseProgram("merchant-a", "owner");
  const q = await service.quoteCheckout(s); assert.equal(q.programActive, false); assert.equal(q.maximumRedeemCents, 2000); assert.equal(q.estimatedEarnCents, 0);
  await service.reserveCheckout(s, 2000, "reserve"); assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.reservedCents, 2000);
});
test("CB-07 two tenants and forged buyer-session identities stay isolated", async () => {
  await account(); await configure(); await configure("merchant-b"); await fund(); await fund("buyer-a", 500, "merchant-b");
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.availableCents, 3000);
  assert.equal((await service.wallet("merchant-b", "buyer-a")).balance.availableCents, 500);
  const s = session("site"); await persist(s);
  await assert.rejects(service.quoteCheckout({ ...s, globalUserId: "other-buyer" }), /session_changed/);
});
test("CB-08 concurrent PostgreSQL reservations cannot double spend", async () => {
  await account(); await configure(); await fund(); const a = session("a"), b = session("b"); await persist(a); await persist(b);
  const outcomes = await Promise.allSettled([service.reserveCheckout(a, 2000, "a"), service.reserveCheckout(b, 2000, "b")]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
  const balance = (await service.wallet("merchant-a", "buyer-a")).balance; assert.equal(balance.availableCents, 1000); assert.equal(balance.reservedCents, 2000);
});
test("CB-09 retry receipts persist exactly one effect and reject changed input", async () => {
  await account(); await configure(); await fund(); const s = session("a"); await persist(s);
  await service.reserveCheckout(s, 1000, "stable"); await service.reserveCheckout(s, 1000, "stable");
  await assert.rejects(service.reserveCheckout(s, 2000, "stable"), /idempotency_input_mismatch/);
  const count = await bootstrap.query("SELECT count(*)::int n FROM cashback_ledger_entries WHERE type='reserve'"); assert.equal(count.rows[0].n, 1);
});
test("CB-11 proportional refund returns external money and original credit exactly once", async () => {
  await account(); await configure(); await fund(); const s = session("a"); s.cart.items[0]!.quantity = 2; s.cart.items[0]!.price = 50; await persist(s);
  await service.reserveCheckout(s, 2000, "reserve"); const p = await createPayment(s, "pay", "order");
  assert.equal(p.total, 8000); await p.confirm();
  const preview = await service.previewRefundOrder({ merchantId: "merchant-a", orderId: "order", returnedItems: [{ variantId: "variant-a", quantity: 1 }] });
  assert.equal(preview!.externalRefundCents, 4000); assert.equal(preview!.cashbackRestoreCents, 1000);
  const input = { merchantId: "merchant-a", orderId: "order", returnedItems: [{ variantId: "variant-a", quantity: 1 }], commandKey: "return-1" };
  assert.deepEqual(await service.processRefundOrder(input), { restoredCents: 1000, reversedCents: 200 });
  assert.deepEqual(await service.processRefundOrder(input), { restoredCents: 1000, reversedCents: 200 });
  const b = (await service.wallet("merchant-a", "buyer-a")).balance; assert.equal(b.availableCents, 2200); assert.equal(b.usedCents, 1000);
  const final = await service.previewRefundOrder({ merchantId: "merchant-a", orderId: "order", returnedItems: [{ variantId: "variant-a", quantity: 1 }] });
  assert.equal(final!.externalRefundCents, 4099); assert.equal(final!.cashbackRestoreCents, 1000); assert.equal(final!.fullOrderReturn, true);
  await service.processRefundOrder({ ...input, commandKey: "return-2" });
  const completed = (await service.wallet("merchant-a", "buyer-a")).balance;
  assert.equal(completed.availableCents, 3000); assert.equal(completed.usedCents, 0);
});
test("CB-13 reservations are bound to the authoritative cart and verified identity", async () => {
  await configure(); const anonymous = session("anonymous", "anon"); await persist(anonymous);
  await assert.rejects(service.reserveCheckout(anonymous, 100, "anon"), /verified_identity_required/);
  await account(); await fund(); const s = session("a"); await persist(s); await service.reserveCheckout(s, 1000, "r");
  s.cart.items[0]!.price = 200; s.cart.total = 200; await bootstrap.query("UPDATE checkout_sessions SET cart=$1 WHERE session_id='a'", [JSON.stringify(s.cart)]);
  const changed = await service.quoteCheckout(s); assert.equal(changed.reservedCents, 0); assert.equal(changed.availableCents, 3000);
});
test("CB-14 pending payment remains reserved after lease expiration", async () => {
  await account(); await configure(); await fund(); const s = session("a"); await persist(s); await service.reserveCheckout(s, 2000, "r");
  const p = await createPayment(s, "pay", "order", "pending"); await bootstrap.query("UPDATE cashback_earning_quotes SET created_at=now()-interval '2 days'");
  const result = await service.reconcile("merchant-a"); assert.equal(result.issues[0]?.code, "cashback_payment_requires_reconciliation");
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.reservedCents, 2000);
  await service.failedPayment({ merchantId: "merchant-a", paymentIntentId: p.id }); assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.reservedCents, 2000);
  await bootstrap.query("UPDATE payment_intents SET status='failed' WHERE id=$1", [p.id]); await service.failedPayment({ merchantId: "merchant-a", paymentIntentId: p.id });
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.reservedCents, 0);
});
test("CB-16 every supported product type observes payment or fulfilled release milestone", async () => {
  await account(); await configure("merchant-a", { ...rules, releaseTrigger: "order_fulfilled" });
  for (const type of ["physical", "digital", "service", "food"] as const) {
    const s = session(type, "buyer-a", "merchant-a", type); await persist(s); const p = await createPayment(s, `pay-${type}`, `order-${type}`); await p.confirm();
  }
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.pendingCents, 2000);
  await bootstrap.query("UPDATE completed_orders SET fulfilled_at=now() WHERE external_order_id IN ('order-digital','order-service','order-food','order-physical')");
  const r = await service.reconcile("merchant-a"); assert.deepEqual(r.issues, []);
  const balance = (await service.wallet("merchant-a", "buyer-a")).balance; assert.equal(balance.pendingCents, 0); assert.equal(balance.availableCents, 2000);
});
test("CB-18 customer filters and pagination are server scoped", async () => {
  await account("buyer-a", "Ana"); await account("buyer-b", "Bruno"); await configure(); await fund(); await fund("buyer-b", 500);
  const first = await queries.customers("merchant-a", { page: 1, pageSize: 1 }); assert.equal(first.total, 2); assert.equal(first.items[0]!.buyerId, "buyer-a");
  const filtered = await queries.customers("merchant-a", { q: "Bruno", filter: "never_used" }); assert.equal(filtered.total, 1); assert.equal(filtered.items[0]!.buyerId, "buyer-b");
  assert.equal((await queries.customers("other", {})).total, 0);
});
test("CB-19 metrics distinguish current balance from period movements", async () => {
  await account(); await configure(); const s = session("a"); await persist(s); const p = await createPayment(s, "pay", "order"); await p.confirm();
  const metrics = await queries.metrics("merchant-a", {}); assert.equal(metrics.grantedCents, 500); assert.equal(metrics.releasedCents, 500); assert.equal(metrics.availableCents, 500); assert.equal(metrics.buyersGranted, 1);
  const old = await queries.metrics("merchant-a", { from: "2020-01-01T00:00:00Z", to: "2020-01-02T00:00:00Z" }); assert.equal(old.grantedCents, 0); assert.equal(old.availableCents, 500);
});
test("CB-22 manual adjustments require reason and retry safely without touching reserved funds", async () => {
  await account(); await configure(); await assert.rejects(service.adjustWallet("merchant-a", "buyer-a", { amountCents: 100, reason: "x", idempotencyKey: "bad", expiryDays: null }, "owner"), /adjustment_invalid/);
  const input = { amountCents: 3000, reason: "Ajuste atendimento", idempotencyKey: "stable", expiryDays: null };
  await service.adjustWallet("merchant-a", "buyer-a", input, "owner"); await service.adjustWallet("merchant-a", "buyer-a", input, "owner");
  const s = session("a"); await persist(s); await service.reserveCheckout(s, 2000, "r");
  await assert.rejects(service.adjustWallet("merchant-a", "buyer-a", { ...input, amountCents: -2000, idempotencyKey: "negative" }, "owner"), /insufficient_available/);
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.reservedCents, 2000);
});
test("CB-23 reconciliation recovers committed order after crash before grant receipt", async () => {
  await account(); await configure(); const s = session("a"); await persist(s); const p = await createPayment(s, "pay", "order");
  const recovered = await service.reconcile("merchant-a"); assert.deepEqual(recovered.issues, []);
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.availableCents, 500);
  await p.confirm(); await service.reconcile("merchant-a");
  const count = await bootstrap.query("SELECT count(*)::int n FROM cashback_ledger_entries WHERE type='grant'"); assert.equal(count.rows[0].n, 1);
});
test("CB-23 simultaneous earning promises respect merchant budget", async () => {
  await account(); await configure("merchant-a", { ...rules, monthlyBudgetCents: 500 }); const a = session("a"), b = session("b"); await persist(a); await persist(b);
  const prepared = await Promise.all([service.preparePayment(a, "a"), service.preparePayment(b, "b")]);
  assert.equal(prepared.filter(x => x.earningQuoteId).length, 1);
  const budget = await bootstrap.query("SELECT committed_cents::int n FROM cashback_budget_periods"); assert.equal(budget.rows[0].n, 500);
});
test("CB-07 verified phone links site and WhatsApp to one canonical wallet without rewriting ledger", async () => {
  await account("canonical"); await configure(); const wa = session("wa", "wa-anonymous"); await persist(wa);
  await bootstrap.query("INSERT INTO whatsapp_sessions VALUES('merchant-a','wa','5511999990000')");
  await bootstrap.query("INSERT INTO buyer_identities VALUES('merchant-a','phone:5511999990000','wa-anonymous')");
  await fund("wa-anonymous", 1000); await fund("canonical", 500);
  await bootstrap.query("INSERT INTO buyer_verified_phones(phone,buyer_id,verification_id) VALUES('5511999990000','canonical','verified-proof')");
  const wallet = await service.wallet("merchant-a", "canonical"); assert.equal(wallet.buyerId, "canonical"); assert.equal(wallet.balance.availableCents, 1500);
  assert.equal((await service.wallet("merchant-a", "wa-anonymous")).balance.availableCents, 1500);
  const customers = await queries.customers("merchant-a", {}); assert.equal(customers.total, 1); assert.equal(customers.items[0]!.buyerId, "canonical");
  const historical = await bootstrap.query("SELECT buyer_id FROM cashback_ledger_entries WHERE amount_cents=1000"); assert.equal(historical.rows[0].buyer_id, "wa-anonymous");
  const live = await bootstrap.query("SELECT global_user_id FROM checkout_sessions WHERE session_id='wa'"); assert.equal(live.rows[0].global_user_id, "canonical");
  const currentWa = { ...wa, globalUserId: "canonical" }; assert.equal((await service.quoteCheckout(currentWa)).availableCents, 1500);
});
test("CB-07 phone text alone cannot join wallets or established accounts", async () => {
  await account("canonical"); await configure(); await fund("canonical", 500);
  await bootstrap.query("INSERT INTO buyer_identities VALUES('merchant-a','phone:5511999990000','wa-anonymous')");
  await assert.rejects(service.linkVerifiedIdentity({ merchantId: "merchant-a", previousBuyerId: "wa-anonymous", canonicalBuyerId: "canonical", verificationId: "not-a-proof" }), /proof_required/);
  assert.equal((await service.wallet("merchant-a", "canonical")).balance.availableCents, 500);
});

test("CB-11 competing partial refunds serialize before external submission and sum to the exact capture", async () => {
  await account(); await configure(); await fund(); const s = session("a"); s.cart.items[0]!.quantity = 2; s.cart.items[0]!.price = 50; await persist(s);
  await service.reserveCheckout(s, 2000, "reserve"); const p = await createPayment(s, "pay", "order"); await p.confirm();
  const first = { merchantId: "merchant-a", orderId: "order", returnedItems: [{ variantId: "variant-a", quantity: 1 }], commandKey: "return-a" };
  const second = { ...first, commandKey: "return-b" };
  const claims = await Promise.allSettled([service.claimRefundOrder(first, 4000), service.claimRefundOrder(second, 4000)]);
  assert.equal(claims.filter(r => r.status === "fulfilled" && r.value.claimed).length, 1);
  assert.equal(claims.filter(r => r.status === "rejected").length, 1);
  const won = claims[0]!.status === "fulfilled" ? first : second;
  const blocked = won.commandKey === first.commandKey ? second : first;
  assert.deepEqual(await service.claimRefundOrder(won, 4000), { claimed: false });
  await service.refundProviderFailed(won);
  assert.deepEqual(await service.claimRefundOrder(won, 4000), { claimed: false });
  assert.deepEqual(await service.claimRefundOrder(blocked, 4000), { claimed: true });
  await service.processRefundOrder(blocked);
  const final = { ...first, commandKey: "return-final" };
  await assert.rejects(service.claimRefundOrder(final, 4000), /quote_changed/);
  assert.deepEqual(await service.claimRefundOrder(final, 4099), { claimed: true }); await service.processRefundOrder(final);
  const completed = await bootstrap.query("SELECT SUM(amount_cents)::int n FROM cashback_refund_operations WHERE state='completed'");
  assert.equal(completed.rows[0].n, 8099);
  const balance = (await service.wallet("merchant-a", "buyer-a")).balance;
  assert.equal(balance.availableCents, 3000); assert.equal(balance.usedCents, 0);
});

test("CB-17 integrated commerce carts are rejected for cashback without changing their payment", async () => {
  await account(); await configure(); await fund(); const s = session("external"); s.cart.commerceCartRef = "remote-authority"; await persist(s);
  const q = await service.quoteCheckout(s); assert.equal(q.eligible, false); assert.equal(q.reason, "cashback_external_cart_not_supported");
  assert.deepEqual(await service.preparePayment(s, "pay"), { cashbackCents: 0, reservationId: null, earningQuoteId: null });
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.availableCents, 3000);
});

test("CB-11 provider terminal refund compensates once while pending disputes never restore credit", async () => {
  await account(); await configure(); await fund(); const s = session("a"); await persist(s);
  await service.reserveCheckout(s, 2000, "reserve"); const p = await createPayment(s, "pay", "order"); await p.confirm();
  for (const status of ["approved", "chargeback_pending", "chargeback_disputed"]) {
    await bootstrap.query("UPDATE payment_intents SET status=$1 WHERE id=$2", [status, p.id]);
    assert.deepEqual(await service.confirmedExternalRefund({ merchantId: "merchant-a", paymentIntentId: p.id }), { restoredCents: 0, reversedCents: 0 });
    const balance = (await service.wallet("merchant-a", "buyer-a")).balance; assert.equal(balance.availableCents, 1400); assert.equal(balance.usedCents, 2000);
  }
  await bootstrap.query("UPDATE payment_intents SET status='refunded' WHERE id=$1", [p.id]);
  assert.deepEqual(await service.confirmedExternalRefund({ merchantId: "merchant-a", paymentIntentId: p.id }), { restoredCents: 2000, reversedCents: 400 });
  const ledger = (await bootstrap.query("SELECT id,amount_cents FROM cashback_ledger_entries ORDER BY id")).rows;
  await service.confirmedExternalRefund({ merchantId: "merchant-a", paymentIntentId: p.id }); await service.reconcile("merchant-a");
  assert.deepEqual((await bootstrap.query("SELECT id,amount_cents FROM cashback_ledger_entries ORDER BY id")).rows, ledger);
  const balance = (await service.wallet("merchant-a", "buyer-a")).balance; assert.equal(balance.availableCents, 3000); assert.equal(balance.usedCents, 0);
});

test("CB-12 lost chargeback recovered by the job records spent-source loss without debt", async () => {
  await account(); await configure(); const first = session("first", "buyer-a", "merchant-a", "physical", 200); await persist(first);
  const source = await createPayment(first, "source-pay", "source-order"); await source.confirm();
  const second = session("second"); await persist(second); await service.reserveCheckout(second, 1000, "spend-source");
  const spend = await createPayment(second, "spend-pay", "spend-order"); await spend.confirm();
  await bootstrap.query("UPDATE payment_intents SET status='chargeback_lost' WHERE id=$1", [source.id]);
  const recovered = await service.reconcile("merchant-a"); assert.deepEqual(recovered.issues, []);
  const balance = (await service.wallet("merchant-a", "buyer-a")).balance;
  assert.equal(balance.availableCents, 450); assert.equal(balance.lossCents, 1000); assert.equal(balance.usedCents, 1000); assert.equal(balance.reversedCents, 1000);
});

test("CB-11 terminal refund waits for a submitted return and then compensates only remaining allocations", async () => {
  await account(); await configure(); await fund(); const s = session("a"); s.cart.items[0]!.quantity = 2; s.cart.items[0]!.price = 50; await persist(s);
  await service.reserveCheckout(s, 2000, "reserve"); const p = await createPayment(s, "pay", "order"); await p.confirm();
  const partial = { merchantId: "merchant-a", orderId: "order", returnedItems: [{ variantId: "variant-a", quantity: 1 }], commandKey: "return-partial" };
  assert.deepEqual(await service.claimRefundOrder(partial, 4000), { claimed: true });
  await bootstrap.query("UPDATE payment_intents SET status='refunded' WHERE id=$1", [p.id]);
  await assert.rejects(service.confirmedExternalRefund({ merchantId: "merchant-a", paymentIntentId: p.id }), /refund_in_progress/);
  const waiting = await service.reconcile("merchant-a"); assert.ok(waiting.issues.some(i => i.code === "cashback_refund_in_progress"));
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.usedCents, 2000);
  await service.processRefundOrder(partial);
  const recovered = await service.reconcile("merchant-a"); assert.deepEqual(recovered.issues, []);
  const balance = (await service.wallet("merchant-a", "buyer-a")).balance; assert.equal(balance.availableCents, 3000); assert.equal(balance.usedCents, 0);
  const completed = await bootstrap.query("SELECT SUM(amount_cents)::int n FROM cashback_refund_operations WHERE state='completed'"); assert.equal(completed.rows[0].n, 8099);
});

test("CB-11 terminal refund before cashback completion releases reservations and promised budget", async () => {
  await account(); await configure(); await fund(); const s = session("a"); await persist(s);
  await service.reserveCheckout(s, 2000, "reserve"); const p = await createPayment(s, "pay", "order");
  await bootstrap.query("UPDATE payment_intents SET status='refunded' WHERE id=$1", [p.id]);
  await service.confirmedExternalRefund({ merchantId: "merchant-a", paymentIntentId: p.id });
  const balance = (await service.wallet("merchant-a", "buyer-a")).balance; assert.equal(balance.availableCents, 3000); assert.equal(balance.reservedCents, 0); assert.equal(balance.usedCents, 0);
  const budget = await bootstrap.query("SELECT committed_cents::int committed,issued_cents::int issued FROM cashback_budget_periods"); assert.deepEqual(budget.rows, [{ committed: 0, issued: 0 }]);
  assert.equal((await bootstrap.query("SELECT count(*)::int n FROM cashback_ledger_entries WHERE type='grant'")).rows[0].n, 0);
});

test("CB-11 terminal status after a completed full Return has zero extra monetary effects", async () => {
  await account(); await configure(); await fund(); const s = session("a"); await persist(s);
  await service.reserveCheckout(s, 2000, "reserve"); const p = await createPayment(s, "pay", "order"); await p.confirm();
  await service.processRefundOrder({ merchantId: "merchant-a", orderId: "order", commandKey: "return-full" });
  const ledger = (await bootstrap.query("SELECT id,amount_cents FROM cashback_ledger_entries ORDER BY id")).rows;
  await bootstrap.query("UPDATE payment_intents SET status='refunded' WHERE id=$1", [p.id]);
  assert.deepEqual(await service.confirmedExternalRefund({ merchantId: "merchant-a", paymentIntentId: p.id }), { restoredCents: 0, reversedCents: 0 });
  assert.deepEqual((await bootstrap.query("SELECT id,amount_cents FROM cashback_ledger_entries ORDER BY id")).rows, ledger);
});
