import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { OtpService } from "./otp.service.js";

test("automatic email challenge changes only challenge fields and never invents a buyer name", async () => {
  let stored: any; let delivered: any;
  const session: any = { merchantId: "merchant", sessionId: "checkout", customer: { email: "known@example.com", email_verified: false, phone: "552171191446", phone_verified: true } };
  const service = new CheckoutCustomerService({ commitCommercialMutation: async ({ next }: any) => { stored = next; return stored; } } as any, undefined, new OtpService(), undefined, undefined,
    { send: async input => { delivered = input; return { status: "sent", messageId: "accepted-email" }; } } as any);
  const result = await service.beginEmailVerification(session, "Empresa");
  assert.equal(stored.customer.fullName, undefined);
  assert.equal(result.customer?.email_verified, false);
  assert.equal(delivered.to, session.customer.email); assert.equal(delivered.requireDelivery, true);
  assert.match(result.customer?.otp_code ?? "", /^\d{6}$/);
  assert.equal(session.customer.otp_code, undefined);
  assert.equal(await service.beginEmailVerification(result, "Empresa"), result);
});
test("email delivery failure leaves no committed challenge or account authorization", async () => {
  let saves = 0;
  const service = new CheckoutCustomerService({ saveSession: async () => { saves++; } } as any, undefined, new OtpService(), undefined, undefined,
    { send: async () => ({ status: "failed", messageId: "" }) } as any);
  const session: any = { merchantId: "merchant", sessionId: "checkout", customer: { email: "known@example.com", email_verified: false } };
  await assert.rejects(service.beginEmailVerification(session), /enviar o código/);
  assert.equal(saves, 0); assert.equal(session.customer.otp_code, undefined);
});
