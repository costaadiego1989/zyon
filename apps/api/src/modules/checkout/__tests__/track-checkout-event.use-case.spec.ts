import test from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import type { CheckoutSettingsPort } from "../domain/ports/checkout-settings.port.js";
import type { CheckoutTriggerName } from "@aacp/shared-types";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryInterventionLedger } from "../infrastructure/in-memory-intervention-ledger.js";
import { TrackCheckoutEventUseCase } from "../application/use-cases/track-checkout-event.use-case.js";

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
      operational_constraints: []
    };
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
      operational_constraints: []
    };
  }
}

test("TrackCheckoutEventUseCase applies intervention ledger cap after repeated operational triggers", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  const ledger = new InMemoryInterventionLedger();
  const settings = new LedgerCapCheckoutSettings();
  const useCase = new TrackCheckoutEventUseCase(repository, repository, settings, undefined, ledger);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    event: "payment_failed"
  });
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

  const persisted = await repository.getSession("mrc_1", "chk_1");
  assert.equal(persisted?.triggerAgent, false);
});
