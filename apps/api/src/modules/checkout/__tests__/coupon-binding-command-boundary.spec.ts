import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryPaymentRepository } from "../../payment/infrastructure/in-memory-payment.repository.js";
import { checkoutSession, authorizedOffer } from "./checkout-test-fixtures.js";
import { ApplyOfferUseCase } from "../application/use-cases/apply-offer.use-case.js";
import { AcceptCheckoutOfferUseCase } from "../application/use-cases/accept-checkout-offer.use-case.js";
import { CheckoutBenefitsService } from "../application/services/checkout-benefits.service.js";
import type { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";

class PrivateBoundSessions extends InMemoryCheckoutRepository {
  guards = 0;
  async assertCouponBindingCommandAllowed(merchantId: string, sessionId: string): Promise<void> {
    assert.equal(merchantId, "mrc_1"); assert.equal(sessionId, "chk_1"); this.guards++;
    throw new Error("checkout_coupon_binding_conflict");
  }
}

test("offer checks canonical storage before commerce/acceptance, even though the public session contains no private field", async () => {
  const sessions = new PrivateBoundSessions();
  sessions.saveSession(checkoutSession()); sessions.saveOffer(authorizedOffer());
  let commerce = 0;
  const useCase = new ApplyOfferUseCase(sessions, sessions, { async apply() { commerce++; return { success: true }; } },
    new AcceptCheckoutOfferUseCase(sessions, sessions, sessions));
  await assert.rejects(useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" }),
    { message: "checkout_coupon_binding_conflict" });
  assert.equal(sessions.guards, 1); assert.equal(commerce, 0);
  assert.equal(sessions.getAcceptedOffer("mrc_1", "chk_1", "off_1"), undefined);
  assert.deepEqual(sessions.getSession("mrc_1", "chk_1")?.cart, checkoutSession().cart);
});

test("benefit preparation checks canonical storage before policy, stage events and coupon calls", async () => {
  const sessions = new PrivateBoundSessions(); sessions.saveSession(checkoutSession());
  let effects = 0;
  const rules = { getRules() { effects++; throw new Error("unexpected policy lookup"); }, updateRules() { throw new Error("unexpected policy write"); } };
  const settings = { async getContext() { effects++; return undefined; }, async getInterventionConfig() {
    effects++; return { advancedRules: [], interventionPolicy: null }; } };
  const coupons = { async executeForCheckout() { effects++; throw new Error("unexpected coupon grant"); } } as unknown as ApplyCouponUseCase;
  const benefits = new CheckoutBenefitsService(sessions, rules, settings, new InMemoryPaymentRepository(), coupons);
  await assert.rejects(benefits.prepare("mrc_1", "chk_1", "pix"), { message: "checkout_coupon_binding_conflict" });
  assert.equal(sessions.guards, 1); assert.equal(effects, 0);
});
