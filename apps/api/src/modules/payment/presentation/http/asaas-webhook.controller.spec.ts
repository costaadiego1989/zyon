import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { AsaasWebhookController } from "./asaas-webhook.controller.js";
import {
  HandleAsaasWebhookUseCase,
  UnauthorizedWebhookError
} from "../../application/handle-asaas-webhook.use-case.js";

describe("AsaasWebhookController", () => {
  it("maps UnauthorizedWebhookError to UnauthorizedException", async () => {
    const ctrl = new AsaasWebhookController({
      execute: async () => {
        throw new UnauthorizedWebhookError();
      }
    } as unknown as HandleAsaasWebhookUseCase, {
      execute: async () => ({ outcome: "ignored", reason: "not_used" }),
    } as any);

    await assert.rejects(() => ctrl.asaasWebhook("bad-token", {}), UnauthorizedException);
  });

  it("routes Asaas transfer events to the transfer reconciliation handler", async () => {
    const ctrl = new AsaasWebhookController({
      execute: async () => ({ outcome: "ignored", reason: "payment_handler_should_not_run" }),
    } as unknown as HandleAsaasWebhookUseCase, {
      execute: async (token: string | undefined, body: unknown) => ({ outcome: "processed", effect: `${token}:${(body as any).event}` }),
    } as any);

    await assert.doesNotReject(async () => {
      const result = await ctrl.asaasWebhook("valid-token", { event: "TRANSFER_DONE" });
      assert.deepEqual(result, { outcome: "processed", effect: "valid-token:TRANSFER_DONE" });
    });
  });
});
