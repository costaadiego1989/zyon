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
import { CashbackBuyerController } from "../presentation/cashback.controllers.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { BuyerJwtAuthGuard } from "../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";

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
  await bootstrap.query(`TRUNCATE cashback_buyer_aliases,cashback_event_receipts,cashback_earning_quotes,cashback_budget_periods,cashback_ledger_entries,cashback_reservations,cashback_grants,cashback_wallets,cashback_rule_versions,cashback_programs,buyer_verified_phones,buyer_identities,whatsapp_sessions,checkout_sessions,payment_intents,completed_orders,buyer_accounts CASCADE`);
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

test("VERIFIER CB-16 nonphysical checkout excludes stale shipping when binding the real payment amount", async () => {
  await account(); await configure();
  const s = session("digital-with-old-freight", "buyer-a", "merchant-a", "digital");
  s.shipping = { customerPrice: 17.83, realCost: 17.83, region: "SP" };
  await persist(s);
  const binding = await service.preparePayment(s, "digital-pay");
  const id = randomUUID();
  const breakdown = { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(s), itemsSubtotalCents: 10000,
    discountCents: 0, cashbackCents: 0, cashbackReservationId: null, cashbackEarningQuoteId: binding.earningQuoteId,
    shippingCents: 0, platformFeeCents: 99, totalCents: 10099 };
  await bootstrap.query("INSERT INTO payment_intents VALUES($1,$2,$3,$4,$5,$6,$7)", [id, s.merchantId, s.sessionId, "digital-pay", "approved", 10099, JSON.stringify(breakdown)]);
  await service.bindPayment(s.merchantId, s.sessionId, "digital-pay", id);
  const frozen = await bootstrap.query("SELECT data FROM cashback_earning_quotes WHERE payment_intent_id=$1", [id]);
  assert.equal(frozen.rows[0].data.orderTotalCents, 10000);
});

test("VERIFIER CB-16 recovery uses the original payment milestone rather than restarting the waiting period", async () => {
  await account(); await configure("merchant-a", { ...rules, releaseDelayDays: 1 });
  const s = session("delayed-recovery"); await persist(s);
  const p = await createPayment(s, "delayed-pay", "old-order");
  await bootstrap.query("UPDATE completed_orders SET completed_at=now()-interval '3 days' WHERE external_order_id='old-order'");
  const result = await service.reconcile("merchant-a");
  assert.deepEqual(result.issues, []);
  const w = await service.wallet("merchant-a", "buyer-a");
  assert.equal(w.balance.availableCents, 500, "A payment from 3 days ago with a 1-day waiting period is already released");
  assert.equal(w.balance.pendingCents, 0);
});

test("VERIFIER CB-25 projection discrepancies are reported while immutable history is preserved", async () => {
  await account(); await configure(); await fund("buyer-a", 3179);
  await bootstrap.query("UPDATE cashback_wallets SET balance=jsonb_set(balance,'{availableCents}','999999') WHERE buyer_id='buyer-a'");
  const before = await bootstrap.query("SELECT id,amount_cents FROM cashback_ledger_entries ORDER BY id");
  const result = await service.reconcile("merchant-a");
  assert.ok(result.issues.some(issue => issue.merchantId === "merchant-a" && issue.reference === "buyer-a"), "Reconciliation must report a cache-versus-lots discrepancy");
  assert.deepEqual((await bootstrap.query("SELECT id,amount_cents FROM cashback_ledger_entries ORDER BY id")).rows, before.rows);
});

test("VERIFIER CB-22 an adjustment without an idempotency key is rejected before changing balance", async () => {
  await account(); await configure();
  await assert.rejects(service.adjustWallet("merchant-a", "buyer-a", { amountCents: 299, reason: "Atendimento comprovado",
    expiryDays: null, idempotencyKey: undefined as any }, "owner"), { code: "cashback_idempotency_key_invalid", status: 400 });
  assert.equal((await service.wallet("merchant-a", "buyer-a")).balance.availableCents, 0);
});

test("VERIFIER CB-07 CB-20 a global website JWT can recover verified WhatsApp credit before the alias transaction ran", async () => {
  await account("canonical"); await configure(); await fund("wa-original", 3179);
  await bootstrap.query("INSERT INTO buyer_identities VALUES('merchant-a','phone:5511999991234','wa-original')");
  const jwt = new BuyerJwtService("verifier-local-buyer-jwt-secret");
  const token = jwt.sign({ globalUserId: "canonical", email: "canonical@example.test" });
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  const guard = new BuyerJwtAuthGuard(jwt);
  assert.equal(guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any), true);
  const controller = new CashbackBuyerController(service, queries);
  await assert.rejects(controller.wallet(req, "merchant-a"), /cashback_merchant_binding_required/);
  const ledger = await bootstrap.query("SELECT id,buyer_id,amount_cents FROM cashback_ledger_entries ORDER BY id");
  await bootstrap.query("INSERT INTO buyer_verified_phones(phone,buyer_id,verification_id) VALUES('5511999991234','canonical','proof-before-alias')");
  assert.equal((await bootstrap.query("SELECT count(*) AS total FROM cashback_buyer_aliases")).rows[0].total, "0");
  const wallet = await controller.wallet(req, "merchant-a");
  assert.equal(wallet.buyerId, "canonical"); assert.equal(wallet.balance.availableCents, 3179);
  assert.deepEqual((await bootstrap.query("SELECT id,buyer_id,amount_cents FROM cashback_ledger_entries ORDER BY id")).rows, ledger.rows);
  assert.equal((await queries.customers("merchant-a", {})).total, 1);
});

test("VERIFIER CB-11 a partial food return cannot average differently priced lines sharing one variant", async () => {
  await account(); await configure(); await fund();
  const s = session("food-options", "buyer-a", "merchant-a", "food");
  s.cart.items = [
    { ...s.cart.items[0], variant: JSON.stringify(["variant-a", ["small"]]), price: 10 },
    { ...s.cart.items[0], variant: JSON.stringify(["variant-a", ["large"]]), price: 90 },
  ];
  await persist(s); await service.reserveCheckout(s, 2000, "food-reserve");
  const p = await createPayment(s, "food-payment", "food-order"); await p.confirm();
  await assert.rejects(service.previewRefundOrder({ merchantId: "merchant-a", orderId: "food-order", returnedItems: [{ variantId: "variant-a", quantity: 1 }] }),
    { status: 400 }, "The legacy variant-only return cannot identify whether the R$10 or R$90 line was returned");
  const full = await service.previewRefundOrder({ merchantId: "merchant-a", orderId: "food-order", returnedItems: [{ variantId: "variant-a", quantity: 2 }] });
  assert.equal(full?.externalRefundCents, 8099);
  assert.equal(full?.cashbackRestoreCents, 2000);
});

