import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { StripeWebhookController } from "./stripe-webhook.controller.js";
import {
  HandleStripeWebhookUseCase,
  StripeSignatureError
} from "../../application/handle-stripe-webhook.use-case.js";

function fakeRequest(rawBody: Buffer): any {
  return { rawBody };
}

describe("StripeWebhookController", () => {
  it("maps StripeSignatureError to UnauthorizedException", async () => {
    const ctrl = new StripeWebhookController({
      execute: async () => {
        throw new StripeSignatureError();
      }
    } as unknown as HandleStripeWebhookUseCase);

    await assert.rejects(
      () => ctrl.stripeWebhook(fakeRequest(Buffer.from("")), "bad-sig"),
      (e: unknown) => e instanceof UnauthorizedException
    );
  });

  it("throws UnauthorizedException when rawBody is missing", async () => {
    const ctrl = new StripeWebhookController({
      execute: async () => ({ outcome: "processed" as const, effect: "ok" })
    } as unknown as HandleStripeWebhookUseCase);

    await assert.rejects(
      () => ctrl.stripeWebhook({ rawBody: undefined } as any, "sig"),
      (e: unknown) => e instanceof UnauthorizedException
    );
  });

  it("returns use-case result on success", async () => {
    const ctrl = new StripeWebhookController({
      execute: async () => ({ outcome: "processed" as const, effect: "checkout_completed_after_payment" })
    } as unknown as HandleStripeWebhookUseCase);

    const result = await ctrl.stripeWebhook(fakeRequest(Buffer.from("body")), "valid-sig");
    assert.deepEqual(result, { outcome: "processed", effect: "checkout_completed_after_payment" });
  });

  it("passes raw body and signature header to use-case", async () => {
    let capturedBody: Buffer | undefined;
    let capturedSig: string | undefined;

    const ctrl = new StripeWebhookController({
      execute: async (rawBody: Buffer, signature: string | undefined) => {
        capturedBody = rawBody;
        capturedSig = signature;
        return { outcome: "duplicate" as const };
      }
    } as unknown as HandleStripeWebhookUseCase);

    const body = Buffer.from('{"type":"test"}');
    await ctrl.stripeWebhook(fakeRequest(body), "whsec_sig_123");

    assert.deepEqual(capturedBody, body);
    assert.equal(capturedSig, "whsec_sig_123");
  });
});
