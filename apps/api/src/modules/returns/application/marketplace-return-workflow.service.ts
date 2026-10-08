import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Logger, Optional } from "@nestjs/common";
import { ReturnShippingService } from "./return-shipping.service.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { PrismaMarketplaceRefundRepository } from "../../marketplace/infrastructure/repositories/prisma-marketplace-refund.repository.js";
import type { MarketplaceRefundComponents } from "../../marketplace/domain/services/marketplace-refund-allocation.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const cents = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647;

/** Routes legacy return actions before they can create an incompatible refund marker. */
@Injectable()
export class MarketplaceReturnWorkflowService {
  private readonly logger = new Logger(MarketplaceReturnWorkflowService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PrismaMarketplaceRefundRepository) private readonly refunds: PrismaMarketplaceRefundRepository,
    @Optional() @Inject(ReturnShippingService) private readonly shipping?: ReturnShippingService) {}

  async prepare(merchantId: string, returnId: string, components?: MarketplaceRefundComponents, expectedPreparationHash?: string) {
    const payment = await this.resolve(merchantId, returnId);
    if (!payment) {
      if (components !== undefined) throw new BadRequestException("marketplace_refund_order_required");
      return undefined;
    }
    this.validateComponents(components);
    const plan = await this.refunds.prepare({ hostMerchantId: merchantId, paymentIntentId: payment.id, returnId, components,
      ...(expectedPreparationHash !== undefined ? { expectedPreparationHash } : {}) });
    try { await this.shipping?.cancelMarketplace(merchantId, returnId); }
    catch { this.logger.warn(`return_shipping_cancellation_requires_review return=${returnId}`); }
    const returned = await this.prisma.return.findFirst({ where: { id: returnId, merchantId }, select: { status: true } });
    if (!returned) throw new NotFoundException("return_not_found");
    return { returnId, status: returned.status, marketplaceSettlementsCancelled: 0, marketplaceSkipped: 0,
      marketplaceRefundPlanId: plan.id, marketplaceRefundStatus: plan.status, marketplaceRefundAmountCents: plan.amountCents };
  }

  async assertOrdinary(merchantId: string, returnId: string): Promise<void> {
    if (await this.resolve(merchantId, returnId)) throw new ConflictException("marketplace_refund_journal_required");
  }

  private validateComponents(value: unknown): asserts value is MarketplaceRefundComponents {
    const row = object(value), allowed = ["commission", "platformFees", "hostPlatformFee", "buyerServiceFeeCents", "shipping"];
    if (Object.keys(row).length !== allowed.length || Object.keys(row).some(key => !allowed.includes(key)) ||
        ![row.commission, row.platformFees, row.hostPlatformFee].every(policy => policy === "refund" || policy === "retain") ||
        !cents(row.buyerServiceFeeCents) || !Array.isArray(row.shipping) || row.shipping.length > 100 ||
        row.shipping.some(item => { const shipping = object(item); return Object.keys(shipping).length !== 2 ||
          Object.keys(shipping).some(key => !["merchantId", "amountCents"].includes(key)) ||
          typeof shipping.merchantId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(shipping.merchantId) || !cents(shipping.amountCents); }) ||
        new Set(row.shipping.map(item => object(item).merchantId)).size !== row.shipping.length) {
      throw new BadRequestException("marketplace_refund_components_required");
    }
  }

  private async resolve(merchantId: string, returnId: string) {
    // The protected return and payment reads precede unscoped marketplace journals.
    const returned = await this.prisma.return.findFirst({ where: { id: returnId, merchantId }, select: { orderId: true } });
    if (!returned) throw new NotFoundException("return_not_found");
    const completed = await this.prisma.completedOrder.findMany({ where: { merchantId,
      OR: [{ id: returned.orderId }, { externalOrderId: returned.orderId }] }, select: { externalOrderId: true, sessionId: true }, take: 101 });
    if (completed.length > 100) throw new ConflictException("marketplace_return_identity_unreconciled");
    const orderIds = [...new Set([returned.orderId, ...completed.map(row => row.externalOrderId)])];
    const payments = await this.prisma.paymentIntent.findMany({ where: { merchantId, OR: [
      { providerPaymentId: { in: orderIds } }, { commerceOrderId: { in: orderIds } },
      { sessionId: { in: completed.map(row => row.sessionId) } },
    ] }, select: { id: true, sessionId: true, creation: true,
      marketplaceFunding: { select: { hostMerchantId: true, paymentIntentId: true } } }, take: 101 });
    if (payments.length > 100) throw new ConflictException("marketplace_return_identity_unreconciled");
    const sessionIds = [...new Set([...completed.map(row => row.sessionId), ...payments.map(row => row.sessionId)])];
    const sessions = await this.prisma.checkoutSession.findMany({ where: { merchantId, sessionId: { in: sessionIds } }, select: { cart: true } });
    const cartRefs = sessions.map(row => object(row.cart).cart_ref).filter((id): id is string => typeof id === "string");
    const cross = await this.prisma.crossStoreLineItem.count({ where: { hostMerchantId: merchantId,
      OR: [{ orderId: { in: orderIds } }, { checkoutSessionId: { in: [...sessionIds, ...cartRefs] } }] } });
    const ledger = await this.prisma.marketplaceOrderLedger.count({ where: { hostMerchantId: merchantId, orderId: { in: orderIds } } });
    const settlement = await this.prisma.marketplaceSettlement.count({ where: { hostMerchantId: merchantId, orderId: { in: orderIds } } });
    const classified = payments.filter(row => row.marketplaceFunding || object(object(row.creation).input).marketplaceFunding != null);
    const markedCart = sessions.some(row => { const cart = object(row.cart); return Array.isArray(cart.items) &&
      cart.items.some(item => object(item).marketplace != null); });
    if (!classified.length && !cross && !ledger && !settlement && !markedCart) return undefined;
    // Never infer missing financial instructions from today's catalog or configuration.
    if (classified.length !== 1 || !classified[0].marketplaceFunding || classified[0].marketplaceFunding.hostMerchantId !== merchantId) {
      throw new ConflictException("marketplace_return_identity_unreconciled");
    }
    return classified[0];
  }
}
