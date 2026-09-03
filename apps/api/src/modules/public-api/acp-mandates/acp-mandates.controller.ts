import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { PublicRoute } from "../../../shared/tenant/tenant.guard.js";
import { AcpMandateIssuerService } from "./acp-mandate-issuer.service.js";
import { AcpMandateResponseDto } from "./acp-mandate.dtos.js";

/**
 * Public AP2 mandate endpoints.
 *
 * No auth — path params + a query `merchant_id` (for sessions, which are
 * tenant-scoped at the repo level) provide the capability. Issued mandates
 * are SD-JWTs with a single embedded disclosure; the holder reveals the
 * underlying payload by appending that disclosure to the JWS compact form.
 */
@ApiTags("ACP - AP2 Mandates")
@Controller("acp/mandates")
export class AcpMandatesController {
  constructor(private readonly issuer: AcpMandateIssuerService) {}

  /**
   * GET /v1/acp/mandates/payment/:payment_intent_id
   *
   * Returns the issuer-signed payment mandate for the given intent. The
   * audience is `credential-provider` (so a buyer-bound credential provider
   * can authorize the charge), and `mandate.payment.1` is the vct.
   */
  @Get("payment/:payment_intent_id")
  @PublicRoute()
  @ApiOperation({
    summary: "Retrieve the AP2 payment mandate for a payment intent",
    description:
      "Issues an SD-JWT-style payment mandate (`mandate.payment.1`). Public " +
      "endpoint — the `payment_intent_id` path param is the capability. The " +
      "issuer-signed JWT carries only digest references; the disclosure " +
      "carries the actual payee + amount + instrument.",
  })
  @ApiParam({
    name: "payment_intent_id",
    description: "Payment intent id (e.g. `pay_int_<uuid>`).",
  })
  @ApiOkResponse({
    description: "AP2 payment mandate.",
    type: AcpMandateResponseDto,
  })
  @ApiNotFoundResponse({ description: "payment_intent_not_found" })
  async paymentMandate(
    @Param("payment_intent_id") paymentIntentId: string,
  ): Promise<AcpMandateResponseDto> {
    return (await this.issuer.issuePaymentMandate(paymentIntentId)) as AcpMandateResponseDto;
  }

  /**
   * GET /v1/acp/mandates/checkout/:checkout_session_id
   *
   * Returns the issuer-signed checkout mandate for the given session. The
   * audience is `merchant` (the merchant commits to fulfillment terms), and
   * `mandate.checkout.1` is the vct. Session lookup is tenant-scoped, so
   * `merchant_id` is required as a query parameter.
   */
  @Get("checkout/:checkout_session_id")
  @PublicRoute()
  @ApiOperation({
    summary: "Retrieve the AP2 checkout mandate for a checkout session",
    description:
      "Issues an SD-JWT-style checkout mandate (`mandate.checkout.1`). Public " +
      "endpoint. Session lookup is tenant-scoped, so `merchant_id` is required " +
      "as a query param — combined with the path `checkout_session_id`, that's " +
      "the capability for this public endpoint.",
  })
  @ApiParam({
    name: "checkout_session_id",
    description: "Checkout session id.",
  })
  @ApiQuery({
    name: "merchant_id",
    required: true,
    description: "Merchant/tenant identifier — session lookup is tenant-scoped.",
  })
  @ApiOkResponse({
    description: "AP2 checkout mandate.",
    type: AcpMandateResponseDto,
  })
  @ApiNotFoundResponse({ description: "checkout_session_not_found" })
  async checkoutMandate(
    @Param("checkout_session_id") sessionId: string,
    @Query("merchant_id") merchantId: string,
  ): Promise<AcpMandateResponseDto> {
    return (await this.issuer.issueCheckoutMandate(merchantId, sessionId)) as AcpMandateResponseDto;
  }
}
