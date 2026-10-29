import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import type { MarketplaceFinancialRepository, PlaceMarketplaceOrder, MarketplaceChargebackResult, MarketplaceReturnInput, MarketplaceReturnResult } from "../../domain/ports/marketplace-financial-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";
import { PrismaMarketplaceSettlementRepository } from "./prisma-marketplace-settlement.repository.js";
import { PrismaMarketplaceSellerDebtRepository } from "./prisma-marketplace-seller-debt.repository.js";
import { assertMarketplaceStockPayment, consumeMarketplaceHostStock } from "./marketplace-payment-stock.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { assertMarketplaceInventoryStock, commitMarketplaceInventory } from "./marketplace-inventory-sale.js";
import type { FrozenMarketplaceFunding } from "../../domain/services/marketplace-funding-budget.js";
import { fundingHash } from "./prisma-marketplace-funding.repository.js";
import { recordMarketplaceShipmentInterruption } from "./marketplace-shipment-interruption.js";
import { recordMarketplaceReversalRecoveryEvidence } from "./prisma-marketplace-transfer-reversal.repository.js";

@Injectable()
export class PrismaMarketplaceFinancialRepository implements MarketplaceFinancialRepository {
  constructor(private readonly prisma: PrismaClient, @Optional() private readonly tenantContext?: TenantContextService) {}

  private async lock(tx: Prisma.TransactionClient, host: string, order: string): Promise<void> {
    if (!host?.trim() || !order?.trim()) throw new BadRequestException("marketplace_order_scope_required");
    // The lock also serializes an early dispute against an order with no ledger yet.
    const key = JSON.stringify(["marketplace-order", host, order]);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  }

  async registerReturn(input: MarketplaceReturnInput): Promise<MarketplaceReturnResult> {
    return this.prisma.$transaction(async tx => {
      const orderIds = new Set(input.orderId ? [input.orderId] : []);
      if (input.orderId) {
        // Returns may carry a commerce/completed-order reference, whereas the
        // marketplace ledger is keyed by the provider's charge. Resolve only
        // persisted references belonging to the authenticated host.
        const completed = await tx.completedOrder.findMany({ where: { merchantId: input.merchantId,
          OR: [{ id: input.orderId }, { externalOrderId: input.orderId }] }, select: { externalOrderId: true } });
        for (const row of completed) orderIds.add(row.externalOrderId);
        const payments = await tx.paymentIntent.findMany({ where: { merchantId: input.merchantId,
          commerceOrderId: { in: [...orderIds] }, providerPaymentId: { not: null } }, select: { providerPaymentId: true } });
        for (const row of payments) if (row.providerPaymentId) orderIds.add(row.providerPaymentId);
      }
      const where: Prisma.MarketplaceSettlementWhereInput = {
        OR: [{ hostMerchantId: input.merchantId }, { sellerMerchantId: input.merchantId }],
        ...(input.settlementId ? { id: input.settlementId } : {}),
        ...(input.orderId ? { orderId: { in: [...orderIds] } } : {}),
      };
      const initial = await tx.marketplaceSettlement.findMany({ where, orderBy: [{ hostMerchantId: "asc" }, { orderId: "asc" }, { id: "asc" }] });
      for (const row of initial) await this.lock(tx, row.hostMerchantId, row.orderId);
      const ids = initial.map(row => row.id);
      if (ids.length) await tx.$queryRaw`SELECT id FROM marketplace_settlements WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const rows = await tx.marketplaceSettlement.findMany({ where: { ...where, id: { in: ids } }, orderBy: { id: "asc" } });
      const wanted = input.items?.map(item => item.variantId) ?? input.variantIds;
      const lines = await tx.crossStoreLineItem.findMany({ where: {
        OR: [{ hostMerchantId: input.merchantId }, { sellerMerchantId: input.merchantId }],
        ...(input.orderId ? { orderId: { in: [...orderIds] } } : {}),
        ...(input.settlementId ? { id: { in: rows.map(row => row.lineItemId) } } : {}),
        ...(wanted ? { AND: [{ OR: [{ federatedProductId: { in: wanted } }, { sourceVariantId: { in: wanted } }] }] } : {}),
      } });
      const lineIds = new Set(lines.map(line => line.id));
      const selected = wanted ? rows.filter(row => lineIds.has(row.lineItemId)) : rows;
      if (!selected.length) {
        if (lines.length) throw new ConflictException("marketplace_return_settlement_pending");
        throw new NotFoundException("no_marketplace_settlement_for_return");
      }
      if (lines.some(line => !rows.some(row => row.lineItemId === line.id))) {
        throw new ConflictException("marketplace_return_settlement_pending");
      }
      if (input.items) {
        const requested = new Map<string, number>();
        for (const item of input.items) requested.set(item.variantId, (requested.get(item.variantId) ?? 0) + item.quantity);
        const purchased = new Map<string, number>();
        for (const line of lines) {
          const variant = line.sourceVariantId && requested.has(line.sourceVariantId) ? line.sourceVariantId : line.federatedProductId;
          if (line.sourceVariantId && requested.has(line.sourceVariantId) && requested.has(line.federatedProductId)) {
            throw new ConflictException("marketplace_return_variant_ambiguous");
          }
          purchased.set(variant, (purchased.get(variant) ?? 0) + line.quantity);
        }
        for (const [variant, quantity] of purchased) if (requested.get(variant) !== quantity) {
          // Partial quantities require a separate allocation/reversal ledger;
          // cancelling the full seller obligation here would lose money.
          throw new ConflictException("marketplace_partial_quantity_return_requires_reconciliation");
        }
      }
      const payouts = await tx.marketplacePayout.findMany({ where: { settlementId: { in: selected.map(row => row.id) } } });
      const fundingPlans = await tx.marketplaceFundingPlan.findMany({ where: { OR: selected.map(row => ({
        hostMerchantId: row.hostMerchantId, providerPaymentId: row.orderId,
      })) } });
      // Host commission is part of the same capture. A return cannot cancel only
      // the seller while silently leaving the host's transfer in flight.
      if (fundingPlans.length && await tx.marketplacePayout.count({ where: { fundingPlanId: { in: fundingPlans.map(row => row.paymentIntentId) },
        status: { notIn: ["planned", "cancelled"] } } })) throw new ConflictException("marketplace_return_payout_requires_reconciliation");
      const requestedAt = input.requestedAt ?? new Date();
      for (const row of selected) {
        const payout = payouts.find(p => p.settlementId === row.id);
        if (payout && !["planned", "cancelled"].includes(payout.status)) throw new ConflictException("marketplace_return_payout_requires_reconciliation");
        if (row.status === "return_cancelled") continue;
        if (!["awaiting_return_window", "transfer_scheduled"].includes(row.status)) throw new ConflictException("marketplace_return_status_conflict");
        if (row.returnWindowUntil <= requestedAt) throw new ConflictException("return_window_expired");
      }
      const repository = new PrismaMarketplaceSettlementRepository(tx as PrismaClient);
      await recordMarketplaceShipmentInterruption(tx, fundingPlans.map(row => row.paymentIntentId), "return_after_carrier_submission");
      await tx.marketplaceFundingPlan.updateMany({ where: { paymentIntentId: { in: fundingPlans.map(row => row.paymentIntentId) }, status: "funded" }, data: { status: "held" } });
      await tx.marketplaceResidualPlan.updateMany({ where: {
        fundingPlanId: { in: fundingPlans.map(row => row.paymentIntentId) }, status: { not: "held" } },
        data: { status: "held", heldReason: "marketplace_residual_return_requires_reconciliation" } });
      const updated = [];
      for (const row of selected) {
        await tx.marketplacePayout.updateMany({ where: { settlementId: row.id, status: "planned" },
          data: { status: "cancelled", version: { increment: 1 } } });
        updated.push(await repository.updateStatus({ settlementId: row.id, expectedStatus: row.status as any,
          status: "return_cancelled", returnAt: row.returnAt ?? requestedAt }));
      }
      return { updated, skipped: [] };
    });
  }

  async placeOrder(input: PlaceMarketplaceOrder) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, input.hostMerchantId, input.orderId);
      const cartKey = JSON.stringify(["storefront-cart", input.hostMerchantId, input.checkoutSessionId]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cartKey}, 0))`;
      const items = await tx.crossStoreLineItem.findMany({ where: {
        hostMerchantId: input.hostMerchantId, checkoutSessionId: input.checkoutSessionId,
      }, orderBy: { id: "asc" } });
      if (!items.length) return [];
      if (items.some(item => item.orderId && item.orderId !== input.orderId)) {
        throw new ConflictException("marketplace_order_scope_mismatch");
      }
      const plan = await tx.marketplaceFundingPlan.findFirst({ where: { hostMerchantId: input.hostMerchantId, checkoutSessionId: input.checkoutSessionId } });
      if (!plan) throw new ConflictException("marketplace_inventory_payment_plan_required");
      const instructions = plan.instructions as unknown as FrozenMarketplaceFunding;
      const sellerLines = instructions.lines.filter(line => line.sellerMerchantId !== input.hostMerchantId);
      if (sellerLines.length !== items.length || items.some(item => !sellerLines.some(line => line.lineItemId === item.id &&
        line.sellerMerchantId === item.sellerMerchantId && line.grossAmountCents === item.quantity * item.unitPriceCents &&
        line.commissionCents === item.commissionCents))) throw new ConflictException("marketplace_order_funding_mismatch");
      const purchasedAt = input.purchasedAt ?? new Date();
      if (!Number.isFinite(purchasedAt.getTime())) throw new BadRequestException("marketplace_purchase_date_invalid");
      const key = { hostMerchantId: input.hostMerchantId, orderId: input.orderId };
      const ledger = await tx.marketplaceOrderLedger.upsert({
        where: { hostMerchantId_orderId: key },
        create: { ...key, checkoutSessionId: input.checkoutSessionId, purchasedAt }, update: {},
      });
      if (ledger.checkoutSessionId && ledger.checkoutSessionId !== input.checkoutSessionId) {
        throw new ConflictException("marketplace_order_session_mismatch");
      }
      const date = ledger.purchasedAt ?? purchasedAt;
      await tx.marketplaceOrderLedger.update({ where: { hostMerchantId_orderId: key },
        data: { checkoutSessionId: input.checkoutSessionId, purchasedAt: date } });
      const repo = new PrismaMarketplaceSettlementRepository(tx as PrismaClient);
      const machine = new SettlementStateMachineService();
      const result = [];
      if (plan) {
        // Redelivery of a fully committed order must survive a later refund or
        // dispute, but may not consume any additional units in those states.
        const participants = [...new Set(instructions.lines.map(line => line.sellerMerchantId))];
        const receipts = await tx.$queryRaw<Array<{ merchant_id: string }>>`SELECT merchant_id FROM inventory_sale_receipts
          WHERE order_id = ${input.orderId} AND merchant_id IN (${Prisma.join(participants)})`;
        const completedDelivery = receipts.length === participants.length && items.every(item => item.orderId === input.orderId) &&
          await tx.marketplaceSettlement.count({ where: { hostMerchantId: input.hostMerchantId, orderId: input.orderId,
            lineItemId: { in: items.map(item => item.id) } } }) === items.length &&
          await tx.stockReservation.count({ where: { marketplaceFundingPlanId: plan.paymentIntentId, status: { not: "CONFIRMED" } } }) === 0;
        await assertMarketplaceStockPayment(tx, plan.paymentIntentId, input.hostMerchantId, input.checkoutSessionId, input.orderId, completedDelivery);
        if (completedDelivery) {
          // The committed receipts own the sale snapshot. Later catalog/SKU
          // edits must not reinterpret or debit a successfully delivered order.
          return Promise.all(items.map(async item => {
            const settlement = await repo.findByLineItemId(item.id);
            if (!settlement) throw new ConflictException("marketplace_inventory_order_reconciliation_required");
            return settlement;
          }));
        }
      }
      // Ordinary inventory sales lock their merchant before catalog variants.
      // Lock all participants in one order to keep that ordering across tenants.
      for (const merchantId of [...new Set([input.hostMerchantId, ...items.map(item => item.sellerMerchantId)])].sort()) {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
      }
      // Same order as cart cleanup; the expiry worker shares the variant lock.
      for (const variantId of [...new Set([...items.flatMap(item => item.sourceVariantId ? [item.sourceVariantId] : []),
        ...(instructions?.hostStockItems ?? []).map(item => item.variantId)])].sort()) {
        await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${variantId} FOR UPDATE`;
      }
      // Validate the ledger before consuming any participant's physical balance.
      for (const item of items) if (item.stockReservationId && item.sourceVariantId) {
        const hold = await tx.stockReservation.findUnique({ where: { id: item.stockReservationId } });
        if (hold?.status === "ACTIVE") await assertMarketplaceInventoryStock(tx, item.sellerMerchantId, item.sourceVariantId, item.quantity);
      }
      if (plan && instructions) for (const item of instructions.hostStockItems ?? []) if (item.requiresStock) {
        const hold = await tx.stockReservation.findFirst({ where: { marketplaceFundingPlanId: plan.paymentIntentId, cartId: item.lineItemId } });
        if (hold?.status === "ACTIVE") await assertMarketplaceInventoryStock(tx, input.hostMerchantId, item.variantId, item.quantity);
      }
      if (plan && instructions) await consumeMarketplaceHostStock(tx, plan.paymentIntentId, instructions);
      for (const item of items) {
        if (item.stockReservationId) {
          const reservation = await tx.stockReservation.findUnique({ where: { id: item.stockReservationId } });
          if (!reservation || reservation.variantId !== item.sourceVariantId || reservation.cartId !== item.id ||
              reservation.quantity !== item.quantity || !reservation.stockId) throw new ConflictException("marketplace_reservation_binding_invalid");
          if (reservation.status === "CONFIRMED") {
            if (item.orderId !== input.orderId) throw new ConflictException("marketplace_reservation_order_mismatch");
          } else {
            // A delayed event may consume an active reservation paid before
            // expiry. Released/expired stock needs reconciliation, never a
            // blind decrement that could oversell another buyer's purchase.
            if (reservation.status !== "ACTIVE" || (!reservation.marketplaceFundingPlanId && reservation.expiresAt < date)) {
              throw new ConflictException("marketplace_paid_stock_reconciliation_required");
            }
            if (reservation.marketplaceFundingPlanId) await assertMarketplaceStockPayment(tx,
              reservation.marketplaceFundingPlanId, input.hostMerchantId, input.checkoutSessionId, input.orderId);
            const stock = await tx.productStock.updateMany({ where: { id: reservation.stockId, variantId: reservation.variantId,
              reserved: { gte: item.quantity }, quantity: { gte: item.quantity } },
              data: { reserved: { decrement: item.quantity }, quantity: { decrement: item.quantity } } });
            if (stock.count !== 1) throw new ConflictException("marketplace_paid_stock_reconciliation_required");
            await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: "CONFIRMED" } });
          }
        }
        const existing = await repo.findByLineItemId(item.id);
        const terms = item.termsJson as { returnWindowDays: number; payoutDelayDays: number; chargebackWindowDays: number } | null;
        // Existing obligations retain their original windows. A legacy cart without
        // agreed terms needs reconciliation; today's configuration cannot invent them.
        if (!existing && !terms) throw new ConflictException("marketplace_purchase_terms_missing");
        const windows = existing ?? machine.calculateWindows(terms!, date);
        let settlement = await repo.create({
          hostMerchantId: input.hostMerchantId, sellerMerchantId: item.sellerMerchantId,
          orderId: input.orderId, lineItemId: item.id,
          totalAmountCents: item.quantity * item.unitPriceCents,
          commissionCents: item.commissionCents, sellerNetCents: item.sellerNetCents,
          returnWindowUntil: windows.returnWindowUntil,
          transferScheduledAt: windows.transferScheduledAt ?? undefined,
          chargebackWindowUntil: windows.chargebackWindowUntil,
        });
        if (ledger.chargebackAt && ["awaiting_return_window", "transfer_scheduled"].includes(settlement.status)) {
          settlement = await repo.updateStatus({ settlementId: settlement.id, expectedStatus: settlement.status,
            status: "chargeback_cancelled", chargebackAt: ledger.chargebackAt });
        }
        await tx.crossStoreLineItem.update({ where: { id: item.id, hostMerchantId: input.hostMerchantId,
          OR: [{ orderId: null }, { orderId: input.orderId }] }, data: { orderId: input.orderId, purchasedAt: date } });
        result.push(settlement);
      }
      await commitMarketplaceInventory(tx, items, instructions, plan?.paymentIntentId, input.orderId, date, this.tenantContext);
      return result;
    });
  }

  async chargebackOrder(hostMerchantId: string, orderId: string): Promise<MarketplaceChargebackResult[]> {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, hostMerchantId, orderId);
      const key = { hostMerchantId, orderId };
      const ledger = await tx.marketplaceOrderLedger.upsert({ where: { hostMerchantId_orderId: key },
        create: { ...key, chargebackAt: new Date() }, update: {} });
      const chargebackAt = ledger.chargebackAt ?? new Date();
      if (!ledger.chargebackAt) await tx.marketplaceOrderLedger.update({ where: { hostMerchantId_orderId: key }, data: { chargebackAt } });
      const plans = await tx.marketplaceFundingPlan.findMany({ where: { hostMerchantId, providerPaymentId: orderId } });
      const planIds = plans.map(row => row.paymentIntentId);
      await recordMarketplaceShipmentInterruption(tx, planIds, "dispute_after_carrier_submission");
      await tx.marketplaceFundingPlan.updateMany({ where: { paymentIntentId: { in: planIds }, status: "funded" }, data: { status: "held" } });
      await tx.marketplacePayout.updateMany({ where: { fundingPlanId: { in: planIds }, status: "planned" },
        data: { status: "cancelled", version: { increment: 1 } } });
      // Original settlement amounts no longer describe money held by a merchant
      // once a residual transfer or a reversal exists. Preserve their receipts and
      // require reconciliation instead of constructing debt from the old amount.
      const residualPlans = await tx.marketplaceResidualPlan.findMany({ where: { hostMerchantId, fundingPlanId: { in: planIds } }, select: { id: true } });
      const reversals = await tx.marketplaceTransferReversal.count({ where: { hostMerchantId, refundPlan: { fundingPlanId: { in: planIds } } } });
      if (residualPlans.length || reversals) {
        await tx.marketplaceResidualPlan.updateMany({ where: { id: { in: residualPlans.map(row => row.id) }, status: { not: "held" } },
          data: { status: "held", heldReason: "marketplace_residual_dispute_requires_reconciliation" } });
        const eventId = `marketplace_recovery_dispute_${fundingHash([hostMerchantId, orderId])}`;
        await tx.outboxMessage.upsert({ where: { eventId }, update: {}, create: { eventId, merchantId: hostMerchantId,
          eventType: "marketplace.recovery.reconciliation_required", schemaVersion: 1, occurredAt: new Date(), producer: "marketplace",
          correlationId: orderId, causationId: orderId, payload: { order_id: orderId, reason: "dispute_after_financial_recovery", funding_plan_ids: planIds } } });
        for (const planId of planIds) await recordMarketplaceReversalRecoveryEvidence(tx, hostMerchantId, planId);
        return [];
      }
      const hostReceipts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: { in: planIds }, kind: "host_receivable", status: "confirmed" } });
      for (const payout of hostReceipts) await tx.marketplaceHostDebt.upsert({ where: { payoutId: payout.id },
        create: { payoutId: payout.id, hostMerchantId, amountCents: payout.amountCents }, update: {} });
      // Competing status transitions (finalization, returns, payout) must observe
      // the committed dispute before changing these rows.
      await tx.$queryRaw`SELECT id FROM marketplace_settlements WHERE host_merchant_id = ${hostMerchantId}
        AND order_id = ${orderId} ORDER BY id FOR UPDATE`;
      const rows = await tx.marketplaceSettlement.findMany({ where: key, orderBy: { id: "asc" } });
      const settlements = new PrismaMarketplaceSettlementRepository(tx as PrismaClient);
      const debts = new PrismaMarketplaceSellerDebtRepository(tx as PrismaClient);
      const results: MarketplaceChargebackResult[] = [];
      for (const row of rows) {
        if (row.status === "return_cancelled" || row.status === "chargeback_cancelled") continue;
        const needsDebt = ["transferred", "finalized", "chargeback_debt"].includes(row.status);
        if (!needsDebt && !["awaiting_return_window", "transfer_scheduled"].includes(row.status)) {
          throw new ConflictException("marketplace_chargeback_status_invalid");
        }
        const settlement = await settlements.updateStatus({ settlementId: row.id, expectedStatus: row.status as any,
          status: needsDebt ? "chargeback_debt" : "chargeback_cancelled", chargebackAt: row.chargebackAt ?? chargebackAt });
        // Replay repairs a historical status-without-debt and never duplicates or
        // reopens an already deducted/resolved debt.
        const payout = needsDebt ? await tx.marketplacePayout.findUnique({ where: { settlementId: row.id } }) : null;
        const debt = needsDebt ? await debts.create({ sellerMerchantId: row.sellerMerchantId,
          settlementId: row.id, amountCents: payout?.amountCents ?? row.sellerNetCents }) : undefined;
        results.push({ settlement, debtCreated: needsDebt, debt });
      }
      return results;
    });
  }
}
