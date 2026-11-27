import { Body, Controller, Headers, HttpCode, HttpException, Inject, Param, Post, Req, ServiceUnavailableException, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { FISCAL_DELIVERY_DISPATCH, FiscalDeliveryCallbackError, type FiscalDeliveryDispatchPort } from "../../../shared/integrations/fiscal-delivery-dispatch.port.js";
@Controller("webhooks/fiscal-delivery")
export class FiscalDeliveryCallbacksController {
  constructor(@Inject(FISCAL_DELIVERY_DISPATCH) private readonly dispatch: FiscalDeliveryDispatchPort) {}
  private async receive(work: () => Promise<void>) { try { await work(); return { received: true }; } catch (error) { if (error instanceof FiscalDeliveryCallbackError) throw new HttpException(error.message, error.status); throw new ServiceUnavailableException("fiscal_delivery_callback_pending"); } }
  @Post("resend/:hookRef") @HttpCode(200)
  resend(@Param("hookRef") ref: string, @Req() request: RawBodyRequest<Request>) { return this.receive(() => this.dispatch.resend(ref, request.rawBody, request.headers)); }
  @Post("twilio/:configId") @HttpCode(200)
  twilio(@Param("configId") id: string, @Headers("x-twilio-signature") signature: string | undefined, @Body() body: unknown, @Req() request: Request) { return this.receive(() => this.dispatch.twilio(id, signature, body, request.originalUrl)); }
}
