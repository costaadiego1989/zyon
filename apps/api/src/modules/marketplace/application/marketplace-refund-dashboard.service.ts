import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { ExecuteMarketplaceRefundUseCase } from "./use-cases/execute-marketplace-refund.use-case.js";
import type { MarketplaceRefundAllocation } from "../domain/services/marketplace-refund-allocation.js";
import { fundingHash } from "../infrastructure/repositories/prisma-marketplace-funding.repository.js";

const selection = {
  id: true, fundingPlanId: true, returnId: true, amountCents: true, status: true, createdAt: true,
  allocation: true, allocationHash: true,
  operation: { select: { status: true } },
} satisfies Prisma.MarketplaceRefundPlanSelect;
type Plan = Prisma.MarketplaceRefundPlanGetPayload<{ select: typeof selection }>;

@Injectable()
export class MarketplaceRefundDashboardService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(ExecuteMarketplaceRefundUseCase) private readonly executor: ExecuteMarketplaceRefundUseCase) {}

  async list(hostMerchantId: string, limit: number, cursor?: string) {
    try {
      // Journals are not protected by tenant middleware. Prove the caller on PaymentIntent first.
      const payment = await this.prisma.paymentIntent.findFirst({ where: { merchantId: hostMerchantId,
        marketplaceFunding: { is: { hostMerchantId, refunds: { some: { hostMerchantId } } } } }, select: { merchantId: true } });
      if (payment?.merchantId !== hostMerchantId) {
        if (cursor) throw new NotFoundException();
        return { refunds: [], next_cursor: null };
      }
      const where = { hostMerchantId, return: { merchantId: hostMerchantId }, fundingPlan: { hostMerchantId, payment: { merchantId: hostMerchantId } } };
      const anchor = cursor ? await this.prisma.marketplaceRefundPlan.findFirst({ where: { ...where, id: cursor }, select: { id: true, createdAt: true } }) : undefined;
      if (cursor && !anchor) throw new NotFoundException();
      const rows = await this.prisma.marketplaceRefundPlan.findMany({ where: { ...where,
        ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select: selection });
      return { refunds: rows.slice(0, limit).map(row => this.view(row)), next_cursor: rows.length > limit ? rows[limit - 1].id : null };
    } catch (error) { throw this.publicError(error); }
  }

  /** Local journal only. Recovery workers independently reconcile with provider GETs. */
  async detail(hostMerchantId: string, refundId: string) {
    try { return this.view(await this.requirePlan(hostMerchantId, refundId)); }
    catch (error) { throw this.publicError(error); }
  }

  async execute(hostMerchantId: string, refundId: string, expectedAmountCents: number) {
    try {
      const before = this.view(await this.requirePlan(hostMerchantId, refundId));
      if (before.amount_cents !== expectedAmountCents) throw new ConflictException();
      // Repeated commands never initiate another submission after a journal became unresolved.
      if (!before.can_execute) return before;
      const result = await this.executor.execute(hostMerchantId, refundId);
      const after = this.view(await this.requirePlan(hostMerchantId, refundId));
      return result === "blocked" && after.status === "prepared" ? { ...after, status: "blocked" as const, can_execute: false } : after;
    } catch (error) { throw this.publicError(error); }
  }

  private async requirePlan(hostMerchantId: string, id: string): Promise<Plan> {
    // The protected parent read happens before returning a replay or touching a financial operation.
    const payment = await this.prisma.paymentIntent.findFirst({ where: { merchantId: hostMerchantId,
      marketplaceFunding: { is: { hostMerchantId, refunds: { some: { id, hostMerchantId } } } } }, select: { id: true, merchantId: true } });
    if (payment?.merchantId !== hostMerchantId) throw new NotFoundException();
    const plan = await this.prisma.marketplaceRefundPlan.findFirst({ where: { id, hostMerchantId, fundingPlanId: payment.id,
      return: { merchantId: hostMerchantId } }, select: selection });
    if (!plan) throw new NotFoundException();
    return plan;
  }

  private view(plan: Plan) {
    const allocation = plan.allocation as unknown as MarketplaceRefundAllocation;
    if (!allocation || fundingHash(allocation) !== plan.allocationHash || allocation.version !== 1 || allocation.amountCents !== plan.amountCents ||
      !Array.isArray(allocation.lines) || !Array.isArray(allocation.shipping) || !allocation.policy ||
      ![allocation.policy.commission, allocation.policy.platformFees, allocation.policy.hostPlatformFee].every(value => ["refund", "retain"].includes(value))) throw new Error("invalid_refund_allocation");
    const status = plan.status === "confirmed" && plan.operation?.status === "confirmed" ? "confirmed" :
      ["blocked", "failed"].includes(plan.status) || plan.operation?.status === "failed" ? "blocked" :
      plan.status === "prepared" && plan.operation?.status === "planned" ? "prepared" :
      ["unknown", "pending"].includes(plan.operation?.status ?? "") ? "pending" : "blocked";
    const lines = allocation.lines.map(line => ({ variant_id: line.variantId, quantity: line.quantity, amount_cents: line.grossAmountCents }));
    const amounts = [plan.amountCents, allocation.buyerServiceFeeCents, allocation.hostPlatformFeeRefundCents,
      allocation.platformDebitCents, ...lines.map(line => line.amount_cents), ...allocation.shipping.map(row => row.amountCents),
      ...allocation.lines.flatMap(line => [line.commissionRefundCents, line.platformFeeRefundCents])];
    if (amounts.some(value => !Number.isSafeInteger(value) || value < 0) || lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1)) throw new Error("invalid_refund_amount");
    return { refund_id: plan.id, payment_intent_id: plan.fundingPlanId, return_id: plan.returnId, created_at: plan.createdAt.toISOString(),
      amount_cents: plan.amountCents, currency: "BRL" as const, status, can_execute: status === "prepared", lines,
      components: { commission: allocation.policy.commission, platform_fees: allocation.policy.platformFees, host_platform_fee: allocation.policy.hostPlatformFee,
        commission_refund_cents: allocation.lines.reduce((sum, line) => sum + line.commissionRefundCents, 0),
        platform_fee_refund_cents: allocation.lines.reduce((sum, line) => sum + line.platformFeeRefundCents, 0),
        host_platform_fee_refund_cents: allocation.hostPlatformFeeRefundCents,
        buyer_service_fee_cents: allocation.buyerServiceFeeCents, shipping_cents: allocation.shipping.reduce((sum, row) => sum + row.amountCents, 0) } };
  }
  private publicError(error: unknown): Error {
    if (error instanceof NotFoundException) return new NotFoundException("marketplace_refund_not_found");
    if (error instanceof ConflictException) return new ConflictException("marketplace_refund_unavailable");
    return new ServiceUnavailableException("marketplace_refund_temporarily_unavailable");
  }
}
