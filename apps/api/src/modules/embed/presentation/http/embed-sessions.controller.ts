import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";
import { currentEmbedIssuer, EmbedSessionIssuerGuard } from "./embed-session-issuer.guard.js";

type IssueBody = {
  ttl_seconds?: number;
  merchant_id?: string;
  allowed_origin?: string;
  allowedOrigin?: string;
  scopes?: string[];
  cart_ref?: string;
  cartRef?: string;
};

@UseGuards(EmbedSessionIssuerGuard)
@Controller("embed-sessions")
export class EmbedSessionsController {
  constructor(private readonly issue: IssueEmbedSessionUseCase) {}

  @Post()
  issueSession(@Req() request: unknown, @Body() body: IssueBody) {
    const issuer = currentEmbedIssuer(request as never);
    const ttl = typeof body?.ttl_seconds === "number" && Number.isFinite(body.ttl_seconds) ? body.ttl_seconds : 900;
    return this.issue.execute({
      merchantId: issuer.merchantId,
      ttlSeconds: ttl,
      allowedOrigin: body.allowed_origin ?? body.allowedOrigin,
      scopes: body.scopes,
      cartRef: body.cart_ref ?? body.cartRef
    });
  }
}
