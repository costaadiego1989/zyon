import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutBenefitsService } from "../application/services/checkout-benefits.service.js";
import { ApplyOfferUseCase } from "../application/use-cases/apply-offer.use-case.js";
import { checkoutSession } from "./checkout-test-fixtures.js";

function fixture(normal = true) {
  const calls: string[] = [], session = checkoutSession({ persistenceVersion: 9 });
  if (normal) Object.assign(session.cart.items[0]!, { crossSellIntent: { version: 1, promotionId: "promotion",
    promotionUpdatedAt: "2026-10-20T00:00:00Z", acceptedQuantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 } });
  const sessions = { async getSession(merchant: string, id: string) { calls.push("read"); assert.equal(merchant, session.merchantId); assert.equal(id, session.sessionId); return session; },
    async assertCouponBindingCommandAllowed() { calls.push("legacy_preflight"); }, async getSessionEvents() { return []; } };
  const rules = { async getRules() { calls.push("legacy_rules"); return undefined; } };
  const settings = { async getContext() { return undefined; }, async getInterventionConfig() { return {}; } };
  const payments = { async hasCommittedPaymentForSession() { return false; } };
  const preparedSession={...session,persistenceVersion:10};
  let couponCode:string|undefined,projectionFault:Error|undefined;
  let fault: Error | undefined;
  const port = { async prepareBenefits(scope: unknown, input: unknown) { calls.push("normal_prepare");
    assert.deepEqual(scope, { merchantId: session.merchantId, sessionId: session.sessionId }); assert.deepEqual(input, { method: "pix", expectedVersion: 9 });
    if (fault) throw fault; return {session:preparedSession,...(couponCode?{couponCode}:{})}; },
    async applyOffer(scope: unknown, input: unknown) { calls.push("normal_offer");
      assert.deepEqual(scope, { merchantId: session.merchantId, sessionId: session.sessionId }); assert.deepEqual(input, { offerId: "offer", expectedVersion: 9 });
      if (fault) throw fault; return {session:preparedSession,offer:{id:"offer",type:"discount_fixed",value:10,expiresAt:"2026-10-21T00:00:00Z"}}; } };
  const couponResult={...preparedSession,persistenceVersion:11};
  const coupons={async executeForCheckout(input:unknown){calls.push("coupon_command");assert.deepEqual(input,{merchant_id:session.merchantId,
    session_id:session.sessionId,code:"AUTO",expectedVersion:10});return{session:couponResult};}};
  const benefits: CheckoutBenefitsService = Reflect.construct(CheckoutBenefitsService, [sessions, rules, settings, payments, coupons, undefined, port]);
  const offers: ApplyOfferUseCase = Reflect.construct(ApplyOfferUseCase, [sessions, { async getOffer() { calls.push("legacy_offer"); return undefined; } },
    { async apply() { assert.fail("no Shopify/commerce fallback"); } }, { async execute() { assert.fail("no detached acceptance"); } },
    {async getProfile(){if(projectionFault)throw projectionFault;return undefined;}}, undefined, port]);
  return { session,preparedSession,couponResult, calls, benefits, offers, fail(error: Error) { fault = error; },
    coupon(){couponCode="AUTO";},projectionFailure(){projectionFault=new Error("private_database_details");} };
}
test("normal progressive preparation uses transaction command before generic policy/write path", async () => {
  const f = fixture(); assert.equal(await f.benefits.prepare(f.session.merchantId, f.session.sessionId, "pix"), f.preparedSession);
  assert.deepEqual(f.calls, ["read", "normal_prepare"]);
});
test("normal offer applies only by server-scoped transaction command without detached legacy writes", async () => {
  const f = fixture(); const result=await f.offers.execute({ merchant_id: f.session.merchantId, session_id: f.session.sessionId, offer_id: "offer" });
  assert.equal(result.success,true);assert.ok(result.experience);assert.equal(result.expires_at,"2026-10-21T00:00:00Z");
  assert.deepEqual(f.calls, ["read", "normal_offer"]);
});
for (const kind of ["prepare", "offer"] as const) test(`normal ${kind} unknown outcome propagates by identity without fallback`, async () => {
  const f = fixture(), error = new Error("unknown_commit"); f.fail(error);
  await assert.rejects(kind === "prepare" ? f.benefits.prepare(f.session.merchantId, f.session.sessionId, "pix")
    : f.offers.execute({ merchant_id: f.session.merchantId, session_id: f.session.sessionId, offer_id: "offer" }), actual => actual === error);
  assert.ok(!f.calls.some(call => call.startsWith("legacy_")));
});
test("legacy session without a canonical normal intent retains existing preparation behavior", async () => {
  const f = fixture(false); assert.equal(await f.benefits.prepare(f.session.merchantId, f.session.sessionId, "pix"), f.session);
  assert.deepEqual(f.calls, ["read", "legacy_preflight", "legacy_rules"]);
});
test("automatic policy coupon uses existing canonical command with fresh committed version, not nested mutation",async()=>{
  const f=fixture();f.coupon();assert.equal(await f.benefits.prepare(f.session.merchantId,f.session.sessionId,"pix"),f.couponResult);
  assert.deepEqual(f.calls,["read","normal_prepare","coupon_command"]);
});
test("offer committed before projection failure returns truthful review without replay or leaking error",async()=>{
  const f=fixture();f.projectionFailure();await assert.rejects(f.offers.execute({merchant_id:f.session.merchantId,session_id:f.session.sessionId,offer_id:"offer"}),error=>{
    const response=(error as {getResponse():{code:string;message:string}}).getResponse();assert.equal(response.code,"checkout_review_required");
    assert.match(response.message,/A oferta foi aplicada/);assert.ok(!JSON.stringify(response).includes("private_database"));return true;});
  assert.deepEqual(f.calls,["read","normal_offer"]);
});
