import { BadRequestException, Body, Controller, Headers, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { FiscalRecipientUpdateService } from "../application/fiscal-recipient-update.service.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { EmbedAuthGuard } from "../../embed/presentation/http/embed-auth.guard.js";
import { RequireEmbedScope } from "../../embed/presentation/http/embed-scope.decorator.js";
import { embedCheckoutSessionId } from "../../embed/domain/embed-checkout-session.js";
import type { EmbedTokenClaims } from "../../embed/domain/embed-token.service.js";

function bodyInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["merchant_id", "session_id", "recipient"].includes(key))) throw new BadRequestException("fiscal_recipient_body_invalid");
  const body = value as { merchant_id?: unknown; session_id?: unknown; recipient?: unknown };
  if (typeof body.session_id !== "string" || !body.session_id.trim()) throw new BadRequestException("session_id_required");
  return { ...body, session_id: body.session_id };
}

@Controller()
export class FiscalCheckoutController {
  constructor(private readonly recipients: FiscalRecipientUpdateService, private readonly buyers: BuyerJwtService) {}

  @Post("embed/customer/fiscal/prepare")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  prepare(@Req() request: { embedClaims: EmbedTokenClaims }, @Body() value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["session_id", "mode"].includes(key))) throw new BadRequestException("fiscal_recipient_body_invalid");
    const input = value as { session_id?: unknown; mode?: unknown }; const claims = request.embedClaims;
    if (!claims.allowedOrigin || input.session_id !== embedCheckoutSessionId(claims)) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    if (input.mode !== undefined && input.mode !== "buyer" && input.mode !== "other") throw new BadRequestException("fiscal_recipient_mode_invalid");
    return this.recipients.prepare({ merchantId: claims.merchantId, sessionId: input.session_id, mode: input.mode });
  }

  @Post("embed/customer/fiscal/address")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  address(@Req() request: { embedClaims: EmbedTokenClaims }, @Body() value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["session_id", "postal_code"].includes(key))) throw new BadRequestException("fiscal_address_body_invalid");
    const input = value as { session_id?: unknown; postal_code?: unknown }; const claims = request.embedClaims;
    if (!claims.allowedOrigin || input.session_id !== embedCheckoutSessionId(claims)) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    return this.recipients.lookupAddress({ merchantId: claims.merchantId, sessionId: input.session_id, postalCode: input.postal_code });
  }

  @Post("embed/customer/fiscal")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  embed(@Req() request: { embedClaims: EmbedTokenClaims }, @Body() value: unknown) {
    const body = bodyInput(value); const claims = request.embedClaims;
    if (!claims.allowedOrigin || body.session_id !== embedCheckoutSessionId(claims)
      || body.merchant_id !== undefined && body.merchant_id !== claims.merchantId) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    return this.recipients.update({ merchantId: claims.merchantId, sessionId: body.session_id, recipient: body.recipient });
  }

  @Post("checkout/customer/fiscal")
  buyer(@Headers("authorization") authorization: string | undefined, @Body() value: unknown) {
    const body = bodyInput(value);
    if (typeof body.merchant_id !== "string" || !body.merchant_id.trim()) throw new BadRequestException("merchant_id_required");
    let principal;
    try { if (!authorization?.startsWith("Bearer ")) throw new Error(); principal = this.buyers.verify(authorization.slice(7)); }
    catch { throw new UnauthorizedException("invalid_buyer_token"); }
    if (principal.merchantId && principal.merchantId !== body.merchant_id) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    return this.recipients.update({ merchantId: body.merchant_id, sessionId: body.session_id, recipient: body.recipient, buyerId: principal.globalUserId });
  }
}
