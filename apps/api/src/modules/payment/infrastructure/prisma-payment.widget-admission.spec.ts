import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { widgetPaymentAuthorityFixture } from "../domain/widget-checkout-payment.fixture.js";
import type { PlannedPaymentSettlement } from "../domain/ports/payment-settlement-ledger.port.js";
import type { CaptureWidgetCheckoutPayment } from "./prisma-widget-checkout-payment-admission.js";
import { PrismaPaymentRepository } from "./prisma-payment.repository.js";

function fixture(optIn = true) {
  const data = widgetPaymentAuthorityFixture();
  const intent = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "checkout", idempotencyKey: "key", method: "pix",
    amountCents: 12849, currency: "BRL", amountBreakdown: data.authority.amountBreakdown });
  intent.prepareCreation({ ...data.scope.creation.input, method: "pix", intentId: intent.id });
  const authority = { ...data.authority, paymentId: intent.id };
  type Row = Record<string, unknown>;
  const state = { row: null as Row | null, draft: null as Row | null, fail: "", captures: 0, writes: 0,
    cart: { ...data.authority.frozenProjection.cart, _widgetCrossSellAcceptance: { private: "synthetic" } } as Record<string, unknown>,
    locks: [] as string[], capturedTx: undefined as Prisma.TransactionClient | undefined };
  const tx = {
    async $queryRaw(query: TemplateStringsArray) { state.locks.push(query.join("?")); return []; },
    checkoutSession: { async findUnique() { return { merchantId: "merchant", sessionId: "checkout", cart: state.cart, shipping: data.authority.frozenProjection.shipping }; } },
    crossStoreLineItem: { async findFirst() { return null; } },
    strategyIncentiveAssignment: { async findUnique() { return null; } },
    paymentIntent: {
      async findUnique() { return structuredClone(state.row); }, async findFirst() { return null; }, async findMany() { return []; },
      async create(args: { data: Row }) { state.writes++; state.draft = structuredClone(args.data); return args.data; },
      async updateMany(args: { data: Row }) { state.writes++; state.draft = { ...state.row, ...structuredClone(args.data) }; return { count: 1 }; },
    },
    outboxMessage: { async upsert() { if (state.fail === "outbox") throw new Error("synthetic_outbox_failure"); return {}; } },
    paymentSettlement: { async findUnique() { return null; }, async create() { if (state.fail === "settlement") throw new Error("synthetic_settlement_failure"); return { id: "settlement" }; } },
    paymentSettlementEntry: { async createMany() { return { count: 2 }; } },
  } as unknown as Prisma.TransactionClient;
  const prisma = { async $transaction<T>(work: (provided: Prisma.TransactionClient) => Promise<T>) {
    state.draft = structuredClone(state.row);
    try { const result = await work(tx); if (state.fail === "before_commit") throw new Error("synthetic_rollback");
      state.row = structuredClone(state.draft); if (state.fail === "lost_ack") throw new Error("synthetic_commit_ack_unknown"); return result;
    } catch (error) { state.draft = null; throw error; }
  } } as unknown as PrismaClient;
  const capture: CaptureWidgetCheckoutPayment = async (received, snapshot) => {
    state.captures++; state.capturedTx = received;
    assert.equal(received, tx); assert.equal(snapshot.id, intent.id);
    if ((snapshot.version ?? 0) === 0)
      assert.equal(intent.snapshot().creation!.widgetCheckoutAuthority, undefined, "entity cannot acknowledge before transaction commits");
    return structuredClone(authority);
  };
  const repo = new PrismaPaymentRepository(prisma, undefined, optIn ? capture : undefined);
  const plan: PlannedPaymentSettlement = { merchantId: "merchant", paymentIntentId: intent.id, provider: "synthetic", currency: "BRL",
    plannedGrossCents: 12849, plannedPlatformFeeCents: 149, plannedMerchantNetCents: 12700, plannedProviderFeeCents: 0,
    occurredAt: new Date("2026-10-20T12:00:00Z"), entries: [
      { entryKey: "platform_fee", entryType: "platform_fee", direction: "credit", recipientType: "platform", plannedAmountCents: 149 },
      { entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit", recipientType: "merchant", plannedAmountCents: 12700 },
    ] };
  const event: DomainEventEnvelope = { event_id: "event", event_type: "payment.status.changed", schema_version: 1, merchant_id: "merchant",
    occurred_at: "2026-10-20T12:00:00Z", correlation_id: "correlation", causation_id: "cause", producer: "checkout", payload: { payment_intent_id: intent.id, status: "pending" } };
  return { intent, authority, state, repo, plan, event, tx };
}
type Variant = "plain" | "settlement" | "outbox";
async function save(f: ReturnType<typeof fixture>, variant: Variant) {
  if (variant === "plain") return f.repo.saveIntent({ intent: f.intent });
  if (variant === "settlement") return f.repo.saveIntentWithSettlementPlan({ intent: f.intent, settlementPlan: f.plan });
  return f.repo.saveIntentWithOutbox({ intent: f.intent }, f.event);
}
for (const variant of ["plain", "settlement", "outbox"] as const)
  test(`${variant} captures widget sibling in same tx and acknowledges only after commit`, async () => {
    const f = fixture(); await save(f, variant);
    assert.equal(f.state.captures, 1); assert.equal(f.state.capturedTx, f.tx);
    assert.equal(f.intent.snapshot().version, 1);
    assert.deepEqual(f.intent.snapshot().creation!.widgetCheckoutAuthority, f.authority);
    assert.deepEqual((f.state.row!.creation as Record<string, unknown>).widgetCheckoutAuthority, f.authority);
    assert.equal("widgetCheckoutAuthority" in f.intent.snapshot().creation!.input, false);
    const sessionIndex = f.state.locks.findIndex(sql => sql.includes("FROM checkout_sessions"));
    for (const table of ["merchant_rules", "checkout_settings", "own_delivery_configs"])
      assert.ok(f.state.locks.findIndex(sql => sql.includes(`FROM ${table}`)) < sessionIndex, `${table} fence before session`);
  });
for (const [variant, fault] of [["plain", "before_commit"], ["plain", "lost_ack"], ["settlement", "settlement"], ["outbox", "outbox"]] as const)
  test(`${fault} never acknowledges captured widget authority on caller entity`, async () => {
    const f = fixture(); f.state.fail = fault; await assert.rejects(save(f, variant), /synthetic/);
    assert.equal(f.intent.snapshot().creation!.widgetCheckoutAuthority, undefined); assert.equal(f.intent.snapshot().version, 0);
    assert.equal(f.state.row !== null, fault === "lost_ack");
  });
test("unconfigured generic repository keeps guard55 and does not write", async () => {
  const f = fixture(false); await assert.rejects(save(f, "plain"), /cross_sell_quote_review_required/);
  assert.equal(f.state.writes, 0); assert.equal(f.state.captures, 0);
});
test("new journal cannot arrive precaptured through entity acknowledgement", async () => {
  const f = fixture(); f.intent.acknowledgeWidgetCheckoutCapture(f.authority);
  await assert.rejects(save(f, "plain"), /payment_widget_checkout_authority_conflict/); assert.equal(f.state.captures, 0); assert.equal(f.state.writes, 0);
});
test("first-send revalidates exact stored authority without rewriting or acknowledging it again", async () => {
  const f = fixture(); await save(f, "plain"); f.state.captures = 0;
  f.intent.claimCreation("lease", new Date("2026-10-20T12:00:01Z")); await save(f, "plain");
  assert.equal(f.state.captures, 1); assert.equal(f.intent.snapshot().version, 2);
  assert.deepEqual(f.intent.snapshot().creation!.widgetCheckoutAuthority, f.authority);
});
for (const fault of ["version", "authority", "identity", "receipt-removed"] as const)
  test(`first-send ${fault} fails before callback or writes`, async () => {
    const f = fixture(); await save(f, "plain"); f.state.captures = 0; f.state.writes = 0;
    f.intent.claimCreation("lease", new Date("2026-10-20T12:00:01Z"));
    if (fault === "version") f.state.row!.version = 2;
    if (fault === "authority") Reflect.set((f.state.row!.creation as Record<string, unknown>).widgetCheckoutAuthority as object, "acceptanceEventId", "foreign");
    if (fault === "identity") f.state.row!.idempotencyKey = "foreign";
    if (fault === "receipt-removed") delete f.state.cart._widgetCrossSellAcceptance;
    await assert.rejects(save(f, "plain")); assert.equal(f.state.captures, 0); assert.equal(f.state.writes, 0);
  });
test("already-attempted uncertain recovery preserves frozen authority without current admission", async () => {
  const f = fixture(); await save(f, "plain");
  const snapshot = f.intent.snapshot(); snapshot.creation = { ...snapshot.creation!, state: "uncertain", firstAttemptAt: "2026-10-20T12:00:01Z", reason: "ack_unknown" };
  f.state.row!.creation = structuredClone(snapshot.creation); f.state.captures = 0;
  const recovered = PaymentIntentEntity.rehydrate(snapshot); recovered.claimCreation("recover", new Date("2026-10-20T12:02:00Z"));
  delete f.state.cart._widgetCrossSellAcceptance; f.state.cart.total = 999;
  await f.repo.saveIntent({ intent: recovered }); assert.equal(f.state.captures, 0);
  assert.deepEqual(recovered.snapshot().creation!.widgetCheckoutAuthority, f.authority);
});
