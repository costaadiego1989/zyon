import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { ServiceUnavailableException } from "@nestjs/common";
import { HandleStripeWebhookUseCase, StripeSignatureError } from "./handle-stripe-webhook.use-case.js";

const keys = ["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST", "STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_TEST"];
async function withConfig(config: Record<string, string>, work: () => Promise<void>) {
  const previous = keys.map(key => process.env[key]);
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, config);
  try { await work(); } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}

test("disabled or incomplete Stripe configuration permits startup and rejects webhooks without effects", async () => {
  for (const config of [{}, { STRIPE_SECRET_KEY: "sk_test_audit", STRIPE_SECRET_KEY_TEST: "sk_test_audit" }]) {
    await withConfig(config, async () => {
      const useCase = new HandleStripeWebhookUseCase({} as never, {} as never);
      let dispatched = false;
      useCase.dispatchEvent = async () => { dispatched = true; return { outcome: "ignored", reason: "audit" }; };
      await assert.rejects(useCase.execute(Buffer.from("{}"), "forged"), error =>
        error instanceof ServiceUnavailableException && error.getStatus() === 503);
      assert.equal(dispatched, false);
    });
  }
});

test("configured Stripe verifies the signed raw body before dispatching", async () => {
  await withConfig({
    STRIPE_SECRET_KEY: "sk_test_audit", STRIPE_SECRET_KEY_TEST: "sk_test_audit",
    STRIPE_WEBHOOK_SECRET: "whsec_audit", STRIPE_WEBHOOK_SECRET_TEST: "whsec_audit",
  }, async () => {
    const useCase = new HandleStripeWebhookUseCase({} as never, {} as never);
    const events: string[] = [];
    useCase.dispatchEvent = async event => { events.push(event.id); return { outcome: "ignored", reason: "audit" }; };
    const body = JSON.stringify({ id: "evt_audit", type: "audit.test", data: { object: {} } });
    const signature = new Stripe("sk_test_audit").webhooks.generateTestHeaderString({ payload: body, secret: "whsec_audit" });
    await assert.rejects(useCase.execute(Buffer.from(body), undefined), StripeSignatureError);
    await assert.rejects(useCase.execute(Buffer.from(body.replace("evt_audit", "evt_tampered")), signature), StripeSignatureError);
    assert.deepEqual(events, []);
    await useCase.execute(Buffer.from(body), signature);
    assert.deepEqual(events, ["evt_audit"]);
  });
});
