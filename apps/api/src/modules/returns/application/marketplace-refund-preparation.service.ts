import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MarketplaceReturnWorkflowService } from "./marketplace-return-workflow.service.js";
import { buildMarketplaceFundingBudget, type FrozenMarketplaceFunding } from "../../marketplace/domain/services/marketplace-funding-budget.js";
import { marketplaceReturnShipping, type MarketplaceRefundAllocation, type MarketplaceRefundComponents } from "../../marketplace/domain/services/marketplace-refund-allocation.js";
import { fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { marketplaceRefundPreparationHash } from "../../marketplace/domain/services/marketplace-refund-preparation-hash.js";

const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const policies = ["refund", "retain"];
export type RefundPreparationCandidate = {
  return_id: string; payment_intent_id: string; created_at: string; expected_preparation_hash: string;
  products_amount_cents: number; buyer_service_fee_available_cents: number; buyer_service_fee_refund_cents: number;
  lines: Array<{ variant_id: string; merchant_id: string; quantity: number; amount_cents: number }>;
  shipping: Array<{ merchant_id: string; merchant_name: string; available_cents: number; refund_cents: number }>;
  required_policy: { commission: "refund" | "retain"; platformFees: "refund" | "retain"; hostPlatformFee: "refund" | "retain" } | null;
  can_prepare: boolean;
};
type PreparedView = { refund_id: string; payment_intent_id: string; return_id: string; amount_cents: number; status: "prepared" | "pending" | "confirmed" | "blocked" };

@Injectable()
export class MarketplaceRefundPreparationService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MarketplaceReturnWorkflowService) private readonly workflow: MarketplaceReturnWorkflowService) {}

  async list(host: string, limit: number, cursor?: string) {
    try {
      const anchor = cursor ? await this.prisma.return.findFirst({ where: { id: cursor, merchantId: host }, select: { id: true, merchantId: true, createdAt: true } }) : undefined;
      if (cursor && anchor?.merchantId !== host) throw new NotFoundException();
      // Bounded scan of approved returns, including ordinary returns that are filtered below.
      // The cursor follows scanned rows so ordinary returns cannot hide later candidates.
      const rows = await this.prisma.return.findMany({ where: { merchantId: host, status: "INSPECTED_PASS", refund: { is: null }, marketplaceRefund: { is: null },
        ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select: { id: true, merchantId: true } });
      const candidates: RefundPreparationCandidate[] = [];
      for (const row of rows.slice(0, limit)) {
        if (row.merchantId !== host) continue;
        try { const result = await this.read(host, row.id); if (result.candidate) candidates.push(result.candidate); }
        catch (error) { if (!(error instanceof NotFoundException) && !(error instanceof ConflictException)) throw error; }
      }
      return { candidates, next_cursor: rows.length > limit && rows[limit - 1].merchantId === host ? rows[limit - 1].id : null };
    } catch (error) { throw this.publicError(error); }
  }

  async detail(host: string, returnId: string) {
    try { return await this.read(host, returnId); } catch (error) { throw this.publicError(error); }
  }

  async prepare(host: string, returnId: string, expectedHash: string, components: MarketplaceRefundComponents) {
    try {
      this.validateComponents(components);
      const before = await this.read(host, returnId);
      if (before.candidate) {
        const candidate = before.candidate;
        if (!candidate.can_prepare || candidate.expected_preparation_hash !== expectedHash) throw new ConflictException();
        if (components.buyerServiceFeeCents !== candidate.buyer_service_fee_refund_cents || components.shipping.length !== candidate.shipping.length ||
          components.shipping.some(row => !candidate.shipping.some(available => available.merchant_id === row.merchantId && row.amountCents === available.refund_cents))) throw new BadRequestException();
      }
      // Existing-plan replay still passes the core's immutable component check.
      await this.workflow.prepare(host, returnId, components, expectedHash);
      const after = await this.read(host, returnId);
      if (!after.prepared_refund) throw new ConflictException();
      return after;
    } catch (error) { throw this.publicError(error); }
  }

  private async read(host: string, returnId: string): Promise<{ return_id: string; candidate: RefundPreparationCandidate | null; prepared_refund: PreparedView | null }> {
    const returned = await this.prisma.return.findFirst({ where: { id: returnId, merchantId: host },
      select: { id: true, merchantId: true, orderId: true, status: true, createdAt: true, items: { select: { variantId: true, quantity: true } }, refund: { select: { id: true } } } });
    if (returned?.merchantId !== host) throw new NotFoundException();
    const existing = await this.prisma.marketplaceRefundPlan.findFirst({ where: { returnId, hostMerchantId: host },
      select: { id: true, returnId: true, fundingPlanId: true, amountCents: true, status: true, operation: { select: { status: true } } } });
    if (existing) {
      const owned = await this.prisma.paymentIntent.findFirst({ where: { id: existing.fundingPlanId, merchantId: host }, select: { merchantId: true } });
      if (owned?.merchantId !== host) throw new NotFoundException();
      const status = existing.status === "confirmed" && existing.operation?.status === "confirmed" ? "confirmed" :
        existing.status === "prepared" && existing.operation?.status === "planned" ? "prepared" :
        ["unknown", "pending"].includes(existing.operation?.status ?? "") ? "pending" : "blocked";
      return { return_id: returnId, candidate: null, prepared_refund: { refund_id: existing.id, payment_intent_id: existing.fundingPlanId,
        return_id: returnId, amount_cents: existing.amountCents, status } };
    }
    if (returned.status !== "INSPECTED_PASS" || returned.refund || !returned.items.length || returned.items.length > 100) throw new ConflictException();
    const completed = await this.prisma.completedOrder.findMany({ where: { merchantId: host, OR: [{ id: returned.orderId }, { externalOrderId: returned.orderId }] },
      select: { id: true, externalOrderId: true }, take: 101 });
    if (completed.length > 100) throw new ConflictException();
    const orderIds = [...new Set([returned.orderId, ...completed.map(row => row.externalOrderId)])];
    const payments = await this.prisma.paymentIntent.findMany({ where: { merchantId: host, marketplaceFunding: { is: { hostMerchantId: host } },
      OR: [{ providerPaymentId: { in: orderIds } }, { commerceOrderId: { in: orderIds } }] },
      select: { id: true, merchantId: true, providerPaymentId: true, status: true, creation: true, currency: true, amountCents: true, approvedAmountCents: true, marketplaceFunding: true }, take: 2 });
    if (!payments.length) throw new NotFoundException();
    if (payments.length !== 1 || payments[0].merchantId !== host) throw new ConflictException();
    const payment = payments[0], plan = payment.marketplaceFunding!;
    if (!plan.budget || !plan.providerPaymentId || payment.providerPaymentId !== plan.providerPaymentId || payment.status !== "approved" ||
      payment.currency !== "BRL" || payment.amountCents !== plan.amountCents || payment.approvedAmountCents !== plan.amountCents || !["held", "funded"].includes(plan.status)) throw new ConflictException();
    const instructions = plan.instructions as unknown as FrozenMarketplaceFunding;
    const budget = plan.budget as unknown as ReturnType<typeof buildMarketplaceFundingBudget>;
    const frozen = (payment.creation as { input?: { marketplaceFunding?: unknown } } | null)?.input?.marketplaceFunding;
    if (fundingHash(instructions) !== plan.instructionsHash || fundingHash(frozen) !== plan.instructionsHash ||
      fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) || budget.capture.providerPaymentId !== plan.providerPaymentId ||
      budget.capture.accountFingerprint !== plan.accountFingerprint || plan.payoutTotalCents !== budget.payoutTotalCents ||
      plan.netAmountCents !== budget.capture.netAmountCents || plan.platformRetainedCents !== budget.platformRetainedCents) throw new ConflictException();
    const cross = await this.prisma.crossStoreLineItem.findMany({ where: { hostMerchantId: host, orderId: plan.providerPaymentId } });
    const identities = [...cross.map(row => {
      const line = budget.lines.find(line => line.lineItemId === row.id);
      if (!row.sourceVariantId || !line || line.sellerMerchantId !== row.sellerMerchantId || row.quantity * row.unitPriceCents !== line.grossAmountCents || row.commissionCents !== line.commissionCents) throw new ConflictException();
      return { lineItemId: row.id, variantId: row.sourceVariantId, quantity: row.quantity };
    }), ...(instructions.hostStockItems ?? []).map(row => ({ lineItemId: row.lineItemId, variantId: row.variantId, quantity: row.quantity }))];
    if (identities.length !== budget.lines.length || new Set(identities.map(row => row.variantId)).size !== identities.length) throw new ConflictException();
    const previous = await this.prisma.marketplaceRefundPlan.findMany({ where: { fundingPlanId: plan.paymentIntentId, hostMerchantId: host }, select: { id: true, status: true, allocation: true, allocationHash: true,
      operation: { select: { status: true, providerOperationId: true } } } });
    const allocations = previous.map(row => {
      const value = row.allocation as unknown as MarketplaceRefundAllocation;
      if (fundingHash(value) !== row.allocationHash || !Array.isArray(value.lines) || !Array.isArray(value.shipping) || !value.policy ||
        ![value.policy.commission, value.policy.platformFees, value.policy.hostPlatformFee].every(v => policies.includes(v))) throw new ConflictException();
      return value;
    });
    const lines = returned.items.map(item => {
      const identity = identities.find(row => row.variantId === item.variantId), line = budget.lines.find(row => row.lineItemId === identity?.lineItemId);
      const already = allocations.flatMap(row => row.lines).filter(row => row.variantId === item.variantId).reduce((sum, row) => sum + row.quantity, 0);
      if (!identity || !line || !Number.isSafeInteger(identity.quantity) || identity.quantity < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        item.quantity + already > identity.quantity || line.grossAmountCents % identity.quantity !== 0) throw new ConflictException();
      return { variant_id: item.variantId, merchant_id: line.sellerMerchantId, quantity: item.quantity, amount_cents: line.grossAmountCents / identity.quantity * item.quantity };
    }).sort((a, b) => a.variant_id.localeCompare(b.variant_id));
    const origins = [...new Set(lines.map(line => line.merchant_id))].sort();
    const automaticShipping = marketplaceReturnShipping({ instructions, budget, identities, items: returned.items, previous: allocations });
    const merchants = await this.prisma.merchant.findMany({ where: { id: { in: origins } }, select: { id: true, name: true } });
    const shipping = origins.map(merchantId => ({ merchant_id: merchantId, merchant_name: merchants.find(row => row.id === merchantId)?.name || "Loja participante",
      refund_cents: automaticShipping.find(row => row.merchantId === merchantId)!.amountCents,
      available_cents: instructions.shipping.filter(row => row.merchantId === merchantId).reduce((sum, row) => sum + row.amountCents, 0) -
        allocations.flatMap(row => row.shipping).filter(row => row.merchantId === merchantId).reduce((sum, row) => sum + row.amountCents, 0) }));
    const buyerFee = instructions.buyerServiceFeeCents - allocations.reduce((sum, row) => sum + row.buyerServiceFeeCents, 0);
    const allUnitsReturned = identities.every(identity => identity.quantity ===
      allocations.flatMap(row => row.lines).filter(row => row.variantId === identity.variantId).reduce((sum, row) => sum + row.quantity, 0) +
      returned.items.filter(row => row.variantId === identity.variantId).reduce((sum, row) => sum + row.quantity, 0));
    if (!cents(buyerFee) || shipping.some(row => !cents(row.available_cents))) throw new ConflictException();
    const expectedHash = marketplaceRefundPreparationHash({ hostMerchantId: host, paymentIntentId: payment.id, returnId, orderId: returned.orderId, status: returned.status,
      items: returned.items, identities, instructionsHash: plan.instructionsHash, budgetHash: fundingHash(budget), previous });
    return { return_id: returnId, prepared_refund: null, candidate: { return_id: returnId, payment_intent_id: payment.id, created_at: returned.createdAt.toISOString(),
      expected_preparation_hash: expectedHash, products_amount_cents: lines.reduce((sum, row) => sum + row.amount_cents, 0), lines, shipping,
      buyer_service_fee_available_cents: buyerFee, buyer_service_fee_refund_cents: allUnitsReturned ? buyerFee : 0,
      required_policy: allocations[0]?.policy ?? null,
      can_prepare: previous.every(row => row.status === "confirmed" && row.operation?.status === "confirmed" && !!row.operation.providerOperationId) } };
  }
  private validateComponents(value: MarketplaceRefundComponents) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 5 ||
      Object.keys(value).some(key => !["commission", "platformFees", "hostPlatformFee", "buyerServiceFeeCents", "shipping"].includes(key)) ||
      ![value.commission, value.platformFees, value.hostPlatformFee].every(v => policies.includes(v)) || !cents(value.buyerServiceFeeCents) ||
      !Array.isArray(value.shipping) || value.shipping.length > 100 || value.shipping.some(row => !row || Object.keys(row).length !== 2 ||
        !id(row.merchantId) || !cents(row.amountCents)) || new Set(value.shipping.map(row => row.merchantId)).size !== value.shipping.length) throw new BadRequestException();
  }
  private publicError(error: unknown) {
    if (error instanceof NotFoundException) return new NotFoundException("marketplace_return_not_found");
    if (error instanceof ConflictException || error instanceof Error && error.message === "marketplace_refund_preparation_changed") return new ConflictException("marketplace_return_preparation_changed_or_unavailable");
    if (error instanceof BadRequestException) return new BadRequestException("invalid_marketplace_return_components");
    return new ServiceUnavailableException("marketplace_return_preparation_temporarily_unavailable");
  }
}
