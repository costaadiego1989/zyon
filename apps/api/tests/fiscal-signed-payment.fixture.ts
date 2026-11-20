/** Real signed embed route/guard, with only local explicit fixture collaborators. */
import assert from "node:assert/strict";
import { Controller, Inject, UseGuards } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "../src/modules/embed/presentation/http/embed-checkout.controller.js";
import { EmbedAuthGuard } from "../src/modules/embed/presentation/http/embed-auth.guard.js";
import type { CreatePaymentIntentUseCase } from "../src/modules/payment/application/create-payment-intent.use-case.js";
import { checkoutShippingLabel } from "../src/modules/checkout/domain/services/checkout-shipping-label.js";

export const FISCAL_SIGNED_PAYMENT_FIXTURE = Symbol("FiscalSignedPaymentFixture");
export interface FiscalSignedPaymentState {
  sessions?: { getSession(merchantId: string, sessionId: string): CheckoutSession | undefined | Promise<CheckoutSession | undefined> };
  payment?: Pick<CreatePaymentIntentUseCase, "execute">;
}

@Controller("embed")
@UseGuards(EmbedAuthGuard)
export class FiscalSignedPaymentFixtureController extends EmbedCheckoutController {
  constructor(@Inject(FISCAL_SIGNED_PAYMENT_FIXTURE) state: FiscalSignedPaymentState) {
    const sessions = { getSession: (merchantId: string, sessionId: string) => {
      if (!state.sessions) throw new Error("synthetic_signed_session_not_prepared");
      return state.sessions.getSession(merchantId, sessionId);
    } };
    const payment = { execute: (...args: Parameters<CreatePaymentIntentUseCase["execute"]>) => {
      if (!state.payment) throw new Error("synthetic_signed_payment_not_prepared");
      return state.payment.execute(...args);
    } };
    super(undefined as never, undefined as never, undefined as never, new EmbedCheckoutGuardHelper(sessions as never),
      undefined as never, payment as CreatePaymentIntentUseCase, undefined as never, undefined as never,
      undefined as never, undefined as never, undefined as never);
  }
}

// This fixture has its own one-argument constructor and manually constructs the
// base collaborators above. Nest otherwise inherits the base constructor's
// @Inject indexes13-16/21, which are not parameters of this fixture constructor.
// Route, method-scope and guard metadata remain inherited and unmodified.
Reflect.defineMetadata("self:paramtypes", [{ index: 0, param: FISCAL_SIGNED_PAYMENT_FIXTURE }], FiscalSignedPaymentFixtureController);

/** A canonical edit can invalidate delivery. Select the actual returned label. */
export async function selectCurrentFiscalFixtureShipping<T>(input: {
  session: () => Promise<CheckoutSession | undefined>;
  say: (message: string) => Promise<T>;
}): Promise<T | undefined> {
  let current = (await input.session())!;
  if (current.shipping?.method?.trim() && Number.isFinite(current.shipping.customerPrice)) return undefined;
  if (current.customer?.address?.street && !current.customer.address_verified) {
    await input.say("Sim"); current = (await input.session())!;
  }
  if (!current.shippingOptions?.length) { await input.say("Quero continuar"); current = (await input.session())!; }
  assert.ok(current.shippingOptions?.length, "actual canonical shipping options must exist before selection");
  const selected = current.shippingOptions![0];
  const result = await input.say(checkoutShippingLabel(selected));
  const stored = (await input.session())!;
  assert.equal(stored.shipping?.quoteId, selected.quoteId);
  assert.equal(stored.shipping?.quoteKey, selected.quoteKey);
  assert.equal(stored.shipping?.customerPrice, selected.customerPrice);
  assert.equal(stored.shipping?.method, selected.method);
  return result;
}

export function postFiscalSignedPayment(url: string, token: string, input: { session_id: string; idempotency_key: string; method: "pix" }, origin = "http://localhost:15174") {
  return fetch(url + "/v1/embed/payment/intents", { method: "POST", headers: {
    "content-type": "application/json", authorization: "Bearer " + token, origin,
  }, body: JSON.stringify(input) });
}
