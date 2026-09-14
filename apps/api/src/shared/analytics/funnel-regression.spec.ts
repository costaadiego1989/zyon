import test from "node:test";
import assert from "node:assert/strict";
import { resolveFunnelRange } from "./funnel-range.js";
import { checkoutSession, completeOrderRequest } from "../../modules/checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../modules/checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { TrackCheckoutEventUseCase } from "../../modules/checkout/application/use-cases/track-checkout-event.use-case.js";
import { CompleteOrderUseCase } from "../../modules/checkout/application/use-cases/complete-order.use-case.js";
import { TrackStorefrontEventUseCase } from "../../modules/storefront/application/use-cases/track-storefront-event.use-case.js";

test("client completion cannot create conversion, change abandonment, or publish an event", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.saveSession(checkoutSession({ abandonmentScore: 0.8 }));
  const before = structuredClone(repo.getSession("mrc_1", "chk_1"));
  await assert.rejects(new TrackCheckoutEventUseCase(repo, repo).execute({
    merchant_id: "mrc_1", session_id: "chk_1", event: "order_completed",
  }), /checkout_event_server_only/);
  assert.deepEqual(repo.getSession("mrc_1", "chk_1"), before);
  assert.deepEqual(repo.getSessionEvents("mrc_1", "chk_1"), []);
  assert.deepEqual(repo.listOutbox("mrc_1"), []);
});

test("storefront clients cannot mark experiment purchases as converted", async () => {
  const events: unknown[] = [];
  const tracker = new TrackStorefrontEventUseCase({
    recordEvent: async event => { events.push(event); }, listLiveSessions: async () => [],
  });
  for (const event of ["purchase_completed", "order_completed"]) {
    await assert.rejects(tracker.execute({ merchantId: "m", conversationId: "c", event }), /storefront_event_server_only/);
  }
  assert.deepEqual(events, []);
});

test("approved-payment completion still emits once and rejects mismatched payment authority", async () => {
  const repo = new InMemoryCheckoutRepository();
  const session = checkoutSession();
  repo.saveSession(session);
  const input = completeOrderRequest({ order_total: 335 });
  const amountCents = Math.round(input.order_total * 100);
  let approval: any = {
    merchantId: input.merchant_id, sessionId: input.session_id, status: "approved",
    providerPaymentId: input.external_order_id, currency: input.currency,
    approvedAmountCents: amountCents, amountCents,
  };
  const useCase = new CompleteOrderUseCase(repo, repo, repo,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    { find: async () => approval } as any);
  await assert.rejects(useCase.executePaymentApproval(input), /payment_approval_required/);
  const original = { ...approval };
  for (const mutation of [{ status: "pending" }, { merchantId: "other" }, { sessionId: "chk_other" },
    { approvedAmountCents: amountCents - 1 }, { currency: "USD" }, { providerPaymentId: "other" }]) {
    approval = { ...original, ...mutation };
    await assert.rejects(useCase.executePaymentApproval(input, "pi_test"), /payment_approval_mismatch/);
  }
  assert.deepEqual(repo.getSessionEvents(input.merchant_id, input.session_id), []);
  approval = original;
  const first = await useCase.executePaymentApproval(input, "pi_test");
  const retry = await useCase.executePaymentApproval(input, "pi_test");
  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  assert.equal(repo.getSessionEvents(input.merchant_id, input.session_id).filter(e => e === "order_completed").length, 1);
  assert.equal(repo.listOutbox(input.merchant_id).filter(e => e.event_type === "order.completed").length, 1);
});

test("date-only range includes the selected UTC day without timezone drift", () => {
  const range = resolveFunnelRange("7d", { from: "2026-09-14", to: "2026-09-14" });
  assert.equal(range.from.toISOString(), "2026-09-14T00:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-09-14T23:59:59.999Z");
  assert.equal(resolveFunnelRange("today", undefined, new Date("2026-09-14T01:00:00Z")).from.toISOString(), "2026-09-14T00:00:00.000Z");
});

test("explicit timestamps preserve their instant and invalid dates never silently fall back", () => {
  const range = resolveFunnelRange("7d", { from: "2026-09-14T10:00:00-03:00", to: "2026-09-14T11:00:00-03:00" });
  assert.equal(range.from.toISOString(), "2026-09-14T13:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-09-14T14:00:00.000Z");
  for (const range of [{ from: "2026-09-14" }, { to: "2026-09-14" },
    { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-02-30T00:00:00Z", to: "2026-03-01T00:00:00Z" }, { from: "garbage", to: "2026-09-14" },
    { from: "2026-09-15", to: "2026-09-14" }]) {
    assert.throws(() => resolveFunnelRange("7d", range), /funnel_range_/);
  }
});
