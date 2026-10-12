import { BadRequestException, ForbiddenException, GoneException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { RecoveryLinkTokenService } from "../../domain/recovery-link-token.service.js";
import { ResolveEmbedBuyerService } from "../../../embed/application/resolve-embed-buyer.service.js";
import { IssueEmbedSessionUseCase } from "../../../embed/application/issue-embed-session.use-case.js";
import { recoveryStoreUrl } from "./generate-recovery-link.use-case.js";

@Injectable()
export class ResumeRecoveryCheckoutUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly tokens: RecoveryLinkTokenService,
    private readonly buyers: ResolveEmbedBuyerService,
    private readonly issueEmbed: IssueEmbedSessionUseCase,
  ) {}
  async execute(input: { slug: string; token: unknown; buyerToken?: unknown; origin?: string }) {
    const claims = this.tokens.verify(input.token);
    const merchant = await this.prisma.merchant.findUnique({ where: { id: claims.merchantId }, select: { storeSlug: true } });
    if (!merchant?.storeSlug || merchant.storeSlug !== input.slug) throw new ForbiddenException("recovery_store_mismatch");
    if (input.origin !== recoveryStoreUrl(merchant.storeSlug).origin) throw new ForbiddenException("recovery_origin_not_allowed");
    const session = await this.sessions.getSession(claims.merchantId, claims.sessionId);
    if (!session || !session.cart?.items?.length) throw new GoneException("recovery_purchase_unavailable");
    const [order, payment] = await Promise.all([
      this.prisma.completedOrder.findFirst({ where: { merchantId: claims.merchantId, sessionId: claims.sessionId }, select: { id: true } }),
      this.prisma.paymentIntent.findFirst({ where: { merchantId: claims.merchantId, sessionId: claims.sessionId, status: "approved" }, select: { id: true } }),
    ]);
    if (order || payment) throw new GoneException("recovery_purchase_completed");
    let buyer;
    try { buyer = await this.buyers.resolve(claims.merchantId, input.buyerToken); }
    catch { throw new UnauthorizedException("recovery_buyer_login_required"); }
    if (!buyer) throw new UnauthorizedException("recovery_buyer_login_required");
    if (buyer.globalUserId !== session.globalUserId || (session.customer?.email && buyer.customer.email !== session.customer.email.trim().toLowerCase())) {
      throw new ForbiddenException("recovery_buyer_mismatch");
    }
    const remaining = claims.expiresAt - Math.floor(Date.now() / 1000);
    if (remaining < 60) throw new BadRequestException("recovery_link_invalid_or_expired");
    const issued = this.issueEmbed.execute({
      merchantId: claims.merchantId, ttlSeconds: Math.min(900, remaining),
      allowedOrigin: input.origin,
      recoveredCheckoutSessionId: session.sessionId,
      scopes: ["checkout:start", "checkout:track", "checkout:chat", "payment:intents:create", "payment:intents:confirm", "payment:intents:read", "offers:apply", "coupons:apply"],
    });
    return { ...issued, merchant_id: claims.merchantId };
  }
}
