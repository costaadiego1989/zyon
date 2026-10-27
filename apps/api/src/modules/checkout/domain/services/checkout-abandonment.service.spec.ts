import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutAbandonmentService } from "./checkout-abandonment.service.js";

test("CheckoutAbandonmentService scores events deterministically and triggers at threshold", () => {
  const scored = CheckoutAbandonmentService.applyEvent(0.35, "coupon_field_clicked");

  assert.equal(scored.previousScore, 0.35);
  assert.equal(scored.nextScore, 0.57);
  assert.equal(scored.triggerAgent, true);
  assert.equal(scored.changed, true);
});

test("CheckoutAbandonmentService clamps scores", () => {
  assert.equal(CheckoutAbandonmentService.applyEvent(0.9, "checkout_abandoned").nextScore, 1);
  assert.equal(CheckoutAbandonmentService.applyEvent(0.1, "order_completed").nextScore, 0);
});
