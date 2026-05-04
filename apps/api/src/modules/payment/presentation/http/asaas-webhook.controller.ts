import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import {
  HandleAsaasWebhookUseCase,
  UnauthorizedWebhookError
} from "../../application/handle-asaas-webhook.use-case.js";

@Controller()
export class AsaasWebhookController {
  constructor(private readonly handleWebhook: HandleAsaasWebhookUseCase) {}

  @Post("webhooks/asaas")
  async asaasWebhook(
    @Headers("asaas-access-token") asaasAccessToken: string | undefined,
    @Body() body: unknown
  ) {
    try {
      return await this.handleWebhook.execute(asaasAccessToken, body);
    } catch (e) {
      if (e instanceof UnauthorizedWebhookError) {
        throw new UnauthorizedException(e.message);
      }
      throw e;
    }
  }
}
