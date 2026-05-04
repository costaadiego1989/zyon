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
    } as unknown as HandleAsaasWebhookUseCase);

    await assert.rejects(() => ctrl.asaasWebhook("bad-token", {}), UnauthorizedException);
  });
});
