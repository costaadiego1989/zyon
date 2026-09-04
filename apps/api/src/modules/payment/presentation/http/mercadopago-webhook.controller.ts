import { Body, Controller, Headers, HttpCode, Post, RawBodyRequest, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import {
  HandleMercadoPagoWebhookUseCase,
  UnauthorizedWebhookError
} from "../../application/handle-mercadopago-webhook.use-case.js";

@Controller()
export class MercadoPagoWebhookController {
  constructor(private readonly handleWebhook: HandleMercadoPagoWebhookUseCase) {}

  @Post("webhooks/mercadopago")
  @HttpCode(200)
  async mercadoPagoWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") xRequestId: string | undefined
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException("mercadopago_raw_body_missing");
    }

    try {
      const bodyString = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
      return await this.handleWebhook.execute(bodyString, signature, xRequestId);
    } catch (e) {
      if (e instanceof UnauthorizedWebhookError) {
        throw new UnauthorizedException(e.message);
      }
      throw e;
    }
  }
}
