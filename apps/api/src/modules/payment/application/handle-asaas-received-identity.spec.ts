import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { HandleAsaasWebhookUseCase } from "./handle-asaas-webhook.use-case.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import { AsaasWebhookController } from "../presentation/http/asaas-webhook.controller.js";
import type { CheckoutPaymentPort, CheckoutPaymentApprovedInput } from "../domain/ports/checkout-payment.port.js";

// Intended target: application/handle-asaas-received-identity.spec.ts.
// Component only: original controller/token/normalizer/usecase/dispatch/domain
// and repository including its actual immutable-ID invariant. Not HTTP/SQL.
const token = "synthetic-asaas-received-identity-token";
const events = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"] as const;
type Kind = "bound_asaas" | "unbound_asaas" | "mercadopago_preference" | "legacy_non_brl" | "legacy_provider_absent";
class ObservedPayments extends InMemoryPaymentRepository {
  reads = 0;
  override async getIntentByExternalReference(reference: string) { this.reads++; return super.getIntentByExternalReference(reference); }
  override async getIntentReferenceByProviderPaymentId(reference: string) { this.reads++; return super.getIntentReferenceByProviderPaymentId(reference); }
  override async getIntentById(merchantId: string, id: string) { this.reads++; return super.getIntentById(merchantId, id); }
}
async function fixture(kind: Kind = "bound_asaas", amountCents = 10_000) {
  const payments = new ObservedPayments();
  const approvals: CheckoutPaymentApprovedInput[] = [], failures: unknown[] = [], statuses: unknown[] = [];
  const checkout: CheckoutPaymentPort = {
    async completeAfterApproval(value) { approvals.push(value); },
    async recordPaymentFailure(value) { failures.push(value); },
    async recordPaymentStatusChanged(value) { statuses.push(value); },
  };
  const create = async (merchantId: string, provider: "asaas" | "mercadopago", method: "pix" | "card", providerId?: string, currency = "BRL", legacy = false) => {
    const value = PaymentIntentEntity.create({ merchantId, sessionId: "checkout_" + merchantId,
      idempotencyKey: "idem_" + merchantId, amountCents, currency, method });
    if (!legacy) {
      value.prepareCreation({ provider, merchantId, sessionId: "checkout_" + merchantId, intentId: value.id,
        amountCents, currency, method, providerAccountFingerprint: "a".repeat(64) });
      assert.equal(value.claimCreation("lease_" + merchantId, new Date("2026-11-22T12:00:00Z")), "create");
    }
    if (providerId) { value.markRequiresAction({ providerPaymentId: providerId }); if (!legacy) value.completeCreation("lease_" + merchantId); }
    await payments.saveIntent({ intent: value });
    return (await payments.getIntentById(merchantId, value.id))!;
  };
  const source = await create("merchant_source_a", "asaas", "pix", "pay_asaas_source_a");
  const target = await create("merchant_target_b", kind === "mercadopago_preference" ? "mercadopago" : "asaas",
    kind === "mercadopago_preference" ? "card" : "pix",
    kind === "unbound_asaas" ? undefined : kind === "mercadopago_preference" ? "pref_target_b" : "pay_asaas_target_b",
    kind === "legacy_non_brl" ? "USD" : "BRL", kind === "legacy_provider_absent");
  const before = [source.snapshot(), target.snapshot()] as const;
  payments.reads = 0;
  const useCase = new HandleAsaasWebhookUseCase(payments, new PaymentDispatchService(payments, checkout));
  const controller = new AsaasWebhookController(useCase, undefined as never);
  const invoke = async (event: string, payment: Record<string, unknown>, eventId = "evt_received_identity", header = token) => {
    const previous = process.env.ASAAS_WEBHOOK_TOKEN;
    process.env.ASAAS_WEBHOOK_TOKEN = token;
    try { return await controller.asaasWebhook(header, { id: eventId, event, payment }); }
    finally { if (previous === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN; else process.env.ASAAS_WEBHOOK_TOKEN = previous; }
  };
  const snapshot = async () => [
    (await payments.getIntentById("merchant_source_a", source.id))!.snapshot(),
    (await payments.getIntentById("merchant_target_b", target.id))!.snapshot(),
  ] as const;
  const noEffects = async (eventId = "evt_received_identity") => {
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(approvals, []); assert.deepEqual(failures, []); assert.deepEqual(statuses, []);
    assert.deepEqual(payments.capturedEvents, []);
    for (const merchantId of ["merchant_source_a", "merchant_target_b"])
      assert.equal(await payments.hasProcessedProviderEvent({ provider: "asaas", merchantId, eventId }), false);
  };
  return { payments, source, target, before, approvals, failures, statuses, invoke, snapshot, noEffects };
}

for (const event of events) {
  for (const kind of ["mercadopago_preference", "unbound_asaas", "bound_asaas"] as const) {
    test(`Asaas ${event} cannot redirect known foreign charge into ${kind}`, async () => {
      const f = await fixture(kind);
      await assert.rejects(() => f.invoke(event, { id: "pay_asaas_source_a", value: 100, externalReference: f.target.id }));
      await f.noEffects();
      // Bound Asaas is already blocked by the existing immutable-ID invariant.
      // The new guard must also cover MP's legitimate preference exception and
      // a provider request whose canonical journal has no local response yet.
    });
  }
  test(`Asaas ${event} refuses a legacy nonBRL target instead of asserting an observed currency`, async () => {
    // Deliberate legacy/domain fixture: original Asaas create adapter would
    // reject USD; no claim this was a newly admitted canonical Asaas charge.
    const f = await fixture("legacy_non_brl");
    await assert.rejects(() => f.invoke(event, { id: "pay_asaas_target_b", value: 100, externalReference: f.target.id }));
    await f.noEffects();
  });
  test(`Asaas ${event} does not round a fractional cent into a matching approval`, async () => {
    const f = await fixture();
    await assert.rejects(() => f.invoke(event, { id: "pay_asaas_target_b", value: 100.0001, externalReference: f.target.id }));
    await f.noEffects();
  });
  test(`Asaas ${event} retains the existing exact whole-cent mismatch failure`, async () => {
    const f = await fixture();
    assert.deepEqual(await f.invoke(event, { id: "pay_asaas_target_b", value: 100.01, externalReference: f.target.id }),
      { outcome: "processed", effect: "payment_value_mismatch" });
    assert.equal((await f.snapshot())[0].status, f.before[0].status);
    assert.equal((await f.snapshot())[1].status, "failed");
    assert.deepEqual(f.approvals, []); assert.equal(f.failures.length, 1);
    assert.equal(f.payments.capturedEvents.length, 1);
    assert.equal((f.payments.capturedEvents[0]!.payload as { status: string }).status, "failed");
  });
  test(`Asaas ${event} matching receipt approves once through the original pipeline`, async () => {
    const f = await fixture(), body = { id: "pay_asaas_target_b", value: "100.00", externalReference: f.target.id };
    assert.deepEqual(await f.invoke(event, body), { outcome: "processed", effect: "checkout_completed_after_payment" });
    assert.deepEqual(await f.invoke(event, body), { outcome: "duplicate" });
    assert.equal(f.approvals.length, 1); assert.equal(f.payments.capturedEvents.length, 1);
    assert.equal(f.approvals[0]!.merchantId, "merchant_target_b");
    assert.equal(f.approvals[0]!.orderTotalMajorUnits, 100); assert.equal(f.approvals[0]!.currency, "BRL");
    assert.equal((await f.snapshot())[1].approvedAmountCents, 10_000);
    assert.deepEqual((await f.snapshot())[0], f.before[0]);
  });
  test(`Asaas ${event} preserves a genuine early receipt before the local provider response`, async () => {
    const f = await fixture("unbound_asaas");
    assert.equal(f.before[1].providerPaymentId, undefined);
    assert.equal(f.before[1].creation?.state, "in_flight");
    const body = { id: "pay_early_target_b", value: 100, externalReference: f.target.id };
    assert.deepEqual(await f.invoke(event, body), { outcome: "processed", effect: "checkout_completed_after_payment" });
    assert.deepEqual(await f.invoke(event, body), { outcome: "duplicate" });
    assert.equal(f.approvals.length, 1); assert.equal(f.payments.capturedEvents.length, 1);
    const snapshots = await f.snapshot(); assert.deepEqual(snapshots[0], f.before[0]);
    assert.equal(snapshots[1].providerPaymentId, "pay_early_target_b");
    assert.equal(snapshots[1].status, "approved"); assert.equal(snapshots[1].approvedAmountCents, 10_000);
  });
}

test("Asaas corrected early receipt reuses the refused event without foreign effects", async () => {
  const f = await fixture("unbound_asaas");
  await assert.rejects(() => f.invoke("PAYMENT_RECEIVED", { id: "pay_asaas_source_a", value: 100, externalReference: f.target.id }));
  await f.noEffects();
  const body = { id: "pay_early_target_b", value: 100, externalReference: f.target.id };
  assert.deepEqual(await f.invoke("PAYMENT_RECEIVED", body), { outcome: "processed", effect: "checkout_completed_after_payment" });
  assert.deepEqual(await f.invoke("PAYMENT_RECEIVED", body), { outcome: "duplicate" });
  assert.equal(f.approvals.length, 1); assert.equal(f.payments.capturedEvents.length, 1);
  assert.deepEqual((await f.snapshot())[0], f.before[0]);
});

test("Asaas invalid token fails in the real controller before any lookup or effect", async () => {
  const f = await fixture();
  await assert.rejects(() => f.invoke("PAYMENT_RECEIVED", { id: "pay_asaas_target_b", value: 100, externalReference: f.target.id },
    "evt_received_identity", "invalid-token"), (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 401);
  assert.equal(f.payments.reads, 0); await f.noEffects();
});

test("Asaas unknown reference keeps the original ignored policy without completing a known charge", async () => {
  const f = await fixture();
  assert.deepEqual(await f.invoke("PAYMENT_RECEIVED", { id: "pay_asaas_source_a", value: 100, externalReference: "pay_int_unknown" }),
    { outcome: "ignored", reason: "intent_not_found" });
  assert.deepEqual(await f.snapshot(), f.before); assert.deepEqual(f.approvals, []);
  assert.deepEqual(f.payments.capturedEvents, []);
});
// Real Asaas receipt uses a primitive number. Its shortest observed decimal
// must preserve legitimate monetary cents, not binary multiplication equality.
for (const event of events) {
  for (const [value, cents] of [[0.29, 29], [1.23, 123], [98.04, 9804]] as const) {
    test(`Asaas ${event} preserves legitimate numeric cents ${value}`, async () => {
      const f = await fixture("bound_asaas", cents);
      assert.deepEqual(await f.invoke(event, { id: "pay_asaas_target_b", value, externalReference: f.target.id }),
        { outcome: "processed", effect: "checkout_completed_after_payment" });
      assert.equal(f.approvals.length, 1); assert.equal(f.approvals[0]!.orderTotalMajorUnits, value);
      assert.equal((await f.snapshot())[1].approvedAmountCents, cents);
      assert.deepEqual((await f.snapshot())[0], f.before[0]);
    });
  }
  test(`Asaas ${event} preserves a bound historical record without creation provider`, async () => {
    const f = await fixture("legacy_provider_absent");
    assert.equal(f.before[1].creation, undefined);
    assert.deepEqual(await f.invoke(event, { id: "pay_asaas_target_b", value: 100, externalReference: f.target.id }),
      { outcome: "processed", effect: "checkout_completed_after_payment" });
    assert.equal(f.approvals.length, 1); assert.equal((await f.snapshot())[1].approvedAmountCents, 10_000);
    assert.equal((await f.snapshot())[1].creation, undefined);
  });
  test(`Asaas ${event} rejects a tiny fractional cent instead of tolerating it as expected value`, async () => {
    const f = await fixture();
    await assert.rejects(() => f.invoke(event, { id: "pay_asaas_target_b", value: 100.000000001, externalReference: f.target.id }));
    await f.noEffects();
  });
}