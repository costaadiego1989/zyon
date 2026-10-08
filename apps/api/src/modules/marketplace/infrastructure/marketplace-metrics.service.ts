import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Counter, Gauge } from "prom-client";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { MARKETPLACE_TERMINAL_CANCELLATION_REASON } from "../domain/ports/marketplace-cancellation.port.js";
import { MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON } from "../domain/ports/marketplace-unsubmitted-cancellation.port.js";
import { MARKETPLACE_OPERATIONAL_EVENT_TYPES } from "../application/handlers/marketplace-operational-events.handler.js";
import { auditMarketplaceDebtPrincipalExtinctions } from "./marketplace-debt-principal-extinction-audit.js";

/** Database-backed gauges survive restarts; labels never contain tenant or order IDs. */
@Injectable()
export class MarketplaceMetricsService {
  private readonly logger = new Logger(MarketplaceMetricsService.name);
  private readonly byStatus: Gauge;
  private readonly due: Gauge;
  private readonly dueCents: Gauge;
  private readonly oldestDue: Gauge;
  private readonly collectedAt: Gauge;
  private readonly payouts: Gauge;
  private readonly oldestUnknownPayout: Gauge;
  private readonly oldestPendingPayout: Gauge;
  private readonly missingPayoutPlans: Gauge;
  private readonly financialEvents: Gauge;
  private readonly oldestFinancialEvent: Gauge;
  private readonly errors: Counter;
  private readonly fundingPlans: Gauge;
  private readonly fundingAge: Gauge;
  private readonly terminalCancellations: Gauge;
  private readonly unsubmittedCancellations: Gauge;
  private readonly heldForReconciliation: Gauge;
  private readonly closedOrderDisputes: Gauge;
  private readonly stockHolds: Gauge;
  private readonly overdueStockAge: Gauge;
  private readonly refundPlans: Gauge;
  private readonly refundOperations: Gauge;
  private readonly oldestUnresolvedRefund: Gauge;
  private readonly residualPlans: Gauge;
  private readonly recoveryOperations: Gauge;
  private readonly recoveryAge: Gauge;
  private readonly carrierRefundUnproven: Gauge;
  private readonly carrierRefundUnprovenAge: Gauge;
  private readonly recoveredTransfers: Gauge;
  private readonly recoveredPrincipal: Gauge;
  private readonly partialRecoveryCredits: Gauge;
  private readonly partialRecoveryPrincipal: Gauge;
  private readonly outstandingDebtPrincipal: Gauge;
  private readonly outstandingDebts: Gauge;
  private readonly oldestOutstandingDebt: Gauge;
  private readonly principalExtinctions: Gauge;
  private readonly extinguishedPrincipal: Gauge;
  private readonly unprovenExtinctions: Gauge;
  private pending?: Promise<void>;

  constructor(private readonly prisma: PrismaClient, metrics: MetricsService) {
    const registers = [metrics.registry];
    const collect = () => this.refresh();
    this.byStatus = new Gauge({ name: "marketplace_settlements", help: "Persisted marketplace settlements by lifecycle status", labelNames: ["status"], registers,
      collect });
    this.due = new Gauge({ name: "marketplace_due_transfers", help: "Scheduled marketplace transfers past their due date", registers, collect });
    this.dueCents = new Gauge({ name: "marketplace_due_transfer_amount_cents", help: "Seller amount in overdue marketplace transfers in BRL cents", registers, collect });
    this.oldestDue = new Gauge({ name: "marketplace_oldest_due_transfer_seconds", help: "Age of the oldest overdue marketplace transfer", registers, collect });
    this.collectedAt = new Gauge({ name: "marketplace_metrics_collected_timestamp_seconds", help: "Last successful collection of marketplace ledger metrics", registers, collect });
    this.payouts = new Gauge({ name: "marketplace_payout_operations", help: "Durable marketplace payout operations by bounded lifecycle status", labelNames: ["status"], registers, collect });
    this.oldestUnknownPayout = new Gauge({ name: "marketplace_oldest_unknown_payout_seconds", help: "Age since first attempt of the oldest payout with unknown outcome", registers, collect });
    this.oldestPendingPayout = new Gauge({ name: "marketplace_oldest_pending_payout_seconds", help: "Age since first submission of a payout still pending at the provider; reconciliation does not reset this age", registers, collect });
    this.missingPayoutPlans = new Gauge({ name: "marketplace_due_payouts_without_plan", help: "Due settlements missing their immutable payment and destination binding", registers, collect });
    this.financialEvents = new Gauge({ name: "marketplace_financial_event_delivery", help: "Outbox delivery states for sale, payment and inventory integration events", labelNames: ["event_type", "status"], registers, collect });
    this.oldestFinancialEvent = new Gauge({ name: "marketplace_oldest_pending_financial_event_seconds", help: "Age of the oldest undelivered sale, payment or inventory integration event", registers, collect });
    this.errors = new Counter({ name: "marketplace_metrics_collection_errors_total", help: "Failed marketplace ledger metric collections", registers });
    this.fundingPlans = new Gauge({ name: "marketplace_funding_plans", help: "Immutable capture budgets by bounded funding status", labelNames: ["status"], registers, collect });
    this.fundingAge = new Gauge({ name: "marketplace_oldest_unfunded_payment_seconds", help: "Age of an approved payment still awaiting verified capture allocation", registers, collect });
    this.terminalCancellations = new Gauge({ name: "marketplace_terminal_cancellations", help: "Held plans with durable terminal uncaptured cancellation proof and fully released stock", registers, collect });
    this.unsubmittedCancellations = new Gauge({ name: "marketplace_unsubmitted_cancellations", help: "Held plans with durable local cancellation proof before any provider submission and released stock", registers, collect });
    this.heldForReconciliation = new Gauge({ name: "marketplace_held_funding_requiring_reconciliation", help: "Held plans requiring reconciliation; excludes certified cancellations, completed residuals and independently certified terminal order disputes", registers, collect });
    this.closedOrderDisputes = new Gauge({ name: "marketplace_certified_order_dispute_closures", help: "Held original plans with independently valid terminal order dispute certificates; original payouts remain blocked", registers, collect });
    this.collectedAt.set(0);
    this.stockHolds = new Gauge({ name: "marketplace_payment_stock_holds", help: "Active stock reservations bound to an immutable marketplace payment", registers, collect });
    this.overdueStockAge = new Gauge({ name: "marketplace_oldest_payment_stock_hold_overdue_seconds", help: "Age beyond the cart expiry of the oldest payment-bound stock reservation", registers, collect });
    this.refundPlans = new Gauge({ name: "marketplace_refund_plans", help: "Durable refund allocation plans by bounded lifecycle status", labelNames: ["status"], registers, collect });
    this.refundOperations = new Gauge({ name: "marketplace_refund_operations", help: "Refund provider journals by bounded lifecycle status", labelNames: ["status"], registers, collect });
    this.oldestUnresolvedRefund = new Gauge({ name: "marketplace_oldest_unresolved_refund_seconds", help: "Age since the original claim of a refund with pending or unknown outcome", registers, collect });
    this.residualPlans = new Gauge({ name: "marketplace_residual_plans", help: "Residual obligations after verified refunds, by bounded status", labelNames: ["status"], registers, collect });
    this.recoveryOperations = new Gauge({ name: "marketplace_recovery_operations", help: "Durable residual transfer, reversal, cancellation and shipment operations by bounded kind and status", labelNames: ["kind", "status"], registers, collect });
    this.recoveryAge = new Gauge({ name: "marketplace_oldest_unresolved_recovery_seconds", help: "Age since first claim of an uncertain recovery operation, unchanged by reconciliation", labelNames: ["kind"], registers, collect });
    this.carrierRefundUnproven = new Gauge({ name: "marketplace_carrier_refunds_unproven", help: "Canceled purchased labels without independently proven carrier wallet refund", registers, collect });
    this.carrierRefundUnprovenAge = new Gauge({ name: "marketplace_oldest_unproven_carrier_refund_seconds", help: "Age since persisted label cancellation without independently proven wallet refund", registers, collect });
    this.recoveredTransfers = new Gauge({ name: "marketplace_certified_transfer_recoveries", help: "Persisted certificates of fully recovered transfer principal, not resolved disputes", labelNames: ["kind"], registers, collect });
    this.recoveredPrincipal = new Gauge({ name: "marketplace_certified_recovery_principal_cents", help: "Transfer principal certified for dispute recovery in BRL cents; excludes processing and dispute fees", labelNames: ["kind"], registers, collect });
    this.partialRecoveryCredits = new Gauge({ name: "marketplace_partial_transfer_recovery_credits", help: "Immutable unspent reversal credits on targets without a full recovery certificate", labelNames: ["kind"], registers, collect });
    this.partialRecoveryPrincipal = new Gauge({ name: "marketplace_partial_recovery_principal_cents", help: "Unspent principal credited to disputed transfers without a full certificate; never includes buyer refunds or provider fees", labelNames: ["kind"], registers, collect });
    this.outstandingDebtPrincipal = new Gauge({ name: "marketplace_outstanding_debt_principal_cents", help: "Original outstanding debt principal less separately proven recovery credits; excludes unquantified dispute fees", labelNames: ["kind"], registers, collect });
    this.outstandingDebts = new Gauge({ name: "marketplace_outstanding_debts", help: "Outstanding principal obligations by seller or host; partial recovery does not resolve the obligation", labelNames: ["kind"], registers, collect });
    this.oldestOutstandingDebt = new Gauge({ name: "marketplace_oldest_outstanding_debt_seconds", help: "Age since original creation of an outstanding principal obligation; partial recovery does not reset the age", labelNames: ["kind"], registers, collect });
    this.principalExtinctions = new Gauge({name:"marketplace_certified_debt_principal_extinctions",help:"Persisted native principal extinction certificates; not seller recoveries or fee collections",registers,collect});
    this.extinguishedPrincipal = new Gauge({name:"marketplace_extinguished_debt_principal_cents",help:"Seller principal extinguished by historically certified native reinstatement in BRL cents; never recovered funds",registers,collect});
    this.unprovenExtinctions = new Gauge({name:"marketplace_unproven_debt_principal_extinctions",help:"Extinguished debts or certificates with missing or inconsistent immutable principal evidence",registers,collect});
  }

  refresh(): Promise<void> {
    if (!this.pending) this.pending = this.collect().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async collect(): Promise<void> {
    try {
      const now = new Date();
      const originalPayout = { OR: [{ fundingPlanId: null }, { fundingPlan: { is: { residualPlans: { none: {} } } } }] };
      const eventTypes = ["order.completed", "order.delivered", "payment.status.changed", "inventory.sale.erp_sync_requested",
        "inventory.sale.crm_sync_requested", "inventory.sale.webhook_requested", ...MARKETPLACE_OPERATIONAL_EVENT_TYPES];
      const [groups, overdue, payouts, unknown, missingPlans, events, oldestEvent, fundingPlans, unfunded, hostDue, sellerDue, unplannedDue, stockHolds, pendingPayouts, heldDisposition, refundPlans, refundOperations, unresolvedRefund,
        residualPlans, residualOperations, reversals, shipments, residualAge, reversalAge, shipmentCartAge, residualDue,
        cancellations, cancellationAge, shipmentPurchaseAge, shipmentGenerationAge, shipmentCancellations, shipmentCancellationAge, carrierRefundAge,
        originalRecoveries, residualRecoveries, partialRecovery, principalExtinctions] = await Promise.all([
        this.prisma.marketplaceSettlement.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceSettlement.aggregate({ where: { status: "transfer_scheduled", transferScheduledAt: { lte: now },
          OR: [{ payout: { is: null } }, { payout: { is: originalPayout } }] },
          _count: { _all: true }, _sum: { sellerNetCents: true }, _min: { transferScheduledAt: true } }),
        this.prisma.marketplacePayout.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplacePayout.aggregate({ where: { status: "unknown" }, _min: { claimedAt: true } }),
        this.prisma.marketplaceSettlement.count({ where: { status: "transfer_scheduled", transferScheduledAt: { lte: now }, payout: { is: null } } }),
        this.prisma.outboxMessage.groupBy({ by: ["eventType", "status"], where: { eventType: { in: eventTypes } }, _count: { _all: true } }),
        this.prisma.outboxMessage.aggregate({ where: { eventType: { in: eventTypes }, status: { in: ["pending", "processing"] } }, _min: { createdAt: true } }),
        this.prisma.marketplaceFundingPlan.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceFundingPlan.aggregate({ where: { status: "awaiting_capture", payment: { status: "approved" } }, _min: { createdAt: true } }),
        this.prisma.marketplacePayout.aggregate({ where: { ...originalPayout, kind: "host_receivable", status: "planned", dueAt: { lte: now } },
          _count: { _all: true }, _sum: { amountCents: true }, _min: { dueAt: true } }),
        this.prisma.marketplacePayout.aggregate({ where: { ...originalPayout, kind: "seller_settlement", settlement: { is: {
          status: "transfer_scheduled", transferScheduledAt: { lte: now } } } }, _sum: { amountCents: true } }),
        this.prisma.marketplaceSettlement.aggregate({ where: { status: "transfer_scheduled", transferScheduledAt: { lte: now }, payout: { is: null } },
          _sum: { sellerNetCents: true } }),
        this.prisma.stockReservation.aggregate({ where: { status: "ACTIVE", marketplaceFundingPlanId: { not: null } },
          _count: { _all: true }, _min: { expiresAt: true } }),
        this.prisma.marketplacePayout.aggregate({ where: { status: "pending" }, _min: { claimedAt: true } }),
        this.heldDisposition(),
        this.prisma.marketplaceRefundPlan.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceRefundOperation.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceRefundOperation.aggregate({ where: { status: { in: ["unknown", "pending"] } }, _min: { claimedAt: true } }),
        this.prisma.marketplaceResidualPlan.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceResidualOperation.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceTransferReversal.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceShipmentJournal.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceResidualOperation.aggregate({ where: { status: { in: ["unknown", "pending"] } }, _min: { claimedAt: true } }),
        this.prisma.marketplaceTransferReversal.aggregate({ where: { status: { in: ["unknown", "pending"] } }, _min: { claimedAt: true } }),
        this.prisma.marketplaceShipmentJournal.aggregate({ where: { status: "cart_unknown" }, _min: { claimedAt: true } }),
        this.prisma.$queryRaw<Array<{ count: number; amount: number; due: Date | null }>>`
          SELECT count(*)::int AS count, COALESCE(sum(o.amount_cents),0)::float8 AS amount, min(r.due_at) AS due
          FROM marketplace_residual_operations o JOIN marketplace_residual_plans r ON r.id=o.residual_plan_id
          WHERE o.status='planned' AND r.status='prepared' AND r.due_at<=${now}`,
        this.prisma.marketplaceCancellationOperation.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.marketplaceCancellationOperation.aggregate({ where: { status: "unknown" }, _min: { claimedAt: true } }),
        this.prisma.marketplaceShipmentJournal.aggregate({ where: { status: "purchase_unknown" }, _min: { purchaseClaimedAt: true } }),
        this.prisma.marketplaceShipmentJournal.aggregate({ where: { status: "generate_unknown" }, _min: { generationClaimedAt: true } }),
        this.prisma.marketplaceShipmentJournal.groupBy({ by: ["cancellationStatus"], where: { cancellationStatus: { not: null } }, _count: { _all: true } }),
        this.prisma.marketplaceShipmentJournal.aggregate({ where: { cancellationStatus: "unknown" }, _min: { cancellationClaimedAt: true } }),
        this.prisma.marketplaceShipmentJournal.aggregate({ where: { cancellationStatus: "canceled" }, _min: { canceledAt: true } }),
        this.prisma.marketplaceTransferRecovery.aggregate({ where: { payoutId: { not: null } }, _count: { _all: true }, _sum: { amountCents: true } }),
        this.prisma.marketplaceTransferRecovery.aggregate({ where: { residualOperationId: { not: null } }, _count: { _all: true }, _sum: { amountCents: true } }),
        this.prisma.$queryRaw<Array<{ kind: string; count: number; amount: number; oldest: Date | null }>>`
          WITH partial_recovery AS (
            SELECT c.* FROM marketplace_transfer_recovery_credits c
            WHERE NOT EXISTS (SELECT 1 FROM marketplace_transfer_recoveries r
              WHERE r.payout_id=c.payout_id OR r.residual_operation_id=c.residual_operation_id)
          ), credits AS (
            SELECT payout_id, beneficiary_merchant_id, sum(amount_cents) AS amount FROM partial_recovery GROUP BY payout_id,beneficiary_merchant_id
          )
          SELECT CASE WHEN payout_id IS NULL THEN 'residual' ELSE 'original' END AS kind, count(*)::int AS count,
            COALESCE(sum(amount_cents),0)::float8 AS amount, NULL::timestamp AS oldest FROM partial_recovery GROUP BY (payout_id IS NULL)
          UNION ALL
          SELECT 'seller', count(*)::int, COALESCE(sum(GREATEST(0,d.amount_cents-COALESCE(c.amount,0))),0)::float8, min(d.created_at)
            FROM marketplace_seller_debts d LEFT JOIN marketplace_payouts p ON p.settlement_id=d.settlement_id
            LEFT JOIN credits c ON c.payout_id=p.id AND c.beneficiary_merchant_id=d.seller_merchant_id
            WHERE d.status='outstanding'
          UNION ALL
          SELECT 'host', count(*)::int, COALESCE(sum(GREATEST(0,d.amount_cents-COALESCE(c.amount,0))),0)::float8, min(d.created_at)
            FROM marketplace_host_debts d LEFT JOIN credits c ON c.payout_id=d.payout_id AND c.beneficiary_merchant_id=d.host_merchant_id
            WHERE d.status='outstanding'`,
        auditMarketplaceDebtPrincipalExtinctions(this.prisma),
      ]);
      this.principalExtinctions.set(principalExtinctions.valid.size);
      this.extinguishedPrincipal.set([...principalExtinctions.valid.values()].reduce((sum,row)=>sum+row.amountCents,0));
      this.unprovenExtinctions.set(principalExtinctions.findings.length);
      const statuses = ["awaiting_return_window", "transfer_scheduled", "transferred", "finalized", "return_cancelled", "chargeback_cancelled", "chargeback_debt"];
      for (const kind of ["original", "residual"]) {
        const value = partialRecovery.find(row => row.kind === kind);
        this.partialRecoveryCredits.set({ kind }, value?.count ?? 0);
        this.partialRecoveryPrincipal.set({ kind }, value?.amount ?? 0);
      }
      for (const kind of ["seller", "host"]) {
        const debt = partialRecovery.find(row => row.kind === kind);
        this.outstandingDebtPrincipal.set({ kind }, debt?.amount ?? 0);
        this.outstandingDebts.set({ kind }, debt?.count ?? 0);
        this.oldestOutstandingDebt.set({ kind }, debt?.oldest ? Math.max(0, (now.getTime() - debt.oldest.getTime()) / 1000) : 0);
      }
      this.byStatus.reset();
      for (const status of statuses) this.byStatus.set({ status }, groups.find((g) => g.status === status)?._count._all ?? 0);
      this.due.set(overdue._count._all + hostDue._count._all + residualDue[0]!.count);
      this.dueCents.set((sellerDue._sum.amountCents ?? 0) + (unplannedDue._sum.sellerNetCents ?? 0) + (hostDue._sum.amountCents ?? 0) + residualDue[0]!.amount);
      const dueDates = [overdue._min.transferScheduledAt, hostDue._min.dueAt, residualDue[0]!.due].filter((date): date is Date => Boolean(date));
      this.oldestDue.set(dueDates.length ? Math.max(0, ...dueDates.map(date => (now.getTime() - date.getTime()) / 1000)) : 0);
      this.fundingPlans.reset();
      for (const status of ["awaiting_capture", "funded", "held"]) this.fundingPlans.set({ status }, fundingPlans.find(row => row.status === status)?._count._all ?? 0);
      this.fundingAge.set(unfunded._min.createdAt ? Math.max(0, (now.getTime() - unfunded._min.createdAt.getTime()) / 1000) : 0);
      this.terminalCancellations.set(heldDisposition.cancelled);
      this.unsubmittedCancellations.set(heldDisposition.unsubmitted);
      this.heldForReconciliation.set(heldDisposition.unresolved);
      this.closedOrderDisputes.set(heldDisposition.dispute_closed);
      this.payouts.reset();
      for (const status of ["planned", "unknown", "pending", "confirmed", "failed", "cancelled"]) {
        this.payouts.set({ status }, payouts.find(p => p.status === status)?._count._all ?? 0);
      }
      this.oldestUnknownPayout.set(unknown._min.claimedAt ? Math.max(0, (now.getTime() - unknown._min.claimedAt.getTime()) / 1000) : 0);
      this.oldestPendingPayout.set(pendingPayouts._min.claimedAt ? Math.max(0, (now.getTime() - pendingPayouts._min.claimedAt.getTime()) / 1000) : 0);
      this.missingPayoutPlans.set(missingPlans);
      this.financialEvents.reset();
      for (const eventType of eventTypes) for (const status of ["pending", "processing", "delivered", "dead", "failed"]) {
        this.financialEvents.set({ event_type: eventType, status }, events.find(event => event.eventType === eventType && event.status === status)?._count._all ?? 0);
      }
      this.oldestFinancialEvent.set(oldestEvent._min.createdAt ? Math.max(0, (now.getTime() - oldestEvent._min.createdAt.getTime()) / 1000) : 0);
      this.collectedAt.set(now.getTime() / 1000);
      this.stockHolds.set(stockHolds._count._all);
      this.overdueStockAge.set(stockHolds._min.expiresAt ? Math.max(0, (now.getTime() - stockHolds._min.expiresAt.getTime()) / 1000) : 0);
      this.refundPlans.reset();
      for (const status of ["prepared", "blocked", "submitted", "confirmed", "failed"]) this.refundPlans.set({ status }, refundPlans.find(row => row.status === status)?._count._all ?? 0);
      this.refundOperations.reset();
      for (const status of ["planned", "unknown", "pending", "confirmed", "failed"]) this.refundOperations.set({ status }, refundOperations.find(row => row.status === status)?._count._all ?? 0);
      this.oldestUnresolvedRefund.set(unresolvedRefund._min.claimedAt ? Math.max(0, (now.getTime() - unresolvedRefund._min.claimedAt.getTime()) / 1000) : 0);
      this.residualPlans.reset();
      for (const status of ["prepared", "completed", "held"]) this.residualPlans.set({ status }, residualPlans.find(row => row.status === status)?._count._all ?? 0);
      this.recoveryOperations.reset();
      for (const [kind, rows, statuses] of [
      ["cancellation", cancellations, ["planned", "unknown", "confirmed", "blocked"]],
        ["residual", residualOperations, ["planned", "unknown", "pending", "confirmed", "failed", "cancelled"]],
        ["reversal", reversals, ["planned", "unknown", "pending", "confirmed", "failed"]],
        ["shipment", shipments, ["prepared", "cart_unknown", "cart_created", "purchase_unknown", "purchased", "generate_unknown", "generated", "blocked"]],
      ] as const) for (const status of statuses) this.recoveryOperations.set({ kind, status }, rows.find(row => row.status === status)?._count._all ?? 0);
      for (const status of ["unknown", "canceled"]) this.recoveryOperations.set({ kind: "shipment_cancellation", status },
        shipmentCancellations.find(row => row.cancellationStatus === status)?._count._all ?? 0);
      this.carrierRefundUnproven.set(shipmentCancellations.find(row => row.cancellationStatus === "canceled")?._count._all ?? 0);
      for (const [kind, row] of [["original", originalRecoveries], ["residual", residualRecoveries]] as const) {
        this.recoveredTransfers.set({ kind }, row._count._all);
        this.recoveredPrincipal.set({ kind }, row._sum.amountCents ?? 0);
      }
      this.carrierRefundUnprovenAge.set(carrierRefundAge._min.canceledAt ? Math.max(0, (now.getTime() - carrierRefundAge._min.canceledAt.getTime()) / 1000) : 0);
      this.recoveryAge.set({ kind: "shipment_cancellation" }, shipmentCancellationAge._min.cancellationClaimedAt ?
        Math.max(0, (now.getTime() - shipmentCancellationAge._min.cancellationClaimedAt.getTime()) / 1000) : 0);
      for (const [kind, row] of [["residual", residualAge], ["reversal", reversalAge], ["cancellation", cancellationAge]] as const) {
        this.recoveryAge.set({ kind }, row._min.claimedAt ? Math.max(0, (now.getTime() - row._min.claimedAt.getTime()) / 1000) : 0);
      }
      const shipmentClaims = [shipmentCartAge._min.claimedAt, shipmentPurchaseAge._min.purchaseClaimedAt, shipmentGenerationAge._min.generationClaimedAt]
        .filter((date): date is Date => Boolean(date));
      this.recoveryAge.set({ kind: "shipment" }, shipmentClaims.length ? Math.max(0, ...shipmentClaims.map(date => (now.getTime() - date.getTime()) / 1000)) : 0);
    } catch {
      this.errors.inc();
      this.logger.error({ event: "marketplace_metrics_collection_failed" });
      // Keep the previous gauges and timestamp; a failed query is never a healthy zero.
    }
  }

  private async heldDisposition(): Promise<{ cancelled: number; unsubmitted: number; unresolved: number; dispute_closed: number }> {
    // Read each disposition in one database snapshot. Only a matching native
    // certificate and immutable event can silence its operational hold.
    const [row] = await this.prisma.$queryRaw<Array<{ cancelled: number; unsubmitted: number; unresolved: number; dispute_closed: number }>>`
      SELECT count(*) FILTER (WHERE terminal IS TRUE)::int AS cancelled,
        count(*) FILTER (WHERE local_cancelled IS TRUE)::int AS unsubmitted,
        count(*) FILTER (WHERE terminal IS NOT TRUE AND local_cancelled IS NOT TRUE AND residual_complete IS NOT TRUE AND order_dispute_closed IS NOT TRUE)::int AS unresolved,
        count(*) FILTER (WHERE order_dispute_closed IS TRUE)::int AS dispute_closed
      FROM (
        SELECT marketplace_order_dispute_closure_valid(f.payment_intent_id) AS order_dispute_closed,
          p.status = 'cancelled' AND p.provider_payment_id IS NULL AND f.provider_payment_id IS NULL
          AND p.merchant_id = f.host_merchant_id AND p.amount_cents = f.amount_cents AND p.currency = 'BRL'
          AND p.approved_amount_cents IS NULL AND p.creation->>'state' = 'ready' AND p.version > 0
          AND NOT (p.creation ?| ARRAY['firstAttemptAt','leaseToken','leaseUntil','reason'])
          AND p.commerce_order_id IS NULL AND p.accepted_offer_id IS NULL AND (p.buyer_facing IS NULL OR p.buyer_facing = '{}'::jsonb)
          AND jsonb_typeof(p.status_history) = 'array'
          AND jsonb_array_length(CASE WHEN jsonb_typeof(p.status_history) = 'array' THEN p.status_history ELSE '[]'::jsonb END) > 1
          AND p.status_history->-1->>'status' = 'cancelled'
          AND p.status_history->-1->>'reason' = ${MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON}
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.status_history) = 'array' THEN p.status_history ELSE '[]'::jsonb END) WITH ORDINALITY h(value,position)
            WHERE position < jsonb_array_length(p.status_history) AND (value->>'status') IS DISTINCT FROM 'pending')
          AND f.budget IS NULL AND f.funded_at IS NULL AND f.provider_fee_cents IS NULL AND f.net_amount_cents IS NULL
          AND f.platform_retained_cents IS NULL AND f.payout_total_cents IS NULL
          AND p.creation#>'{input,marketplaceFunding}' = f.instructions
          AND f.instructions_hash = encode(sha256(convert_to(marketplace_recovery_canonical(f.instructions), 'UTF8')), 'hex')
          AND p.creation#>>'{input,intentId}' = p.id AND p.creation#>>'{input,merchantId}' = p.merchant_id
          AND p.creation#>>'{input,sessionId}' = p.session_id AND p.creation#>>'{input,method}' = p.method
          AND p.creation#>>'{input,amountCents}' = p.amount_cents::text AND p.creation#>>'{input,currency}' = p.currency
          AND NOT EXISTS (SELECT 1 FROM marketplace_payouts j WHERE j.funding_plan_id = f.payment_intent_id)
          AND NOT EXISTS (SELECT 1 FROM marketplace_cancellation_operations j WHERE j.funding_plan_id = f.payment_intent_id)
          AND NOT EXISTS (SELECT 1 FROM marketplace_shipment_journals j WHERE j.funding_plan_id = f.payment_intent_id)
          AND NOT EXISTS (SELECT 1 FROM marketplace_refund_plans j WHERE j.funding_plan_id = f.payment_intent_id)
          AND NOT EXISTS (SELECT 1 FROM marketplace_residual_plans j WHERE j.funding_plan_id = f.payment_intent_id)
          AND NOT EXISTS (SELECT 1 FROM completed_orders o WHERE o.merchant_id = f.host_merchant_id AND o.session_id = p.session_id)
          AND NOT EXISTS (SELECT 1 FROM marketplace_order_ledgers l WHERE l.host_merchant_id = f.host_merchant_id AND l.checkout_session_id IN (p.session_id,f.checkout_session_id))
          AND NOT EXISTS (SELECT 1 FROM stock_reservations s WHERE s.marketplace_funding_plan_id = f.payment_intent_id AND s.status <> 'RELEASED')
          AND EXISTS (
            SELECT 1 FROM outbox_messages e CROSS JOIN LATERAL (SELECT e.payload->'marketplace_local_cancellation' AS proof) local
            WHERE e.event_id = 'marketplace_local_cancel_' || encode(sha256(convert_to(f.payment_intent_id, 'UTF8')), 'hex')
              AND e.event_type = 'payment.status.changed' AND e.producer = 'marketplace' AND e.schema_version = 1
              AND e.correlation_id = p.id AND e.causation_id = p.id
              AND e.merchant_id = f.host_merchant_id AND e.payload->>'reason' = ${MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON}
              AND e.payload->>'status' = 'cancelled' AND e.payload->>'payment_intent_id' = p.id
              AND e.payload->>'session_id' = p.session_id AND e.payload->>'amount_cents' = p.amount_cents::text
              AND e.payload->>'method' = p.method AND e.payload->'commerce_order_id' = 'null'::jsonb
              AND NOT (e.payload ? 'marketplace_cancellation')
              AND local.proof @> '{"version":1,"kind":"never_submitted","currency":"BRL"}'::jsonb
              AND local.proof->>'hostMerchantId' = f.host_merchant_id AND local.proof->>'paymentIntentId' = p.id
              AND local.proof->>'checkoutSessionId' = p.session_id AND local.proof->>'cartRef' = f.checkout_session_id
              AND local.proof->>'instructionsHash' = f.instructions_hash AND local.proof->>'amountCents' = f.amount_cents::text
              AND local.proof->>'provider' = f.provider AND local.proof->>'environment' = f.environment
              AND local.proof->>'accountFingerprint' = f.account_fingerprint
              AND local.proof->>'creationInputHash' = encode(sha256(convert_to(marketplace_recovery_canonical(p.creation->'input'), 'UTF8')), 'hex')
              AND local.proof->>'reservationsHash' = encode(sha256(convert_to(marketplace_recovery_canonical((
                SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'variantId',s.variant_id,'stockId',s.stock_id,'cartId',s.cart_id,'quantity',s.quantity) ORDER BY s.id COLLATE "C"),'[]'::jsonb)
                FROM stock_reservations s WHERE s.marketplace_funding_plan_id = f.payment_intent_id
              )), 'UTF8')), 'hex')
              AND local.proof->'paymentVersionBefore' = to_jsonb(p.version - 1)
              AND local.proof->>'reason' IN ('requested_by_customer','abandoned','duplicate','fraudulent')
              AND local.proof->>'cancelledAt' = p.status_history->-1->>'occurredAt'
              AND local.proof->>'cancelledAt' = to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) AS local_cancelled,
          p.status = 'cancelled' AND p.currency = 'BRL' AND p.amount_cents = f.amount_cents
          AND p.merchant_id = f.host_merchant_id AND COALESCE(p.approved_amount_cents, 0) = 0
          AND f.budget IS NULL AND f.funded_at IS NULL AND f.provider IN ('stripe','mercadopago')
          AND p.provider_payment_id = f.provider_payment_id
          AND NOT EXISTS (SELECT 1 FROM marketplace_payouts j WHERE j.funding_plan_id = f.payment_intent_id)
          AND NOT EXISTS (SELECT 1 FROM stock_reservations s WHERE s.marketplace_funding_plan_id = f.payment_intent_id AND s.status <> 'RELEASED')
          AND NOT EXISTS (SELECT 1 FROM marketplace_order_ledgers l WHERE l.host_merchant_id = f.host_merchant_id AND l.order_id = p.provider_payment_id)
          AND EXISTS (
            SELECT 1 FROM outbox_messages e
            WHERE e.event_id = 'marketplace_cancel_' || encode(sha256(convert_to(f.payment_intent_id, 'UTF8')), 'hex')
              AND e.event_type = 'payment.status.changed' AND e.producer = 'marketplace'
              AND e.merchant_id = f.host_merchant_id AND e.payload->>'reason' = ${MARKETPLACE_TERMINAL_CANCELLATION_REASON}
              AND e.payload->'marketplace_cancellation' @> '{"state":"terminal_uncaptured","amountReceivedCents":0,"amountCapturableCents":0,"currency":"BRL"}'::jsonb
              AND e.payload#>>'{marketplace_cancellation,provider}' = f.provider
              AND (f.provider='stripe' OR (
                e.payload#>>'{marketplace_cancellation,checkoutSessionId}' = f.checkout_session_id
                AND p.session_id = f.checkout_session_id
                AND e.payload#>'{marketplace_cancellation,mercadoPago}' @> '{"status":"cancelled","captured":false,"netReceivedAmountCents":0,"refundedAmountCents":0,"dateApproved":null}'::jsonb
                AND e.payload#>>'{marketplace_cancellation,mercadoPago,paymentId}' = p.provider_payment_id
                AND e.payload#>>'{marketplace_cancellation,mercadoPago,paymentId}' ~ '^[1-9][0-9]*$'
                AND e.payload#>>'{marketplace_cancellation,mercadoPago,collectorId}' ~ '^[1-9][0-9]*$'
                AND e.payload#>>'{marketplace_cancellation,mercadoPago,statusDetail}' IN ('by_collector','by_payer','expired')))
              AND e.payload#>>'{marketplace_cancellation,paymentIntentId}' = f.payment_intent_id
              AND e.payload#>>'{marketplace_cancellation,hostMerchantId}' = f.host_merchant_id
              AND e.payload#>>'{marketplace_cancellation,providerPaymentId}' = p.provider_payment_id
              AND e.payload#>>'{marketplace_cancellation,accountFingerprint}' = f.account_fingerprint
              AND e.payload#>>'{marketplace_cancellation,instructionsHash}' = f.instructions_hash
              AND e.payload#>>'{marketplace_cancellation,environment}' = f.environment
              AND e.payload#>>'{marketplace_cancellation,amountCents}' = f.amount_cents::text
          ) AS terminal,
          p.status IN ('approved','refunded') AND p.approved_amount_cents=f.amount_cents AND p.amount_cents=f.amount_cents
          AND p.currency='BRL' AND p.merchant_id=f.host_merchant_id
          AND NOT EXISTS(SELECT 1 FROM outbox_messages e WHERE e.merchant_id=f.host_merchant_id
            AND e.correlation_id=f.payment_intent_id AND e.event_type='marketplace.financial_reconciliation_required')
          AND NOT EXISTS(SELECT 1 FROM marketplace_order_ledgers l WHERE l.host_merchant_id=f.host_merchant_id AND l.order_id=f.provider_payment_id AND l.chargeback_at IS NOT NULL)
          AND EXISTS(SELECT 1 FROM marketplace_residual_plans r WHERE r.funding_plan_id=f.payment_intent_id AND r.host_merchant_id=f.host_merchant_id
            AND r.status='completed' AND r.held_reason IS NULL AND marketplace_residual_allocation_valid(r.allocation)
            AND NOT EXISTS(SELECT 1 FROM marketplace_residual_plans newer WHERE newer.funding_plan_id=f.payment_intent_id AND newer.generation>r.generation)
            AND (SELECT count(*) FROM marketplace_residual_plans earlier WHERE earlier.funding_plan_id=f.payment_intent_id AND earlier.generation<r.generation)=r.generation-1
            AND NOT EXISTS(SELECT 1 FROM marketplace_residual_plans earlier WHERE earlier.funding_plan_id=f.payment_intent_id AND earlier.generation<r.generation
              AND (earlier.status<>'completed' OR earlier.held_reason IS NOT NULL OR EXISTS(SELECT 1 FROM marketplace_residual_operations eo
                WHERE eo.residual_plan_id=earlier.id AND (eo.status<>'confirmed' OR eo.provider_transfer_id IS NULL))))
            AND r.basis->'version'=r.allocation->'version' AND (r.allocation->>'capturedNetCents')::numeric=f.net_amount_cents
            AND (p.status='approved' OR r.allocation->'version' IN ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
              AND (r.allocation->>'refundedCents')::numeric=p.amount_cents AND r.allocation->'payoutTotalCents'='0'::jsonb
              AND r.allocation->'platformRetainedCents'='0'::jsonb AND
                (r.allocation->'version' IN ('4'::jsonb,'5'::jsonb) OR r.allocation->'alreadyTransferredCents'='0'::jsonb))
            AND (r.allocation->'version'='1'::jsonb AND NOT EXISTS(SELECT 1 FROM marketplace_payouts o WHERE o.funding_plan_id=f.payment_intent_id
                AND (o.status<>'planned' OR o.provider_transfer_id IS NOT NULL OR o.claimed_at IS NOT NULL))
              OR r.allocation->'version' IN ('2'::jsonb,'3'::jsonb)
                AND NOT EXISTS(SELECT 1 FROM marketplace_payouts o WHERE o.funding_plan_id=f.payment_intent_id AND
                  (o.status NOT IN ('planned','confirmed') OR o.status='confirmed' AND o.provider_transfer_id IS NULL
                    OR o.status='planned' AND (o.provider_transfer_id IS NOT NULL OR o.claimed_at IS NOT NULL)))
                AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_reversals v JOIN marketplace_refund_plans j ON j.id=v.refund_plan_id
                  WHERE j.funding_plan_id=f.payment_intent_id AND (v.status<>'confirmed' OR v.provider_operation_id IS NULL))
                AND (SELECT COALESCE(sum(o.amount_cents),0) FROM marketplace_payouts o WHERE o.funding_plan_id=f.payment_intent_id AND o.status='confirmed')
                  +(SELECT COALESCE(sum(eo.amount_cents),0) FROM marketplace_residual_operations eo
                    JOIN marketplace_residual_plans earlier ON earlier.id=eo.residual_plan_id
                    WHERE earlier.funding_plan_id=f.payment_intent_id AND earlier.generation<r.generation AND eo.status='confirmed')
                  -(SELECT COALESCE(sum(v.amount_cents),0) FROM marketplace_transfer_reversals v JOIN marketplace_refund_plans j ON j.id=v.refund_plan_id
                    WHERE j.funding_plan_id=f.payment_intent_id AND v.status='confirmed')=(r.allocation->>'alreadyTransferredCents')::numeric
              OR r.allocation->'version'='4'::jsonb AND f.provider='stripe' AND marketplace_residual_source_evidence_valid(r.id) IS TRUE
              OR r.allocation->'version'='5'::jsonb AND f.provider='asaas' AND marketplace_asaas_residual_evidence_valid(r.id) IS TRUE
              OR r.allocation->'version'='6'::jsonb AND f.provider='stripe' AND marketplace_stripe_successive_residual_evidence_valid(r.id, false) IS TRUE
              OR r.allocation->'version'='7'::jsonb AND f.provider='asaas' AND marketplace_asaas_host_retention_evidence_valid(r.id) IS TRUE)
            AND NOT EXISTS(SELECT 1 FROM marketplace_residual_operations o WHERE o.residual_plan_id=r.id AND (o.status<>'confirmed' OR o.provider_transfer_id IS NULL))
            AND NOT EXISTS(SELECT 1 FROM marketplace_refund_plans j WHERE j.funding_plan_id=f.payment_intent_id AND
              (j.status<>'confirmed' OR NOT EXISTS(SELECT 1 FROM marketplace_refund_operations u WHERE u.refund_plan_id=j.id AND u.status='confirmed' AND u.provider_operation_id IS NOT NULL)))
            AND (SELECT COALESCE(sum(o.amount_cents),0) FROM marketplace_residual_operations o WHERE o.residual_plan_id=r.id)=
              (CASE WHEN r.allocation->'version'='7'::jsonb THEN r.allocation->>'outboundPayoutCents' ELSE r.allocation->>'payoutTotalCents' END)::numeric
            AND (SELECT COALESCE(sum(j.amount_cents),0) FROM marketplace_refund_plans j WHERE j.funding_plan_id=f.payment_intent_id AND j.status='confirmed')=(r.allocation->>'refundedCents')::numeric)
          AND NOT EXISTS(SELECT 1 FROM returns t WHERE t.merchant_id=f.host_merchant_id AND
            (t.order_id=f.provider_payment_id OR t.order_id=p.commerce_order_id OR EXISTS(SELECT 1 FROM completed_orders c
              WHERE c.merchant_id=f.host_merchant_id AND (c.external_order_id IN(f.provider_payment_id,p.commerce_order_id) OR c.session_id=p.session_id)
                AND t.order_id IN(c.id,c.external_order_id)))
            AND (t.status NOT IN ('REFUND_COMPLETED','REJECTED','CANCELLED') OR EXISTS(SELECT 1 FROM return_refunds rf WHERE rf.return_id=t.id AND rf.status<>'COMPLETED')))
          AND NOT EXISTS(SELECT 1 FROM marketplace_contribution_excess_liabilities excess
            WHERE excess.funding_plan_id=f.payment_intent_id AND excess.status<>'returned')
          AND NOT EXISTS(SELECT 1 FROM marketplace_seller_debts debt JOIN marketplace_payouts debt_payout ON debt_payout.settlement_id=debt.settlement_id
            WHERE debt_payout.funding_plan_id=f.payment_intent_id AND debt.status='outstanding')
          AND NOT EXISTS(SELECT 1 FROM marketplace_host_debts debt JOIN marketplace_payouts debt_payout ON debt_payout.id=debt.payout_id
            WHERE debt_payout.funding_plan_id=f.payment_intent_id AND debt.status='outstanding') AS residual_complete
        FROM marketplace_funding_plans f JOIN payment_intents p ON p.id = f.payment_intent_id
        WHERE f.status = 'held'
      ) plans`;
    if (!row || [row.cancelled, row.unsubmitted, row.unresolved, row.dispute_closed].some(value => !Number.isSafeInteger(value) || value < 0)) {
      throw Error("marketplace_held_disposition_snapshot_invalid");
    }
    return row;
  }
}
