import test from "node:test";
import assert from "node:assert/strict";
import { BuyerAccountController } from "./buyer-account.controller.js";
import { VerifyCaptchaUseCase } from "../../../auth/application/verify-captcha.use-case.js";

test("all buyer authentication and OTP routes reject missing, invalid and reused CAPTCHA before account work", async () => {
  const used = new Set<string>();
  const actions: string[] = [];
  const executed: string[] = [];
  const cases = [
    ["register", "buyer_signup", "registerBuyerWithRateLimit"],
    ["login", "buyer_login", "loginBuyer"],
    ["loginFromCheckoutSession", "buyer_session_login", "loginFromSession"],
    ["sendCode", "buyer_phone_send", "sendPhoneCode"],
    ["verifyCode", "buyer_phone_verify", "verifyPhoneCode"],
    ["handleSendEmailCode", "buyer_email_send", "sendEmailCode"],
    ["handleVerifyEmailCode", "buyer_email_verify", "verifyEmailCode"],
    ["handleVerifyEmailLogin", "buyer_email_login", "verifyEmailLogin"],
  ];
  const controller = Object.assign(Object.create(BuyerAccountController.prototype), {
    verifyCaptcha: new VerifyCaptchaUseCase({ verify: async input => {
      assert.equal(input.remoteIp, "127.0.0.1");
      actions.push(input.action!);
      const success = input.token === `${input.action}-proof` && !used.has(input.token);
      if (success) used.add(input.token);
      return { success, reason: success ? undefined : "invalid-token" };
    } }),
    emailVerificationReceipts: { assertValid: () => undefined },
    ...Object.fromEntries(cases.map(([, , dependency]) => [dependency, { execute: async () => {
      executed.push(dependency!);
      return { globalUserId: "buyer_a", email: "buyer@example.test", accessToken: "buyer-token" };
    } }])),
  });
  const body = { email: "buyer@example.test", displayName: "Cliente Teste", phone: "11999999999", cpf: "52998224725", code: "123456",
    address: { zip: "01001000", number: "1", street: "Rua Teste", city: "Sao Paulo", state: "SP" } };
  for (const [method, action, dependency] of cases) {
    const before = executed.length;
    for (const token of [undefined, "invalid", `${action}-proof`, `${action}-proof`]) {
      const request = () => controller[method!]({ ...body, turnstile_token: token }, "127.0.0.1");
      if (token === `${action}-proof` && !used.has(token)) await request();
      else await assert.rejects(request, (error: any) => error.getStatus() === 400 && error.getResponse().code === "captcha_invalid");
    }
    assert.deepEqual(executed.slice(before), [dependency]);
    assert.deepEqual(actions.slice(-4), Array(4).fill(action));
  }
});
