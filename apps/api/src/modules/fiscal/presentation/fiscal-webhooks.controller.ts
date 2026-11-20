import { Controller, HttpCode, HttpException, Inject, Param, Post, Req, ServiceUnavailableException, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { FISCAL_WEBHOOK_DISPATCH, FiscalWebhookDispatchError, type FiscalWebhookDispatchPort } from "../../../shared/integrations/fiscal-webhook-dispatch.port.js";
@Controller("webhooks/fiscal")
export class FiscalWebhooksController {
  constructor(@Inject(FISCAL_WEBHOOK_DISPATCH) private readonly dispatcher: FiscalWebhookDispatchPort) {}
  @Post(":provider/:connectionRef")
  @HttpCode(200)
  async receive(@Param("provider") provider: string, @Param("connectionRef") connectionRef: string, @Req() request: RawBodyRequest<Request>) {
    try { return await this.dispatcher.receive(provider, connectionRef, request.body, request.rawBody, request.headers); }
    catch (error) { if (error instanceof FiscalWebhookDispatchError) throw new HttpException(error.message, error.status); throw new ServiceUnavailableException("fiscal_webhook_unavailable"); }
  }
}
