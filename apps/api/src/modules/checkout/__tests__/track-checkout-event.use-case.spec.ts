import test from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import type { CheckoutSettingsPort } from "../domain/ports/checkout-settings.port.js";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryInterventionLedger } from "../infrastructure/in-memory-intervention-ledger.js";
import { TrackCheckoutEventUseCase } from "../application/use-cases/track-checkout-event.use-case.js";
import { InMemoryPaymentRepository } from "../../payment/infrastructure/in-memory-payment.repository.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { PaymentIntentEntity, type PaymentIntentStatus } from "../../payment/domain/payment-intent.entity.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";

for (const status of ["pending", "requires_action", "approved", "refunded", "failed", "cancelled"] as PaymentIntentStatus[]) {
  test(`automatic discounts preserve a committed ${status} payment quote`, async () => {
    const repository = new InMemoryCheckoutRepository();
    const session = checkoutSession({ customer: { phone: "11999998888" } });
    session.cart.currentDiscount = 15;
    repository.saveSession(session);
    repository.setRules("mrc_1", { maxDiscountPercent: 15, couponBoxEnabled: true });
    const payments = new InMemoryPaymentRepository();
    const intent = PaymentIntentEntity.create({
      merchantId: "mrc_1", sessionId: "chk_1", idempotencyKey: "pix-once",
      method: "pix", amountCents: 32000, currency: "BRL",
    });
    // Pending also covers an in-flight or uncertain provider response.
    await payments.saveIntent({ intent: PaymentIntentEntity.rehydrate({ ...intent.snapshot(), status }) });
    const useCase = new TrackCheckoutEventUseCase(
      repository, repository, new ProgressiveDiscountSettingsPort(), repository, undefined, undefined, payments,
    );
    const frozen = paymentCartFingerprint(session);
    const response = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", event: "checkout_abandoned" });
    const persisted = repository.getSession("mrc_1", "chk_1")!;
    const committed = status !== "failed" && status !== "cancelled";
    assert.equal(paymentCartFingerprint(persisted) === frozen, committed);
    assert.equal(response.progressive_offer === undefined, committed);
    assert.equal(repository.listOutbox("mrc_1").some(e => e.event_type === "whatsapp.message.requested"), !committed);
    // Repeated payment-selection/failure telemetry must not invalidate retries either.
    await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", event: "payment_method_selected" });
    if (committed) assert.equal(paymentCartFingerprint(repository.getSession("mrc_1", "chk_1")!), frozen);
  });
}

test("payment quote guard is scoped to merchant and session", async () => {
  const payments = new InMemoryPaymentRepository();
  await payments.saveIntent({ intent: PaymentIntentEntity.create({
    merchantId: "mrc_1", sessionId: "chk_1", idempotencyKey: "pix",
    method: "pix", amountCents: 1000, currency: "BRL",
  }) });
  assert.equal(await payments.hasCommittedPaymentForSession("mrc_1", "chk_1"), true);
  assert.equal(await payments.hasCommittedPaymentForSession("mrc_2", "chk_1"), false);
  assert.equal(await payments.hasCommittedPaymentForSession("mrc_1", "chk_2"), false);
  let query: unknown;
  const prisma = { paymentIntent: { async findFirst(input: unknown) { query = input; return null; } } };
  const repository = new PrismaPaymentRepository(prisma as any);
  assert.equal(await repository.hasCommittedPaymentForSession("mrc_1", "chk_1"), false);
  assert.deepEqual(query, {
    where: { merchantId: "mrc_1", sessionId: "chk_1", status: { notIn: ["failed", "cancelled"] } },
    select: { id: true },
  });
});

class PaymentOnlyCheckoutSettingsPort implements CheckoutSettingsPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "silent_until_trigger" as const,
        open_widget_on_trigger: true,
        minimum_abandonment_score: 0.7,
        cooldown_seconds: 120,
        max_interventions_per_session: 3,
        enabled_triggers: ["payment_failed" as const],
        handoff_enabled: true
      },
      merchant_rules: [],
      operational_constraints: []
    };
  }

  async getInterventionConfig() {
    return { advancedRules: null, interventionPolicy: null };
  }
}

class ProgressiveDiscountSettingsPort implements CheckoutSettingsPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "silent_until_trigger" as const,
        open_widget_on_trigger: true,
        minimum_abandonment_score: 0,
        cooldown_seconds: 120,
        max_interventions_per_session: 3,
        enabled_triggers: ["coupon_field_clicked" as const, "exit_intent_detected" as const, "payment_failed" as const],
        handoff_enabled: true,
        progressive_discount: {
          enabled: true,
          stages: {
            initial_coupon: 5,
            exit_intent: 5,
            abandoned_cart: 10,
            payment_nudge: 15
          }
        }
      },
      merchant_rules: [],
      operational_constraints: []
    };
  }

  async getInterventionConfig() {
    return { advancedRules: null, interventionPolicy: null };
  }
}

test("TrackCheckoutEventUseCase rejects missing or cross-tenant sessions", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({ merchantId: "mrc_1", sessionId: "chk_1" }));
  const useCase = new TrackCheckoutEventUseCase(repository, repository);

  await assert.rejects(
    () => useCase.execute({ merchant_id: "mrc_2", session_id: "chk_1", event: "coupon_field_clicked" }),
    NotFoundException
  );
});

test("TrackCheckoutEventUseCase records event, updates score, and appends facts", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  const useCase = new TrackCheckoutEventUseCase(repository, repository);

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "shipping_objection_detected"
  });

  assert.equal(response.abandonment_score, 0.35);
  assert.equal(response.trigger_agent, false);
  assert.deepEqual(
    repository.listOutbox("mrc_1").map((event) => event.event_type),
    ["checkout.event.tracked", "checkout.abandonment.scored"]
  );
});

test("TrackCheckoutEventUseCase emits fake WhatsApp abandonment discount", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(
    checkoutSession({
      customer: { phone: "11999998888" }
    })
  );
  repository.setRules("mrc_1", { maxDiscountPercent: 12, couponBoxEnabled: true });
  const useCase = new TrackCheckoutEventUseCase(repository, repository, undefined, repository);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "checkout_abandoned"
  });

  const outbox = repository.listOutbox("mrc_1");
  assert.ok(outbox.some((event) => event.event_type === "checkout.abandoned"));
  const whatsapp = outbox.find((event) => event.event_type === "whatsapp.message.requested");
  assert.equal(whatsapp?.payload.template, "checkout_abandonment_discount");
  assert.equal(whatsapp?.payload.discount_percent, 12);
  assert.equal(whatsapp?.payload.phone, "11999998888");
});

test("TrackCheckoutEventUseCase emits progressive abandoned-cart discount when enabled", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(
    checkoutSession({
      customer: { phone: "11999998888" }
    })
  );
  repository.setRules("mrc_1", { maxDiscountPercent: 12, couponBoxEnabled: true });
  const useCase = new TrackCheckoutEventUseCase(
    repository,
    repository,
    new ProgressiveDiscountSettingsPort(),
    repository
  );

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "checkout_abandoned"
  });

  const whatsapp = repository.listOutbox("mrc_1").find((event) => event.event_type === "whatsapp.message.requested");
  assert.equal(response.progressive_offer?.stage, "abandoned_cart");
  assert.equal(response.progressive_offer?.requested_percent, 10);
  assert.equal(response.progressive_offer?.approved_percent, 10);
  assert.equal(whatsapp?.payload.discount_percent, 10);
  assert.equal((await repository.getSession("mrc_1", "chk_1"))?.cart.commercialNudge?.kind, "progressive_discount");
});

test("TrackCheckoutEventUseCase caps progressive discount by merchant max", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  repository.setRules("mrc_1", { maxDiscountPercent: 8, couponBoxEnabled: true });
  const useCase = new TrackCheckoutEventUseCase(
    repository,
    repository,
    new ProgressiveDiscountSettingsPort(),
    repository
  );

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "payment_failed"
  });

  assert.equal(response.progressive_offer?.stage, "payment_nudge");
  assert.equal(response.progressive_offer?.requested_percent, 15);
  assert.equal(response.progressive_offer?.approved_percent, 8);
});

test("TrackCheckoutEventUseCase skips progressive offer when current discount already >= stage target", async () => {
  const repository = new InMemoryCheckoutRepository();
  // Cart total=300, currentDiscount=30 → already 10% applied
  repository.saveSession(checkoutSession({ cart: { currency: "BRL", total: 300, items: [{ sku: "kit", name: "Kit", price: 300, cost: 120, quantity: 1 }], currentDiscount: 30 } }));
  repository.setRules("mrc_1", { maxDiscountPercent: 15, couponBoxEnabled: true });
  const useCase = new TrackCheckoutEventUseCase(
    repository,
    repository,
    new ProgressiveDiscountSettingsPort(),
    repository
  );

  // exit_intent configured at 5% — but buyer already has 10%, so no offer
  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "exit_intent_detected"
  });
  assert.equal(response.progressive_offer, undefined);

  // abandoned_cart configured at 10% — buyer already has 10%, so no offer
  const response2 = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "checkout_abandoned"
  });
  assert.equal(response2.progressive_offer, undefined);

  // payment_nudge configured at 15% — buyer has 10%, this is an upgrade to 15%
  const response3 = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "payment_failed"
  });
  assert.equal(response3.progressive_offer?.stage, "payment_nudge");
  assert.equal(response3.progressive_offer?.approved_percent, 15);
});

test("TrackCheckoutEventUseCase suppresses trigger when checkout-settings disables the event", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({ abandonmentScore: 0.5 }));
  const useCase = new TrackCheckoutEventUseCase(repository, repository, new PaymentOnlyCheckoutSettingsPort());

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "shipping_objection_detected"
  });
  const persisted = await repository.getSession("mrc_1", "chk_1");

  assert.equal(response.abandonment_score, 0.85);
  assert.equal(response.trigger_agent, false);
  assert.equal(persisted?.triggerAgent, false);
});

const TRACK_LEDGER_TRIGGERS: CheckoutTriggerName[] = [
  "shipping_objection_detected",
  "coupon_field_clicked",
  "payment_failed",
  "exit_intent_detected",
  "idle_30_seconds"
];

class LedgerCapCheckoutSettings implements CheckoutSettingsPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "silent_until_trigger" as const,
        open_widget_on_trigger: true,
        minimum_abandonment_score: 0,
        cooldown_seconds: 0,
        max_interventions_per_session: 2,
        enabled_triggers: TRACK_LEDGER_TRIGGERS,
        handoff_enabled: true
      },
      merchant_rules: [],
      operational_constraints: []
    };
  }

  async getInterventionConfig() {
    return { advancedRules: null, interventionPolicy: null };
  }
}

test("TrackCheckoutEventUseCase reserves the intervention ledger cap for proactive triggers", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  const ledger = new InMemoryInterventionLedger();
  const settings = new LedgerCapCheckoutSettings();
  const useCase = new TrackCheckoutEventUseCase(repository, repository, settings, undefined, ledger);

  const payment = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "payment_failed"
  });
  assert.equal(payment.trigger_agent, true);
  assert.equal(ledger.countForSession("mrc_1", "chk_1"), 0);

  const ship = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "shipping_objection_detected"
  });
  assert.equal(ship.trigger_agent, true);
  assert.equal(ledger.countForSession("mrc_1", "chk_1"), 1);

  const coupon = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "coupon_field_clicked"
  });
  assert.equal(coupon.trigger_agent, true);
  assert.equal(ledger.countForSession("mrc_1", "chk_1"), 2);

  const capped = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "exit_intent_detected"
  });
  assert.equal(capped.trigger_agent, false);
  assert.equal(ledger.countForSession("mrc_1", "chk_1"), 2);

  const repeatedPayment = await useCase.execute({
    merchant_id: "mrc_1", session_id: "chk_1", event: "payment_failed",
  });
  assert.equal(repeatedPayment.trigger_agent, true, "reactive payment failures do not consume the proactive session cap");
  assert.equal(ledger.countForSession("mrc_1", "chk_1"), 2);

  const persisted = await repository.getSession("mrc_1", "chk_1");
  assert.equal(persisted?.triggerAgent, true);
});
