import { Controller, Headers, HttpCode, Post, RawBodyRequest, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import {
  HandleStripeWebhookUseCase,
  StripeSignatureError
} from "../../application/handle-stripe-webhook.use-case.js";

@Controller()
export class StripeWebhookController {
  constructor(private readonly handleWebhook: HandleStripeWebhookUseCase) {}

  @Post("webhooks/stripe")
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string | undefined
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException("stripe_raw_body_missing");
    }
    try {
      return await this.handleWebhook.execute(rawBody, signature);
    } catch (e) {
      if (e instanceof StripeSignatureError) {
        throw new UnauthorizedException(e.message);
      }
      throw e;
    }
  }
}
