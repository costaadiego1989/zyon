import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { ProductVariantLookupAdapter } from "../../checkout/infrastructure/adapters/product-variant-lookup.adapter.js";
import { UpdateCartUseCase } from "../../checkout/application/use-cases/update-cart.use-case.js";
import { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";
import { applyAcpSessionPatch, type UpdateSessionBody } from "./acp-checkout-patch.js";

@Injectable()
export class AcpCheckoutUpdateService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly applyCoupon: ApplyCouponUseCase,
  ) {}

  async execute(merchantId: string, sessionId: string, body: UpdateSessionBody) {
    const frozen = structuredClone(body);
    const expected = await new PrismaCheckoutRepository(this.prisma).getSession(merchantId, sessionId);
    if (!expected) throw new NotFoundException("checkout_session_not_found");
    return this.prisma.$transaction(async tx => {
      // Shared order with coupon authorization and strategy publication. Every
      // read/write below uses this transaction, including catalogue and events.
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id = ${merchantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId}
        AND session_id = ${sessionId} FOR UPDATE`;
      const sessions = new PrismaCheckoutRepository(tx, true);
      const current = await sessions.getSession(merchantId, sessionId);
      if (!current) throw new NotFoundException("checkout_session_not_found");
      if (!Number.isSafeInteger(expected.persistenceVersion) || current.persistenceVersion !== expected.persistenceVersion) {
        throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
      }
      if (await tx.completedOrder.findFirst({ where: { merchantId, sessionId }, select: { id: true } })) {
        throw new ConflictException("acp_session_completed");
      }
      return applyAcpSessionPatch({
        sessions,
        updateCart: new UpdateCartUseCase(sessions, sessions),
        variantLookup: new ProductVariantLookupAdapter(tx),
        applyCoupon: { executeForCheckout: input => this.applyCoupon.executeForCheckoutInTransaction(tx, input) },
      }, merchantId, sessionId, frozen);
    });
  }
}
