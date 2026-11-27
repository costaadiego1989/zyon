import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PaymentIntentConflictError } from "../domain/payment-persistence.js";
import type { PrivateCryptoReceipt } from "../domain/ports/crypto-verifier.port.js";
import type { SavePaymentIntentWithSettlementPlanInput } from "../domain/ports/payment-repository.port.js";
import { PrismaPaymentRepository } from "./prisma-payment.repository.js";

const require = createRequire(import.meta.url);
const base = "postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback";
const schema = "payment_settlement_cbx53_" + randomUUID().replaceAll("-", "");
const databaseUrl = `${base}?schema=${schema}`;
const sql = new pg.Client({ connectionString: base });
let prisma: PrismaClient;
let created = false;

before(async () => {
  const target = new URL(base);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "15433");
  assert.equal(target.pathname, "/cashback"); assert.equal(target.search, ""); assert.equal(target.hash, "");
  const container = JSON.parse(execFileSync("docker", ["inspect", "zyon-cashback-postgres-20261118"], { encoding: "utf8", windowsHide: true }))[0];
  assert.equal(container.Name, "/zyon-cashback-postgres-20261118"); assert.equal(container.State.Running, true);
  assert.deepEqual(container.NetworkSettings.Ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "15433" }]);
  await sql.connect(); await sql.query(`CREATE SCHEMA "${schema}"`); created = true;
  const api = fileURLToPath(new URL("../../../../", import.meta.url));
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"],
    { cwd: api, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 90000, windowsHide: true, stdio: "pipe" });
  await sql.query(`SET search_path TO "${schema}"`);
  const receiptSql = await readFile(new URL("../../../../prisma/deploy-migrations/20261115230000_private_payment_receipt/migration.sql", import.meta.url), "utf8");
  await sql.query(receiptSql.slice(receiptSql.indexOf("CREATE FUNCTION")));
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, transactionOptions: { timeout: 20000, maxWait: 15000 } });
  await prisma.$connect();
}, { timeout: 120000 });

after(async () => {
  await prisma?.$disconnect();
  if (created) {
    assert.match(schema, /^payment_settlement_cbx53_[a-f0-9]{32}$/);
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  await sql.end();
});

async function arrange(crypto = false): Promise<SavePaymentIntentWithSettlementPlanInput> {
  const nonce = randomUUID().replaceAll("-", ""), merchantId = "cbx53_" + nonce, sessionId = "checkout_" + nonce;
  await prisma.merchant.create({ data: { id: merchantId, name: "Synthetic atomic settlement" } });
  await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: "buyer_" + nonce, conversationId: "conversation_" + nonce,
    createdAt: new Date("2026-11-19T12:00:00Z"), updatedAt: new Date("2026-11-19T12:00:00Z"),
    cart: { currency: "BRL", total: 10, items: [{ sku: "physical", name: "Synthetic goods", productType: "physical", quantity: 1, price: 10 }] } } });
  assert.equal(await prisma.fiscalConnection.count({ where: { merchantId } }), 0);
  const intent = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: "original", method: crypto ? "crypto" : "pix", amountCents: 1000, currency: "BRL" });
  intent.prepareCreation({ merchantId, sessionId, intentId: intent.id, amountCents: 1000, currency: "BRL", method: crypto ? "crypto" : "pix" });
  let privateReceipt: PrivateCryptoReceipt | undefined;
  if (crypto) {
    const quote: PrivateCryptoReceipt["quote"] = { chainId: 84532, chain: "base", evmNetwork: "testnet", chainLabel: "Base testnet",
      tokenAddress: "0x" + "1".repeat(40), tokenSymbol: "USDC", amountAtomic: "1000000", amountDisplay: "1",
      destinationAddress: "0x" + "2".repeat(40), quoteExpiresAt: "2030-01-01T00:00:00Z" };
    const transfer: PrivateCryptoReceipt["transfers"][number] = { chainId: quote.chainId, chain: quote.chain, network: quote.evmNetwork,
      tokenAddress: quote.tokenAddress, from: "0x" + "3".repeat(40), destinationAddress: quote.destinationAddress,
      amountAtomic: quote.amountAtomic, txHash: "0x" + "4".repeat(64), blockHash: "0x" + "5".repeat(64), blockNumber: "16", occurredAt: "2026-11-19T12:00:00Z" };
    privateReceipt = { kind: "crypto_v1", quote, transfers: [transfer] };
    intent.setBuyerFacingPayload(quote);
    intent.markApproved({ providerPaymentId: transfer.txHash, approvedAmountCents: 1000 });
  }
  return { intent, ...(privateReceipt ? { privateReceipt } : {}), settlementPlan: { merchantId, paymentIntentId: intent.id,
    provider: crypto ? "crypto" : "asaas", currency: "BRL", providerReference: "original-plan", plannedGrossCents: 1000,
    plannedPlatformFeeCents: 100, plannedMerchantNetCents: 900, plannedProviderFeeCents: 0, occurredAt: new Date("2026-11-19T12:00:00Z"),
    entries: [{ entryKey: "platform_fee", entryType: "platform_fee", direction: "credit", recipientType: "platform", plannedAmountCents: 100 },
      { entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit", recipientType: "merchant", recipientReference: merchantId, plannedAmountCents: 900 }] } };
}

async function assertPersisted(input: SavePaymentIntentWithSettlementPlanInput) {
  const snapshot = input.intent.snapshot();
  const row = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: snapshot.id } });
  assert.equal(row.version, 1); assert.equal(row.merchantId, snapshot.merchantId); assert.equal(row.sessionId, snapshot.sessionId);
  assert.equal(row.idempotencyKey, "original"); assert.equal(row.amountCents, 1000); assert.equal(row.currency, "BRL");
  assert.equal(row.method, snapshot.method); assert.equal(row.status, snapshot.status);
  assert.equal(await prisma.paymentIntent.count({ where: { merchantId: snapshot.merchantId } }), 1);
  const plans = await prisma.paymentSettlement.findMany({ where: { merchantId: snapshot.merchantId }, include: { entries: { orderBy: { sequence: "asc" } } } });
  assert.equal(plans.length, 1); const plan = plans[0]!;
  assert.equal(plan.paymentIntentId, row.id); assert.equal(plan.sequence, 1); assert.equal(plan.status, "planned");
  assert.equal(plan.provider, input.settlementPlan.provider); assert.equal(plan.providerReference, "original-plan"); assert.equal(plan.currency, "BRL");
  assert.equal(plan.plannedGrossCents, 1000); assert.equal(plan.plannedPlatformFeeCents, 100);
  assert.equal(plan.plannedMerchantNetCents, 900); assert.equal(plan.plannedProviderFeeCents, 0);
  assert.equal(plan.occurredAt.toISOString(), input.settlementPlan.occurredAt.toISOString());
  assert.deepEqual(plan.entries.map(entry => ({ merchantId: entry.merchantId, settlementId: entry.settlementId, sequence: entry.sequence,
    entryKey: entry.entryKey, entryType: entry.entryType, direction: entry.direction, recipientType: entry.recipientType,
    recipientReference: entry.recipientReference, plannedAmountCents: entry.plannedAmountCents, status: entry.status, currency: entry.currency, provider: entry.provider })),
    input.settlementPlan.entries.map((entry, index) => ({ ...entry, merchantId: row.merchantId, settlementId: plan.id, sequence: index + 1,
      recipientReference: entry.recipientReference ?? null, status: "planned", currency: "BRL", provider: input.settlementPlan.provider })));
  assert.deepEqual(row.privateReceipt, input.privateReceipt ?? null);
  return row;
}

test("CBX-53 NEW commits version1 with the exact single planned settlement for a merchant without Fiscal", async () => {
  const input = await arrange();
  await new PrismaPaymentRepository(prisma).saveIntentWithSettlementPlan(input);
  assert.equal(input.intent.snapshot().version, 1);
  await assertPersisted(input);
});

test("CBX-53 approved crypto commits its original private fiscal receipt with the same intent and settlement", async () => {
  const input = await arrange(true), repository = new PrismaPaymentRepository(prisma);
  await repository.saveIntentWithSettlementPlan(input);
  const row = await assertPersisted(input);
  assert.equal(row.status, "approved"); assert.equal(row.approvedAmountCents, 1000);
  assert.equal(row.providerPaymentId, input.privateReceipt!.transfers[0]!.txHash);
  assert.equal(input.intent.snapshot().version, 1);
  const publicSnapshot = (await repository.getIntentById(row.merchantId, row.id))!.snapshot();
  assert.equal(Object.hasOwn(publicSnapshot, "privateReceipt"), false);
  await assert.rejects(prisma.paymentIntent.update({ where: { id: row.id }, data: { privateReceipt: { replaced: true } } }), /private_payment_receipt_immutable/);
  assert.deepEqual((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: row.id } })).privateReceipt, input.privateReceipt);
});

test("CBX-53 ledger failure rolls back the intent private receipt and full plan without advancing the entity", async () => {
  const input = await arrange(true), merchantId = input.intent.snapshot().merchantId;
  assert.match(merchantId, /^cbx53_[a-f0-9]{32}$/);
  await sql.query(`CREATE FUNCTION cbx53_reject_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cbx53_ledger_failure'; END $$;
    CREATE TRIGGER cbx53_reject_entry BEFORE INSERT ON payment_settlement_entries FOR EACH ROW WHEN (NEW.merchant_id = '${merchantId}') EXECUTE FUNCTION cbx53_reject_entry()`);
  try {
    await assert.rejects(new PrismaPaymentRepository(prisma).saveIntentWithSettlementPlan(input), /cbx53_ledger_failure/);
    assert.equal(await prisma.paymentIntent.count({ where: { merchantId } }), 0);
    assert.equal(await prisma.paymentSettlement.count({ where: { merchantId } }), 0);
    assert.equal(await prisma.paymentSettlementEntry.count({ where: { merchantId } }), 0);
    assert.equal(input.intent.snapshot().version, 0);
    assert.equal(await prisma.fiscalIntent.count({ where: { merchantId } }), 0);
    assert.equal(await prisma.fiscalEvent.count({ where: { merchantId } }), 0);
  } finally { await sql.query("DROP TRIGGER cbx53_reject_entry ON payment_settlement_entries; DROP FUNCTION cbx53_reject_entry()"); }
});

test("CBX-53 concurrent version0 writers retain one winner one immutable receipt and one settlement", async () => {
  const first = await arrange(true), second = { ...first, intent: PaymentIntentEntity.rehydrate(first.intent.snapshot()) };
  const repository = new PrismaPaymentRepository(prisma);
  const outcomes = await Promise.allSettled([repository.saveIntentWithSettlementPlan(first), repository.saveIntentWithSettlementPlan(second)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const rejected = outcomes.filter(result => result.status === "rejected"); assert.equal(rejected.length, 1);
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof PaymentIntentConflictError);
  assert.deepEqual([first.intent.snapshot().version, second.intent.snapshot().version].sort(), [0, 1]);
  await assertPersisted(first);
});
