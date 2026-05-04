import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { authorizedOffer, checkoutSession } from "../../__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "./in-memory-checkout.repository.js";

test("InMemoryCheckoutRepository stores sessions and identity by tenant", () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({ merchantId: "mrc_1", sessionId: "chk_same" }));
  repository.saveSession(checkoutSession({ merchantId: "mrc_2", sessionId: "chk_same" }));

  assert.equal(repository.getSession("mrc_1", "chk_same")?.merchantId, "mrc_1");
  assert.equal(repository.getSession("mrc_2", "chk_same")?.merchantId, "mrc_2");

  const first = repository.resolveGlobalUserId("mrc_1", { email: "buyer@example.com" });
  const second = repository.resolveGlobalUserId("mrc_1", { email: " Buyer@Example.com " });
  const otherMerchant = repository.resolveGlobalUserId("mrc_2", { email: "buyer@example.com" });

  assert.equal(first, second);
  assert.notEqual(first, otherMerchant);
});

test("InMemoryCheckoutRepository records events, offers, accepted offers, completed orders, and outbox", () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  repository.recordEvent("mrc_1", "chk_1", "coupon_field_clicked");
  assert.equal(repository.getSession("mrc_1", "chk_1")?.abandonmentScore, 0.22);

  repository.saveOffer(authorizedOffer());
  assert.equal(repository.getOffer("mrc_1", "off_1")?.id, "off_1");
  assert.equal(repository.getOffer("mrc_2", "off_1"), undefined);

  repository.saveAcceptedOffer({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    offerId: "off_1",
    type: "discount_percent",
    value: 10,
    marginAfterOffer: 0.5,
    acceptedAt: "2026-05-01T12:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z"
  });
  assert.equal(repository.getAcceptedOffer("mrc_1", "chk_1", "off_1")?.offerId, "off_1");

  const order = {
    merchantId: "mrc_1",
    sessionId: "chk_1",
    externalOrderId: "ord_1",
    orderTotal: 300,
    currency: "BRL" as const,
    completedAt: "2026-05-01T12:00:00.000Z"
  };
  assert.equal(repository.saveCompletedOrder(order).idempotent, false);
  assert.equal(repository.saveCompletedOrder(order).idempotent, true);

  repository.appendOutbox(
    createCheckoutEventEnvelope({
      eventType: "checkout.session.started",
      merchantId: "mrc_1",
      payload: { session_id: "chk_1" }
    })
  );
  assert.equal(repository.listOutbox("mrc_1").length, 1);
  assert.equal(repository.listOutbox("mrc_2").length, 0);
});
