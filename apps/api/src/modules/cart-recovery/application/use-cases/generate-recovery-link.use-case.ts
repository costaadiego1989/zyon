import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { RecoveryLinkTokenService } from "../../domain/recovery-link-token.service.js";

export function recoveryStoreUrl(slug: string): URL {
  const base = process.env.PUBLIC_STOREFRONT_URL || process.env.STOREFRONT_URL || "https://storefront.zyon-payments.com.br";
  const url = new URL(base);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password) {
    throw new Error("recovery_storefront_url_invalid");
  }
  return new URL(`/store/${encodeURIComponent(slug)}`, url.origin);
}

@Injectable()
export class GenerateRecoveryLinkUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly tokens: RecoveryLinkTokenService,
  ) {}
  async execute(input: { merchantId: string; sessionId: string }): Promise<string> {
    if (!input.sessionId) throw new BadRequestException("recovery_session_required");
    const [merchant, session] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { storeSlug: true } }),
      this.sessions.getSession(input.merchantId, input.sessionId),
    ]);
    if (!merchant?.storeSlug || !session || session.merchantId !== input.merchantId || !session.cart?.items?.length) {
      throw new BadRequestException("recovery_purchase_unavailable");
    }
    const url = recoveryStoreUrl(merchant.storeSlug);
    url.searchParams.set("show", "checkout");
    url.searchParams.set("recovery", this.tokens.issue(input.merchantId, input.sessionId));
    return url.href;
  }
}
