import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { EmbedTokenService, type EmbedScope } from "../domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../domain/embed-checkout-session.js";
import { ResolveEmbedBuyerService } from "./resolve-embed-buyer.service.js";
import { GetCurrentMarketplacePaymentService } from "../../payment/application/get-current-marketplace-payment.service.js";
import { MarketplacePaymentResumeService } from "../../payment/application/marketplace-payment-resume.service.js";

/** Reissues the original signed binding after cart ownership was independently
 * verified by the issuer. Only explicit action restoration receives a frozen resume pin. */
@Injectable()
export class RenewStorefrontEmbedSessionService {
  private readonly logger = new Logger(RenewStorefrontEmbedSessionService.name);
  constructor(
    @Inject(EmbedTokenService) private readonly tokens: EmbedTokenService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(ResolveEmbedBuyerService) private readonly buyers: ResolveEmbedBuyerService,
    @Inject(GetCurrentMarketplacePaymentService) private readonly current: GetCurrentMarketplacePaymentService,
    @Inject(MarketplacePaymentResumeService) private readonly resume: MarketplacePaymentResumeService,
  ) {}

  async execute(input: { previousToken: unknown; merchantId: string; storefrontCartRef: string;
    origin: string; environment?: "test" | "live"; installationId?: string; scopes?: string[]; buyerToken?: unknown; resumePaymentAction?: boolean; aiUserId?: string }) {
    try {
      const claims = this.tokens.verifyForStorefrontContinuation(input.previousToken);
      if (claims.merchantId !== input.merchantId || claims.storefrontCartRef !== input.storefrontCartRef ||
        claims.allowedOrigin !== input.origin || claims.environment !== input.environment ||
        claims.installationId !== input.installationId) throw Error("binding");
      const sessionId = embedCheckoutSessionId(claims);
      const session = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: {
        merchantId: input.merchantId, sessionId,
      } } });
      const buyer = await this.buyers.resolve(input.merchantId, input.buyerToken);
      const customer = session?.customer as { email?: unknown; email_verified?: unknown } | null;
      if (session && (session.merchantId !== input.merchantId || session.sessionId !== sessionId ||
        buyer && (session.globalUserId !== buyer.globalUserId || customer?.email !== buyer.customer.email) ||
        customer?.email_verified === true && !buyer)) throw Error("buyer");
      const observation = await this.current.execute({ merchantId: input.merchantId, sessionId });
      const requested = input.scopes ?? [];
      const scopes = claims.scopes!.filter(scope => requested.includes(scope));
      const explicitResume = input.resumePaymentAction === true;
      if (input.resumePaymentAction !== undefined && typeof input.resumePaymentAction !== "boolean" ||
        explicitResume && !observation.payment) throw Error("resume");
      const resumedScopes: EmbedScope[] = explicitResume ? ["payment:intents:read", "payment:intents:resume"] :
        observation.payment ? ["payment:intents:read"] : scopes.filter(scope => scope !== "payment:intents:resume");
      if (!scopes.includes("payment:intents:read") || !resumedScopes.length) throw Error("scope");
      const paymentResume = explicitResume ? await this.resume.authorize({ merchantId: input.merchantId, sessionId, cartRef: input.storefrontCartRef }) : undefined;
      if (paymentResume && paymentResume.intentId !== observation.payment!.intent_id) throw Error("resume");
      const now = Math.floor(Date.now() / 1000);
      const expiresAtUnix = Math.min(now + (explicitResume ? 300 : 900), claims.issuedAtUnix + 86400);
      if (expiresAtUnix <= now) throw Error("expired");
      const { paymentResume: _previousAction, ...original } = claims;
      const token = this.tokens.sign({ ...original, aiUserId: original.aiUserId ?? input.aiUserId, scopes: resumedScopes, expiresAtUnix, ...(paymentResume ? { paymentResume } : {}) });
      this.logger.log({ event: "embed.session.continued", mode: explicitResume ? "resume" : observation.payment ? "observation" : "checkout" });
      return { embed_session_token: token, expires_at_unix: expiresAtUnix,
        installation_id: claims.installationId ?? null, environment: claims.environment ?? null,
        widget_version: claims.widgetVersion ?? null };
    } catch {
      this.logger.log({ event: "embed.session.continuation_refused" });
      throw new UnauthorizedException("embed_checkout_continuation_unavailable");
    }
  }
}
