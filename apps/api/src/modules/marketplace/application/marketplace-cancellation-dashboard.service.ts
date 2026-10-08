import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { MarketplaceCancellationReason } from "../domain/ports/marketplace-cancellation-execution.port.js";
import { ExecuteMarketplaceCancellationUseCase } from "./use-cases/execute-marketplace-cancellation.use-case.js";
import { MARKETPLACE_UNSUBMITTED_CANCELLATION_REPOSITORY, isNeverSubmittedMarketplacePayment, type MarketplaceUnsubmittedCancellationRepository } from "../domain/ports/marketplace-unsubmitted-cancellation.port.js";

export type MarketplaceCancellationDashboardState = "not_requested" | "pending" | "cancelled" | "blocked";
export type MarketplaceCancellationDashboardResult = { payment_intent_id: string; status: MarketplaceCancellationDashboardState };

/** Financial remediation remains available after a marketplace plan downgrade. */
@Injectable()
export class MarketplaceCancellationDashboardService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(ExecuteMarketplaceCancellationUseCase) private readonly executeCancellation: ExecuteMarketplaceCancellationUseCase,
    @Inject(MARKETPLACE_UNSUBMITTED_CANCELLATION_REPOSITORY) private readonly unsubmitted: MarketplaceUnsubmittedCancellationRepository,
  ) {}

  /** Cursor is resolved through the protected payment table, never a caller-supplied tenant. */
  async list(hostMerchantId: string, limit: number, cursor?: string) {
    try {
      const anchor = cursor ? await this.prisma.paymentIntent.findFirst({
        where: { id: cursor, merchantId: hostMerchantId, marketplaceFunding: { is: { hostMerchantId } } },
        select: { id: true, createdAt: true },
      }) : undefined;
      if (cursor && !anchor) throw new NotFoundException("marketplace_payment_not_found");
      const rows = await this.prisma.paymentIntent.findMany({
        where: { merchantId: hostMerchantId, marketplaceFunding: { is: { hostMerchantId } },
          ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
        select: { id: true, amountCents: true, currency: true, createdAt: true, status: true, method: true, providerPaymentId: true,
          creation: true, approvedAmountCents: true, statusHistory: true,
          marketplaceFunding: { select: { provider: true, status: true, budget: true,
            cancellationOperation: { select: { status: true, request: true } } } } },
      });
      const payments = await Promise.all(rows.slice(0, limit).map(async row => {
        const funding = row.marketplaceFunding!, operation = funding.cancellationOperation;
        const local = row.status === "cancelled" && !row.providerPaymentId ? await this.unsubmitted.status(hostMerchantId, row.id) : null;
        const status: MarketplaceCancellationDashboardState = local ? "cancelled" : !operation ? "not_requested" : operation.status === "confirmed" ? "cancelled" : operation.status === "blocked" ? "blocked" : "pending";
        const rawReason = (operation?.request as { cancellationReason?: unknown } | null)?.cancellationReason;
        const reason = local?.reason ?? (typeof rawReason === "string" && ["requested_by_customer", "abandoned", "duplicate", "fraudulent"].includes(rawReason) ? rawReason : null);
        const creation = row.creation as { state?: string; input?: { method?: string; asaasCustomerId?: string } } | null;
        const asaas = funding.provider === "asaas" && creation?.state === "complete" && ["pix", "boleto"].includes(row.method) &&
          creation.input?.method === row.method && /^cus_[A-Za-z0-9_-]+$/.test(creation.input?.asaasCustomerId ?? "") &&
          /^pay_[A-Za-z0-9_-]+$/.test(row.providerPaymentId ?? "");
        return { payment_intent_id: row.id, amount_cents: row.amountCents, currency: row.currency, created_at: row.createdAt.toISOString(), status, reason,
          can_request: !local && !operation && funding.status === "awaiting_capture" && !funding.budget && row.currency === "BRL" &&
            (isNeverSubmittedMarketplacePayment(row) || ((["stripe", "mercadopago"].includes(funding.provider) || asaas) &&
              !!row.providerPaymentId && ["pending", "requires_action", "failed", "cancelled"].includes(row.status))) };
      }));
      return { payments, next_cursor: rows.length > limit ? rows[limit - 1].id : null };
    } catch (error) { throw this.publicError(error); }
  }

  async cancel(hostMerchantId: string, paymentIntentId: string, reason: MarketplaceCancellationReason): Promise<MarketplaceCancellationDashboardResult> {
    try {
      await this.requireFunding(hostMerchantId, paymentIntentId);
      if (await this.unsubmitted.cancel(hostMerchantId, paymentIntentId, reason) === "released") {
        return { payment_intent_id: paymentIntentId, status: "cancelled" };
      }
      const result = await this.executeCancellation.execute(hostMerchantId, paymentIntentId, reason);
      return { payment_intent_id: paymentIntentId, status: result === "released" ? "cancelled" : result };
    } catch (error) { throw this.publicError(error); }
  }

  /** A status read never submits or reconciles an operation with the provider. */
  async status(hostMerchantId: string, paymentIntentId: string): Promise<MarketplaceCancellationDashboardResult> {
    try {
      await this.requireFunding(hostMerchantId, paymentIntentId);
      if (await this.unsubmitted.status(hostMerchantId, paymentIntentId)) {
        return { payment_intent_id: paymentIntentId, status: "cancelled" };
      }
      const operation = await this.prisma.marketplaceCancellationOperation.findFirst({
        where: { fundingPlanId: paymentIntentId, hostMerchantId }, select: { status: true },
      });
      const status = !operation ? "not_requested" : operation.status === "confirmed" ? "cancelled" :
        operation.status === "blocked" ? "blocked" : "pending";
      return { payment_intent_id: paymentIntentId, status };
    } catch (error) { throw this.publicError(error); }
  }

  private async requireFunding(hostMerchantId: string, paymentIntentId: string): Promise<void> {
    // PaymentIntent is tenant-middleware scoped; marketplace journal tables are not.
    // Perform this protected ownership read before touching any marketplace journal.
    const payment = await this.prisma.paymentIntent.findFirst({
      where: { id: paymentIntentId, merchantId: hostMerchantId }, select: { id: true },
    });
    if (!payment) throw new NotFoundException("marketplace_payment_not_found");
    const funding = await this.prisma.marketplaceFundingPlan.findFirst({
      where: { paymentIntentId, hostMerchantId }, select: { paymentIntentId: true },
    });
    if (!funding) throw new NotFoundException("marketplace_payment_not_found");
  }

  private publicError(error: unknown): Error {
    if (error instanceof NotFoundException) return new NotFoundException("marketplace_payment_not_found");
    if (error instanceof ConflictException) return new ConflictException("marketplace_cancellation_unavailable");
    return new ServiceUnavailableException("marketplace_cancellation_temporarily_unavailable");
  }
}
