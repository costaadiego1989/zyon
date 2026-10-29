import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { buildMarketplaceFundingBudget, type FrozenMarketplaceFunding } from "../domain/services/marketplace-funding-budget.js";
import { fundingHash, fundingTransferAllocations, type FundingBudget } from "./repositories/prisma-marketplace-funding.repository.js";
import { inventorySaleFingerprint, inventorySaleId, validateInventorySale } from "../../inventory/domain/events/inventory-sale.validation.js";
import type { SaleCompletedEvent } from "../../inventory/domain/events/sale-completed.event.js";
import { buildMarketplaceResidualAllocation, buildMarketplaceResidualAfterReversalAllocation, buildMarketplaceResidualAfterGenerationAllocation,
  type MarketplaceResidualBasis } from "../domain/services/marketplace-residual-allocation.js";
import type { MarketplaceRefundAllocation } from "../domain/services/marketplace-refund-allocation.js";
import { assertMarketplaceShipmentPurchaseReceipt, assertMarketplaceShipmentGenerationReceipt, assertMarketplaceShipmentCancellationReceipt,
  assertMarketplaceShipmentOriginRequests, type MarketplaceShipmentRecord,
  type MarketplaceShipmentRequest, type MarketplaceShipmentPurchaseReceipt, type MarketplaceShipmentGenerationReceipt,
  type MarketplaceShipmentCancellationReceipt } from "../../shipping/domain/marketplace-shipment-journal.js";
import { marketplaceShippingContractHash } from "../../shipping/domain/marketplace-shipping-contract.js";
import type { MarketplaceCancellationExecutionRequest } from "../domain/ports/marketplace-cancellation-execution.port.js";
import { MARKETPLACE_TERMINAL_CANCELLATION_REASON, type MarketplaceCancellationEvidence } from "../domain/ports/marketplace-cancellation.port.js";
import type { MarketplaceRefundRequest } from "../domain/ports/marketplace-refund-provider.port.js";
import { auditMarketplaceTransferRecoveries } from "./marketplace-transfer-recovery-audit.js";
import { auditMarketplaceDebtPrincipalExtinctions } from "./marketplace-debt-principal-extinction-audit.js";
import { assertMarketplaceUncapturedAllocation, type UncapturedMarketplaceFunding } from "../domain/services/marketplace-cancellation-allocation.js";
import { readMarketplaceUnsubmittedCancellationStatus } from "./repositories/prisma-marketplace-unsubmitted-cancellation.repository.js";
import { auditMarketplaceRefundFundingJournals, assertAuditedMarketplaceRefundFunding } from "./marketplace-refund-funding-audit.js";
import { readMarketplaceResidualContributionBasis } from "./repositories/marketplace-residual-contribution-basis.js";
import { buildMarketplaceResidualContributionAllocation } from "../domain/services/marketplace-residual-sources.js";
import { buildMarketplaceResidualRequest } from "./repositories/marketplace-residual-history.js";
import { buildAsaasMarketplaceResidualAllocation, buildAsaasMarketplaceResidualRequest } from "../domain/services/asaas-marketplace-residual.js";
import { readCertifiedAsaasMarketplaceWalletReturns } from "./repositories/prisma-asaas-marketplace-wallet-return.repository.js";
import { asaasResidualSubmissionEventId } from "./repositories/prisma-asaas-marketplace-residual-authorization.repository.js";
import { validAsaasResidualTransferProof } from "../domain/services/asaas-marketplace-residual.js";
import { readStripeMarketplaceSourceRefundContext } from "./repositories/stripe-marketplace-source-refund-history.js";
import { buildStripeMarketplaceSuccessiveResidualAllocation, buildStripeMarketplaceSuccessiveResidualRequest } from "../domain/services/stripe-marketplace-successive-residual.js";
import { buildAsaasMarketplaceHostRetentionAllocation, buildAsaasMarketplaceHostRetentionRequest,
  buildAsaasMarketplaceHostRetentionOutboundRequest, validAsaasMarketplaceHostRetentionRequest,
  validAsaasMarketplaceHostRetentionProof, validAsaasHostRetentionOutboundProof, asaasHostRetentionJournalId } from "../domain/services/asaas-marketplace-host-retention.js";
import type { AsaasMarketplaceHostRetentionRequest, AsaasMarketplaceHostRetentionProof } from "../domain/ports/asaas-marketplace-host-retention.port.js";
import { readCertifiedAsaasMarketplaceResidualWalletReturns, validateAsaasResidualWalletReturnJournal,
  type AsaasResidualWalletReturnJournal, type CertifiedAsaasResidualWalletReturn } from "./repositories/prisma-asaas-marketplace-residual-wallet-return.repository.js";
import type { MarketplaceHostPrincipalExtinctionEvidence, MarketplaceOrderDisputeClosureEvidence } from "../domain/ports/marketplace-order-dispute-closure.port.js";
import { marketplaceHostPrincipalExtinctionId, marketplaceHostPrincipalExtinctionPayload,
  marketplaceOrderDisputeClosureId, marketplaceOrderDisputeClosurePayload } from "../domain/services/marketplace-order-dispute-closure.js";
import type { MarketplaceHostDisputeObligationEvidence } from "../domain/ports/marketplace-host-fee-collection.port.js";
import { marketplaceHostDisputeObligationId, marketplaceHostDisputeObligationPayload } from "../domain/services/marketplace-host-fee-collection.js";

export interface MarketplaceAuditFinding { code: string; reference?: string }
interface Candidate { key: string; payment_id: string | null; order_id: string | null }

/** Read native-backed terminal certificates without changing historical holds.
 * A host principal certificate alone does not close a won order or its fees. */
export async function auditMarketplaceOrderDisputeClosureCertificates(tx: Prisma.TransactionClient, host: string, fundingPlanId: string) {
  type Row<E> = { id: string; payout_id?: string; amount_cents?: number; host_merchant_id: string; funding_plan_id: string;
    provider_dispute_id: string; closure_snapshot_id: string; evidence: E; evidence_hash: string; expected_evidence: E | null; valid: boolean };
  const findings: MarketplaceAuditFinding[] = [], hostPrincipals = new Map<string, MarketplaceHostPrincipalExtinctionEvidence>();
  const hostObligations = new Map<string, { id: string; evidenceHash: string; evidence: MarketplaceHostDisputeObligationEvidence }>();
  const add = (code: string, reference: string) => findings.push({ code, reference });
  const hostRows = await tx.$queryRaw<Array<Row<MarketplaceHostPrincipalExtinctionEvidence>>>`SELECT c.*,
    marketplace_host_principal_extinction_valid(c.payout_id) AS valid,
    marketplace_host_principal_extinction_evidence(c.payout_id) AS expected_evidence
    FROM marketplace_host_principal_extinctions c WHERE c.funding_plan_id=${fundingPlanId} ORDER BY c.id LIMIT 2`;
  const orderRows = await tx.$queryRaw<Array<Row<MarketplaceOrderDisputeClosureEvidence>>>`SELECT c.*,
    marketplace_order_dispute_closure_valid(c.funding_plan_id) AS valid,
    marketplace_order_dispute_closure_evidence(c.funding_plan_id) AS expected_evidence
    FROM marketplace_order_dispute_closures c WHERE c.funding_plan_id=${fundingPlanId} ORDER BY c.id LIMIT 2`;
  const hostObligationRows = await tx.$queryRaw<Array<Row<MarketplaceHostDisputeObligationEvidence>>>`SELECT o.*,
    marketplace_host_dispute_obligation_valid(o.payout_id) AS valid,
    marketplace_host_dispute_obligation_evidence(o.payout_id) AS expected_evidence
    FROM marketplace_host_dispute_obligations o WHERE o.funding_plan_id=${fundingPlanId} ORDER BY o.id LIMIT 2`;
  if (hostRows.length > 1) add("host_principal_extinction_inventory_invalid", fundingPlanId);
  if (orderRows.length > 1) add("order_dispute_closure_inventory_invalid", fundingPlanId);
  const validIds = new Set<string>();
  const bound = (row: Row<MarketplaceHostPrincipalExtinctionEvidence | MarketplaceOrderDisputeClosureEvidence>) => {
    const e = row.evidence;
    return row.valid === true && row.host_merchant_id === host && row.funding_plan_id === fundingPlanId && [1, 2, 3].includes(e?.version) &&
      e.hostMerchantId === host && e.fundingPlanId === fundingPlanId && e.providerDisputeId === row.provider_dispute_id &&
      e.closureSnapshotId === row.closure_snapshot_id && e.provider === "stripe" && ["test", "live"].includes(e.environment) &&
      e.fundingHoldReleased === false && e.payoutReauthorized === false && row.evidence_hash === fundingHash(e) &&
      row.expected_evidence !== null && fundingHash(row.expected_evidence) === fundingHash(e);
  };
  const validEvent = async (certificateId: string, eventType: string, causationId: string, payload: unknown) => {
    const event = await tx.outboxMessage.findUnique({ where: { eventId: certificateId } });
    if (!event || event.eventType !== eventType || event.merchantId !== host || event.correlationId !== fundingPlanId ||
        event.causationId !== causationId || event.producer !== "marketplace" || event.schemaVersion !== 1 ||
        fundingHash(event.payload) !== fundingHash(payload)) return false;
    if (["dead", "failed"].includes(event.status)) add("order_dispute_closure_event_delivery_failed", certificateId);
    return true;
  };
  for (const row of hostRows) {
    try {
      const e = row.evidence;
      if (hostRows.length !== 1 || !bound(row) || e.version !== 1 || e.reason !== "stripe_host_dispute_principal_extinguished" ||
          row.payout_id !== e.payoutId || row.amount_cents !== e.amountCents || row.id !== marketplaceHostPrincipalExtinctionId(e) ||
          !await validEvent(row.id, "marketplace.host_principal_extinguished", e.payoutId, marketplaceHostPrincipalExtinctionPayload(e))) throw Error();
      hostPrincipals.set(e.payoutId, e); validIds.add(row.id);
    } catch { add("host_principal_extinction_certificate_or_event_invalid", row.id); }
  }
  if (hostObligationRows.length > 1) add("host_dispute_obligation_inventory_invalid", fundingPlanId);
  for (const row of hostObligationRows) {
    try {
      const e = row.evidence, principal = hostPrincipals.get(e?.payoutId);
      if (hostObligationRows.length !== 1 || !principal || row.valid !== true || row.host_merchant_id !== host || row.funding_plan_id !== fundingPlanId ||
          e.version !== 1 || e.reason !== "stripe_host_dispute_obligation_closed" || e.debtId !== e.payoutId || row.payout_id !== e.payoutId ||
          e.hostMerchantId !== host || e.fundingPlanId !== fundingPlanId || e.providerDisputeId !== principal.providerDisputeId ||
          e.closureSnapshotId !== principal.closureSnapshotId || e.provider !== "stripe" || e.environment !== principal.environment || e.accountFingerprint !== principal.accountFingerprint ||
          e.feeCertificateId !== marketplaceHostPrincipalExtinctionId(principal) || e.feeCertificateHash !== fundingHash(principal) ||
          e.principalAmountCents !== principal.amountCents || e.disputeFeeCents !== principal.hostDisputeFeeCents || e.disputeFeeCents <= 0 ||
          e.collectedFeeCents !== e.disputeFeeCents || e.excessLiabilityCents !== 0 || e.fundingHoldReleased !== false || e.payoutReauthorized !== false ||
          row.id !== marketplaceHostDisputeObligationId(e) || row.evidence_hash !== fundingHash(e) || !row.expected_evidence ||
          fundingHash(row.expected_evidence) !== fundingHash(e) || !await validEvent(row.id, "marketplace.host_dispute_obligation_closed", e.payoutId, marketplaceHostDisputeObligationPayload(e))) throw Error();
      hostObligations.set(e.payoutId, { id: row.id, evidenceHash: row.evidence_hash, evidence: e }); validIds.add(row.id);
    } catch { add("host_dispute_obligation_certificate_or_event_invalid", row.id); }
  }
  for (const principal of hostPrincipals.values()) if (principal.hostDisputeFeeCents > 0 && !hostObligations.has(principal.payoutId))
    add("host_dispute_fee_requires_collection", principal.payoutId);
  let orderClosed = false;
  for (const row of orderRows) {
    try {
      const e = row.evidence;
      if (orderRows.length !== 1 || !bound(row) || e.reason !== "stripe_order_dispute_closed" ||
          row.id !== marketplaceOrderDisputeClosureId(e) || e.excessLiabilityCents !== 0 ||
          e.originalFundingStatus !== "held" || e.operationalHoldClosed !== true ||
          hostRows.length !== (e.hostPrincipal ? 1 : 0) ||
          e.hostPrincipal && (!hostPrincipals.has(e.hostPrincipal.payoutId) ||
            hostPrincipals.get(e.hostPrincipal.payoutId)!.hostDisputeFeeCents !== e.hostDisputeFeeCents ||
            e.hostPrincipal.certificateId !== marketplaceHostPrincipalExtinctionId(hostPrincipals.get(e.hostPrincipal.payoutId)!) ||
            e.hostPrincipal.evidenceHash !== fundingHash(hostPrincipals.get(e.hostPrincipal.payoutId)!) ||
            e.hostPrincipal.amountCents !== hostPrincipals.get(e.hostPrincipal.payoutId)!.amountCents) ||
          e.version === 1 && e.hostDisputeFeeCents !== 0 ||
          e.version === 2 && e.hostDisputeFeeCents <= 0 ||
          e.version === 3 && (e.hostDisputeFeeCents < 0 || e.hostDisputeFeeCents === 0 && e.hostObligation !== undefined) ||
          (e.version === 2 || e.version === 3 && e.hostDisputeFeeCents > 0) && (!e.hostPrincipal || !e.hostObligation || !hostObligations.has(e.hostPrincipal.payoutId) ||
            e.hostObligation.obligationId !== hostObligations.get(e.hostPrincipal.payoutId)!.id ||
            e.hostObligation.obligationEvidenceHash !== hostObligations.get(e.hostPrincipal.payoutId)!.evidenceHash ||
            e.hostObligation.feeCertificateId !== hostObligations.get(e.hostPrincipal.payoutId)!.evidence.feeCertificateId ||
            e.hostObligation.feeCertificateHash !== hostObligations.get(e.hostPrincipal.payoutId)!.evidence.feeCertificateHash ||
            e.hostObligation.payoutId !== e.hostPrincipal.payoutId || e.hostObligation.disputeFeeCents !== e.hostDisputeFeeCents ||
            e.hostObligation.collectedFeeCents !== e.hostDisputeFeeCents ||
            e.hostObligation.principalAmountCents !== e.hostPrincipal.amountCents ||
            e.hostObligation.processingFeeCents !== hostObligations.get(e.hostPrincipal.payoutId)!.evidence.processingFeeCents ||
            fundingHash(e.hostObligation.creditHashes) !== fundingHash(hostObligations.get(e.hostPrincipal.payoutId)!.evidence.creditHashes)) ||
          !await validEvent(row.id, "marketplace.order_dispute_closed", e.providerDisputeId, marketplaceOrderDisputeClosurePayload(e))) throw Error();
      orderClosed = true; validIds.add(row.id);
    } catch { add("order_dispute_closure_certificate_or_event_invalid", row.id); }
  }
  const events = await tx.$queryRaw<Array<{ event_id: string }>>`SELECT event_id FROM outbox_messages
    WHERE merchant_id=${host} AND correlation_id=${fundingPlanId}
      AND event_type IN ('marketplace.host_principal_extinguished','marketplace.host_dispute_obligation_closed','marketplace.order_dispute_closed') ORDER BY event_id LIMIT 5`;
  for (const event of events) if (!validIds.has(event.event_id)) add("order_dispute_closure_event_without_valid_certificate", event.event_id);
  return { findings, hostPrincipals, hostObligations, orderClosed };
}

/** Historical SQL certificates establish returned liquidity only. This reader
 * never locks an order, resolves credentials, observes a provider or authorizes
 * a refund. Admission and financial holds remain separate. */
export async function auditMarketplaceAsaasResidualWalletReturnJournals(tx: Prisma.TransactionClient, host: string,
  fundingPlanId: string, provider: string, refunds: Array<{ id: string; operation?: { request: unknown } | null }>) {
  const findings: MarketplaceAuditFinding[] = [];
  const add = (code: string, reference: string) => findings.push({ code, reference });
  const rows = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns
    WHERE host_merchant_id=${host} AND funding_plan_id=${fundingPlanId} ORDER BY id LIMIT 2001`;
  if (rows.length > 2000) add("asaas_residual_wallet_return_audit_limit_exceeded", fundingPlanId);
  const validRows: AsaasResidualWalletReturnJournal[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(0, 2000)) {
    try {
      if (provider !== "asaas" || row.host_merchant_id !== host || row.funding_plan_id !== fundingPlanId ||
          !refunds.some(refund => refund.id === row.refund_plan_id) || seen.has(row.id) ||
          !["claimed", "unknown", "pending", "returned", "failed"].includes(row.status)) throw Error("scope_or_status");
      seen.add(row.id);
      validateAsaasResidualWalletReturnJournal(row);
      validRows.push(row);
      if (row.status !== "returned") add("asaas_residual_wallet_return_requires_reconciliation", row.id);
    } catch { add("asaas_residual_wallet_return_journal_invalid", row.id); }
  }
  const certified = new Map<string, CertifiedAsaasResidualWalletReturn[]>();
  for (const refundId of new Set(validRows.filter(row => row.status === "returned").map(row => row.refund_plan_id))) {
    try {
      const credits = await readCertifiedAsaasMarketplaceResidualWalletReturns(tx, host, fundingPlanId, refundId);
      const expected = validRows.filter(row => row.refund_plan_id === refundId && row.status === "returned");
      if (credits.length !== expected.length || new Set(credits.map(credit => credit.id)).size !== credits.length || expected.some(row => {
        const credit = credits.find(value => value.id === row.id);
        return !credit || credit.residualPlanId !== row.residual_plan_id || credit.residualOperationId !== row.residual_operation_id ||
          credit.certificateHash !== row.certificate_hash || fundingHash(credit.request) !== fundingHash(row.request) ||
          fundingHash(credit.proof) !== fundingHash(row.proof);
      })) throw Error("certificate_inventory");
      certified.set(refundId, credits);
    } catch { add("asaas_residual_wallet_return_certificate_or_event_invalid", refundId); }
  }
  for (const refund of refunds) {
    const request = refund.operation?.request as MarketplaceRefundRequest | null | undefined;
    if (request?.asaasResidualWalletReturns === undefined) continue;
    const credits = certified.get(refund.id), declared = request.asaasResidualWalletReturns;
    if (provider !== "asaas" || request.provider !== "asaas" || request.kind !== "refund" ||
        request.asaasWalletReturns !== undefined || request.fundingContributions !== undefined || request.stripeSourceFunding !== undefined ||
        !Array.isArray(declared) || declared.length !== 1 || !credits || credits.length !== 1 ||
        fundingHash(declared) !== fundingHash(credits)) add("refund_asaas_residual_wallet_return_proof_invalid", refund.id);
  }
  if (rows.length) {
    const failed = await tx.$queryRaw<Array<{ causation_id: string }>>`SELECT causation_id FROM outbox_messages
      WHERE merchant_id=${host} AND correlation_id=${fundingPlanId} AND event_type='marketplace.asaas_residual_wallet_return.returned'
        AND status IN ('dead','failed') ORDER BY causation_id LIMIT 2001`;
    if (failed.length > 2000) add("asaas_residual_wallet_return_audit_limit_exceeded", fundingPlanId);
    for (const event of failed.slice(0, 2000)) add("asaas_residual_wallet_return_event_delivery_failed", event.causation_id);
  }
  return { findings };
}

/** Internal, paged evidence collection. It never repairs history or reads today's
 * commercial configuration to invent missing financial obligations. */
@Injectable()
export class MarketplaceReadinessAuditService {
  constructor(private readonly prisma: PrismaClient, private readonly tenants: TenantContextService) {}

  async scan(input: { hostMerchantId: string; after?: string; limit?: number }) {
    const host = input.hostMerchantId;
    if (typeof host !== "string" || !host.trim() || host.length > 200 ||
        (input.after !== undefined && (typeof input.after !== "string" || input.after.length > 500)) ||
        (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))) {
      throw new BadRequestException("marketplace_audit_scope_invalid");
    }
    const caller = this.tenants.get();
    if (caller && caller.merchantId !== host) throw new ForbiddenException("marketplace_audit_tenant_mismatch");
    const limit = input.limit ?? 25;
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const candidates = await tx.$queryRaw<Candidate[]>`
        WITH candidates AS (
          SELECT 'payment:' || p.id AS key, p.id AS payment_id, p.provider_payment_id AS order_id
          FROM payment_intents p WHERE p.merchant_id = ${host} AND (
            EXISTS (SELECT 1 FROM marketplace_funding_plans f WHERE f.payment_intent_id = p.id) OR
            EXISTS (SELECT 1 FROM cross_store_line_items c WHERE c.host_merchant_id = ${host} AND c.checkout_session_id = p.session_id) OR
            EXISTS (SELECT 1 FROM checkout_sessions cs WHERE cs.merchant_id = ${host} AND cs.session_id = p.session_id AND (
              EXISTS (SELECT 1 FROM cross_store_line_items c WHERE c.host_merchant_id = ${host} AND c.checkout_session_id = cs.cart->>'cart_ref') OR
              EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.cart->'items') = 'array' THEN cs.cart->'items' ELSE '[]'::jsonb END) item
                WHERE jsonb_typeof(item->'marketplace') = 'object'))) OR
            EXISTS (SELECT 1 FROM marketplace_order_ledgers l WHERE l.host_merchant_id = ${host} AND l.order_id = p.provider_payment_id) OR
            EXISTS (SELECT 1 FROM marketplace_settlements s WHERE s.host_merchant_id = ${host} AND s.order_id = p.provider_payment_id))
          UNION ALL
          SELECT 'orphan:' || o.order_id, NULL::text, o.order_id FROM (
            SELECT order_id FROM marketplace_order_ledgers WHERE host_merchant_id = ${host}
            UNION SELECT order_id FROM marketplace_settlements WHERE host_merchant_id = ${host}
          ) o WHERE NOT EXISTS (SELECT 1 FROM payment_intents p WHERE p.merchant_id = ${host} AND p.provider_payment_id = o.order_id)
        ) SELECT * FROM candidates WHERE key > ${input.after ?? ""} ORDER BY key LIMIT ${limit + 1}`;
      const page = candidates.slice(0, limit);
      const rows = [];
      for (const candidate of page) rows.push(await this.inspect(tx, host, candidate));
      return { hostMerchantId: host, readOnly: true as const, scanned: rows.length,
        nextCursor: candidates.length > limit ? page[page.length - 1]!.key : null, rows };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  }

  private async inspect(tx: Prisma.TransactionClient, host: string, c: Candidate) {
    const findings: MarketplaceAuditFinding[] = [];
    const add = (code: string, reference?: string) => findings.push({ code, ...(reference ? { reference } : {}) });
    const payment = c.payment_id ? await tx.paymentIntent.findFirst({ where: { id: c.payment_id, merchantId: host } }) : null;
    const plan = payment ? await tx.marketplaceFundingPlan.findUnique({ where: { paymentIntentId: payment.id } }) : null;
    const order = c.order_id;
    const ledger = order ? await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId: host, orderId: order } } }) : null;
    const settlements = order ? await tx.marketplaceSettlement.findMany({ where: { hostMerchantId: host, orderId: order } }) : [];
    if (!payment) add("payment_missing");
    const paid = Boolean(ledger?.purchasedAt || (payment && (payment.approvedAmountCents || 0) > 0) ||
      (payment && ["approved", "refunded", "chargeback_pending", "chargeback_disputed", "chargeback_lost", "chargeback_won"].includes(payment.status)));
    if (paid && !order) add("payment_provider_identity_missing");
    if (paid && payment && payment.approvedAmountCents !== payment.amountCents) add("payment_approval_evidence_inconsistent");
    if (paid && !plan) add("funding_plan_missing");
    if (paid && !ledger?.purchasedAt) add("paid_order_ledger_missing");
    const completed = paid && order ? await tx.completedOrder.findMany({ where: { merchantId: host, externalOrderId: order } }) : [];
    if (paid && order) {
      if (!completed.length) add("completed_order_missing");
      else if (completed.length !== 1 || (payment && (completed[0]!.sessionId !== payment.sessionId || completed[0]!.currency !== payment.currency))) {
        add("completed_order_inconsistent");
      }
      const [event] = await tx.$queryRaw<Array<{ count: number; failed: number }>>`
        SELECT count(*)::int AS count, count(*) FILTER (WHERE status IN ('dead', 'failed'))::int AS failed
        FROM outbox_messages WHERE merchant_id = ${host} AND event_type = 'order.completed'
          AND (payload->>'orderId' = ${order} OR payload->>'externalOrderId' = ${order} OR payload->>'external_order_id' = ${order})`;
      if (!event?.count) add("order_event_missing");
      else if (event.failed) add("order_event_delivery_failed");
    }
    let instructions: UncapturedMarketplaceFunding | undefined;
    let verifiedBudget: FundingBudget | undefined;
    const payouts = plan ? await tx.marketplacePayout.findMany({ where: { fundingPlanId: plan.paymentIntentId }, include: { settlement: true } })
      : await tx.marketplacePayout.findMany({ where: { settlementId: { in: settlements.map(row => row.id) } }, include: { settlement: true } });
    if (plan) {
      const cancellation = await tx.marketplaceCancellationOperation.findUnique({ where: { fundingPlanId: plan.paymentIntentId } });
      let locallyCancelled = false;
      try {
        locallyCancelled = Boolean(await readMarketplaceUnsubmittedCancellationStatus(tx, host, plan.paymentIntentId));
        if (!locallyCancelled && payment?.status === "cancelled" && !payment.providerPaymentId) throw Error("local_proof_missing");
      } catch { add("unsubmitted_cancellation_binding_or_proof_invalid"); }
      if (cancellation || !locallyCancelled && plan.provider === "mercadopago" && payment?.status === "cancelled") {
        try {
          const { requestHash, ...request } = (cancellation?.request ?? {}) as unknown as MarketplaceCancellationExecutionRequest;
          if (cancellation && (fundingHash(request) !== requestHash || requestHash !== cancellation.requestHash ||
              request.reference !== cancellation.reference || request.hostMerchantId !== host || cancellation.hostMerchantId !== host ||
              request.paymentIntentId !== plan.paymentIntentId || request.checkoutSessionId !== plan.checkoutSessionId ||
              request.instructionsHash !== plan.instructionsHash || request.providerPaymentId !== payment?.providerPaymentId ||
              request.provider !== plan.provider || cancellation.provider !== plan.provider || request.environment !== plan.environment ||
              request.accountFingerprint !== plan.accountFingerprint || cancellation.accountFingerprint !== plan.accountFingerprint ||
              request.amountCents !== plan.amountCents || request.currency !== "BRL")) throw Error("binding");
          if (!cancellation || cancellation.status === "confirmed") {
            const event = await tx.outboxMessage.findUnique({ where: { eventId: `marketplace_cancel_${createHash("sha256").update(plan.paymentIntentId).digest("hex")}` } });
            const payload = event?.payload as { reason?: string; marketplace_cancellation?: MarketplaceCancellationEvidence } | undefined;
            const proof = payload?.marketplace_cancellation;
            if (cancellation && (!cancellation.confirmedAt || !cancellation.claimedAt) || payment?.status !== "cancelled" || plan.budget ||
                plan.status !== "held" || plan.fundedAt || payment.currency !== "BRL" || payment.amountCents !== plan.amountCents ||
                (payment.approvedAmountCents ?? 0) !== 0 || event?.merchantId !== host || event.eventType !== "payment.status.changed" ||
                event.producer !== "marketplace" || payload?.reason !== MARKETPLACE_TERMINAL_CANCELLATION_REASON ||
                !proof || proof.state !== "terminal_uncaptured" || !["stripe", "mercadopago"].includes(proof.provider) || proof.provider !== plan.provider ||
                proof.hostMerchantId !== host || proof.paymentIntentId !== plan.paymentIntentId || proof.providerPaymentId !== payment.providerPaymentId ||
                proof.accountFingerprint !== plan.accountFingerprint || proof.instructionsHash !== plan.instructionsHash ||
                proof.environment !== plan.environment || proof.amountCents !== plan.amountCents || proof.currency !== "BRL" ||
                proof.amountReceivedCents !== 0 || proof.amountCapturableCents !== 0 ||
                !Number.isFinite(Date.parse(proof.observedAt)) || !Number.isFinite(Date.parse(proof.cancelledAt)) || Date.parse(proof.cancelledAt) <= 0 ||
                Date.parse(proof.cancelledAt) > Date.parse(proof.observedAt) + 60_000 ||
                Date.parse(proof.observedAt) > (cancellation?.confirmedAt ?? event.occurredAt).getTime() + 60_000 || payouts.length || ledger ||
                await tx.stockReservation.count({ where: { marketplaceFundingPlanId: plan.paymentIntentId, status: { not: "RELEASED" } } })) throw Error("proof");
            if (proof.provider === "mercadopago") {
              const mp = proof.mercadoPago;
              if (proof.checkoutSessionId !== plan.checkoutSessionId || proof.checkoutSessionId !== payment.sessionId || !mp ||
                  mp.paymentId !== proof.providerPaymentId || !/^[1-9][0-9]*$/.test(mp.paymentId) || !/^[1-9][0-9]*$/.test(mp.collectorId) ||
                  mp.status !== "cancelled" || !["by_collector", "by_payer", "expired"].includes(mp.statusDetail) || mp.captured !== false ||
                  mp.netReceivedAmountCents !== 0 || mp.refundedAmountCents !== 0 || mp.dateApproved !== null) throw Error("mercadopago_proof");
            }
          }
        } catch { add("cancellation_binding_or_proof_invalid", cancellation?.id); }
        if (cancellation && ["unknown", "blocked"].includes(cancellation.status)) add("cancellation_requires_reconciliation", cancellation.id);
      }
      try {
        instructions = plan.instructions as unknown as UncapturedMarketplaceFunding;
        const creation = payment?.creation as { input?: { marketplaceFunding?: unknown } } | null;
        if (plan.hostMerchantId !== host || instructions.hostMerchantId !== host || !payment ||
            (ledger?.checkoutSessionId != null && plan.checkoutSessionId !== ledger.checkoutSessionId) || plan.amountCents !== payment.amountCents ||
            (plan.providerPaymentId !== null && plan.providerPaymentId !== payment.providerPaymentId) || fundingHash(instructions) !== plan.instructionsHash ||
            fundingHash(creation?.input?.marketplaceFunding) !== plan.instructionsHash ||
            instructions.provider !== plan.provider || instructions.environment !== plan.environment ||
            instructions.accountFingerprint !== plan.accountFingerprint || instructions.amountCents !== plan.amountCents || instructions.currency !== payment.currency ||
            !Array.isArray(instructions.lines) || !Array.isArray(instructions.destinations)) throw Error("invalid");
        if (plan.provider === "mercadopago") {
          if (plan.budget || plan.fundedAt || plan.providerFeeCents !== null || plan.netAmountCents !== null ||
              plan.platformRetainedCents !== null || plan.payoutTotalCents !== null || !["awaiting_capture", "held"].includes(plan.status)) throw Error("mercadopago_funded");
          assertMarketplaceUncapturedAllocation(plan.instructions as unknown as UncapturedMarketplaceFunding);
        }
      } catch { add("funding_instructions_invalid"); instructions = undefined; }
      if (instructions && plan.budget) {
        try {
          if (instructions.provider === "mercadopago") throw Error("mercadopago_funded");
          const fundableInstructions: FrozenMarketplaceFunding = { ...instructions, provider: instructions.provider };
          const budget = plan.budget as unknown as FundingBudget;
          if (fundingHash(buildMarketplaceFundingBudget(fundableInstructions, budget.capture)) !== fundingHash(budget) ||
              budget.capture.providerPaymentId !== order || budget.capture.providerPaymentId !== plan.providerPaymentId ||
              plan.providerFeeCents !== budget.capture.providerFeeCents ||
              plan.payoutTotalCents !== budget.payoutTotalCents || plan.netAmountCents !== budget.capture.netAmountCents ||
              plan.platformRetainedCents !== budget.platformRetainedCents) throw Error("invalid");
          verifiedBudget = budget;
          const expected = fundingTransferAllocations(fundableInstructions, budget);
          if (payouts.length !== expected.length || expected.some(e => payouts.filter(p => p.beneficiaryMerchantId === e.merchantId &&
              (p.settlement?.lineItemId ?? null) === e.lineItemId && p.kind === e.kind && p.amountCents === e.amountCents &&
              p.provider === plan.provider && p.accountFingerprint === plan.accountFingerprint && p.providerPaymentId === order &&
              p.currency === "BRL" && p.destination === instructions!.destinations.find(d => d.merchantId === e.merchantId)?.destination).length !== 1)) {
            add("payout_allocation_mismatch");
          }
        } catch { add("funding_budget_invalid"); }
      } else if (!plan.budget && plan.status === "funded") add("funded_budget_missing");
      else if (paid && !plan.budget) add("capture_allocation_pending");
    }
    if (paid && instructions) {
      if (completed.length === 1) {
        const amount = Number(completed[0]!.orderTotal) * 100;
        if (!Number.isFinite(amount) || Math.abs(amount - (instructions.amountCents - instructions.buyerServiceFeeCents)) > 0.000001) {
          add("completed_order_amount_inconsistent");
        }
      }
      const partnerLines = instructions.lines.filter(line => line.sellerMerchantId !== host);
      for (const line of partnerLines) {
        const expectedNet = verifiedBudget?.lines.find(row => row.lineItemId === line.lineItemId)?.sellerNetCents
          ?? (plan?.budget ? undefined : line.grossAmountCents - line.commissionCents);
        const matches = settlements.filter(row => row.lineItemId === line.lineItemId && row.sellerMerchantId === line.sellerMerchantId &&
          row.totalAmountCents === line.grossAmountCents && row.commissionCents === line.commissionCents &&
          (expectedNet === undefined || row.sellerNetCents === expectedNet));
        if (matches.length !== 1) add("settlement_missing_or_inconsistent", line.lineItemId);
      }
      if (settlements.some(row => !partnerLines.some(line => line.lineItemId === row.lineItemId))) add("unexpected_settlement");
      // Explicit scoped SQL checks participant receipts while the caller remains
      // in the host tenant. No buyer data or receipt payload leaves this audit.
      if (order) for (const merchant of new Set(instructions.lines.map(line => line.sellerMerchantId))) {
        const receipts = await tx.$queryRaw<Array<{ id: string; payload_hash: string; payload: SaleCompletedEvent }>>`
          SELECT id, payload_hash, payload - 'buyerEmail' - 'buyerName' - 'buyerPhone' AS payload
          FROM inventory_sale_receipts WHERE merchant_id = ${merchant} AND order_id = ${order}`;
        if (receipts.length !== 1) { add("inventory_receipt_missing", merchant); continue; }
        try {
          const receipt = receipts[0]!, sale = validateInventorySale(receipt.payload);
          if (receipt.id !== inventorySaleId(merchant, order) || receipt.payload_hash !== inventorySaleFingerprint(sale) ||
              sale.merchantId !== merchant || sale.orderId !== order ||
              sale.totalCents !== instructions.lines.filter(line => line.sellerMerchantId === merchant).reduce((sum, line) => sum + line.grossAmountCents, 0)) {
            throw Error("invalid");
          }
        } catch { add("inventory_receipt_inconsistent", merchant); }
        const jobs = await tx.$queryRaw<Array<{ event_type: string; status: string }>>`
          SELECT event_type, status FROM outbox_messages WHERE merchant_id = ${merchant}
            AND payload->>'receiptId' = ${receipts[0]!.id}
            AND event_type IN ('inventory.sale.erp_sync_requested', 'inventory.sale.crm_sync_requested', 'inventory.sale.webhook_requested')`;
        for (const kind of ["erp", "crm", "webhook"]) {
          const matching = jobs.filter(j => j.event_type === `inventory.sale.${kind}_sync_requested` || j.event_type === `inventory.sale.${kind}_requested`);
          if (matching.length !== 1) add("inventory_integration_event_missing_or_duplicate", `${merchant}:${kind}`);
          else if (["dead", "failed"].includes(matching[0]!.status)) add("inventory_integration_event_failed", `${merchant}:${kind}`);
        }
      }
    }
    if (plan) {
      if (await tx.outboxMessage.count({ where: { merchantId: host, correlationId: plan.paymentIntentId,
        eventType: "marketplace.financial_reconciliation_required" } })) {
        add("financial_provider_history_requires_reconciliation", plan.paymentIntentId);
      }
      const residuals = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId: plan.paymentIntentId },
        include: { operations: true }, orderBy: { generation: "asc" } });
      const refunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: plan.paymentIntentId, hostMerchantId: host },
        include: { operation: true, reversals: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      // The immutable cumulative amount orders generations even when timestamps tie.
      refunds.sort((a, b) => Number((a.allocation as unknown as MarketplaceRefundAllocation)?.cumulativeRefundCents ?? 0) -
        Number((b.allocation as unknown as MarketplaceRefundAllocation)?.cumulativeRefundCents ?? 0));
      const refundFunding = await auditMarketplaceRefundFundingJournals(tx, host, plan.paymentIntentId);
      findings.push(...refundFunding.findings);
      findings.push(...(await auditMarketplaceAsaasResidualWalletReturnJournals(tx, host, plan.paymentIntentId, plan.provider, refunds)).findings);
      for (const refund of refunds) {
        if (fundingHash(refund.allocation) !== refund.allocationHash || (refund.allocation as unknown as MarketplaceRefundAllocation).amountCents !== refund.amountCents) add("refund_allocation_inconsistent", refund.id);
        if (["blocked", "failed", "submitted"].includes(refund.status)) add("refund_requires_reconciliation", refund.id);
        if (refund.status === "confirmed" && (refund.operation?.status !== "confirmed" || !refund.operation.providerOperationId)) add("refund_receipt_missing", refund.id);
        if (refund.operation) {
          try {
            const { requestHash, ...request } = refund.operation.request as unknown as MarketplaceRefundRequest;
            const previous = refunds.slice(0, refunds.indexOf(refund));
            if (!verifiedBudget || requestHash !== refund.operation.requestHash || fundingHash(request) !== requestHash ||
                request.kind !== "refund" || request.provider !== plan.provider || refund.operation.provider !== plan.provider || request.environment !== plan.environment ||
                request.accountFingerprint !== plan.accountFingerprint || refund.operation.accountFingerprint !== plan.accountFingerprint ||
                request.providerPaymentId !== plan.providerPaymentId || request.sourceId !== verifiedBudget.capture.sourceId ||
                request.paymentAmountCents !== plan.amountCents || request.amountCents !== refund.amountCents || request.currency !== "BRL" ||
                request.reference !== refund.operation.reference || request.reference !== `mrefund_${fundingHash([host, refund.returnId])}` ||
                previous.some(r => r.status !== "confirmed" || r.operation?.status !== "confirmed" || !r.operation.providerOperationId) ||
                fundingHash(request.previousRefunds) !== fundingHash(previous.map(r => ({ providerOperationId: r.operation!.providerOperationId!, amountCents: r.amountCents }))) ||
                refund.status === "confirmed" && (!refund.operation.claimedAt || !refund.operation.reconciledAt)) throw Error("proof");
            if (plan.provider === "asaas" && (request.transfer !== undefined ||
                !request.asaasCapture || fundingHash(request.asaasCapture) !== fundingHash(verifiedBudget.capture) ||
                request.sourceId !== plan.providerPaymentId ||
                refund.operation.status === "confirmed" && !/^asaas_refund_[a-f0-9]{64}$/.test(refund.operation.providerOperationId ?? ""))) {
              throw Error("asaas_capture_or_receipt");
            }
            if (request.fundingContributions || request.asaasWalletReturns) {
              if (!instructions || instructions.provider === "mercadopago") throw Error("funding_instructions");
              await assertAuditedMarketplaceRefundFunding(tx, { host, fundingPlanId: plan.paymentIntentId,
                instructionsHash: plan.instructionsHash, instructions: { ...instructions, provider: instructions.provider }, budget: verifiedBudget, refunds: [...previous, refund],
                certificates: refundFunding.certificates, request: { ...request, requestHash } });
            }
            if (request.stripeSourceFunding) {
              const replay = await readStripeMarketplaceSourceRefundContext(tx, {hostMerchantId: host,
                paymentIntentId: plan.paymentIntentId, refundPlanId: refund.id, admission: false});
              if (fundingHash(replay.refundRequest) !== fundingHash({...request, requestHash})) throw Error("stripe_source_refund");
            }
            if (refund.status === "confirmed" && !request.fundingContributions && !request.stripeSourceFunding) buildMarketplaceResidualAllocation(verifiedBudget,
              [...previous, refund].map(r => r.allocation as unknown as MarketplaceRefundAllocation));
          } catch { add("refund_operation_or_history_invalid", refund.id); }
        }
        for (const reversal of refund.reversals) {
          try {
            const residualParent = reversal.residualOperationId ? residuals.find(r => r.operations.some(o => o.id === reversal.residualOperationId)) : undefined;
            const residualOperation = residualParent?.operations.find(o => o.id === reversal.residualOperationId);
            const originalPayout = payouts.find(p => p.id === reversal.payoutId && p.status === "confirmed" && p.providerTransferId);
            const payout = residualOperation ? { ...residualOperation, destination: (residualOperation.request as { destination?: string }).destination } : originalPayout;
            const { requestHash, ...request } = reversal.request as unknown as MarketplaceRefundRequest;
            const previous = refunds.slice(0, refunds.indexOf(refund));
            const sameTarget = (r: typeof reversal) => r.payoutId === reversal.payoutId && r.residualOperationId === reversal.residualOperationId;
            const previousReversals = previous.flatMap(r => r.reversals).filter(sameTarget);
            if (!payout || (reversal.payoutId === null) === (reversal.residualOperationId === null) ||
                payout.status !== "confirmed" || !payout.providerTransferId ||
                residualParent && ((residualParent.basis as unknown as MarketplaceResidualBasis).refunds.length > previous.length ||
                  (residualParent.basis as unknown as MarketplaceResidualBasis).refunds.some(b => !previous.some(p => p.id === b.refundPlanId))) ||
                residualOperation && (request.transfer?.kind !== "residual" || request.transfer.requestHash !== residualOperation.requestHash) ||
                !residualOperation && (request.transfer?.kind !== undefined || request.transfer?.requestHash !== undefined) ||
                !verifiedBudget || reversal.hostMerchantId !== host || reversal.provider !== plan.provider ||
                reversal.accountFingerprint !== plan.accountFingerprint || requestHash !== reversal.requestHash || fundingHash(request) !== requestHash ||
                request.kind !== "transfer_reversal" || request.provider !== plan.provider || request.accountFingerprint !== plan.accountFingerprint || request.environment !== plan.environment ||
                request.providerPaymentId !== plan.providerPaymentId || request.sourceId !== verifiedBudget.capture.sourceId ||
                request.paymentAmountCents !== plan.amountCents || request.amountCents !== reversal.amountCents || request.currency !== "BRL" ||
                request.reference !== reversal.reference || request.reference !== `mreverse_${fundingHash([host, refund.id, payout.id])}` ||
                request.transfer?.providerTransferId !== payout.providerTransferId || request.transfer.destination !== payout.destination ||
                request.transfer.amountCents !== payout.amountCents || request.transfer.reference !== payout.reference ||
                previous.some(r => r.status !== "confirmed" || r.operation?.status !== "confirmed" || !r.operation.providerOperationId) ||
                fundingHash(request.previousRefunds) !== fundingHash(previous.map(r => ({ providerOperationId: r.operation!.providerOperationId!, amountCents: r.amountCents }))) ||
                previousReversals.some(r => r.status !== "confirmed" || !r.providerOperationId) ||
                fundingHash(request.transfer.previousReversals ?? []) !== fundingHash(previousReversals.map(r => ({
                  providerOperationId: r.providerOperationId!, amountCents: r.amountCents, reference: r.reference, requestHash: r.requestHash }))) ||
                reversal.status === "confirmed" && (!reversal.providerOperationId || !reversal.claimedAt || !reversal.reconciledAt)) throw Error("proof");
            const confirmed = refunds.flatMap(r => r.reversals).filter(r => sameTarget(r) && r.status === "confirmed");
            if (new Set(confirmed.map(r => r.providerOperationId)).size !== confirmed.length ||
                confirmed.reduce((sum, r) => sum + r.amountCents, 0) > payout.amountCents) throw Error("conservation");
            if (request.stripeSourceFunding) {
              const replay = await readStripeMarketplaceSourceRefundContext(tx, {hostMerchantId: host,
                paymentIntentId: plan.paymentIntentId, refundPlanId: refund.id, admission: false});
              const expected = replay.reversalRequests.find(r => r.payoutId === payout.id && r.amountCents === reversal.amountCents);
              if (!expected || fundingHash(expected.request) !== fundingHash({...request, requestHash})) throw Error("stripe_source_reversal");
            }
          } catch { add("reversal_binding_invalid", reversal.id); }
          if (["unknown", "pending", "failed"].includes(reversal.status)) add("reversal_requires_reconciliation", reversal.id);
          if (ledger?.chargebackAt) add("reversal_dispute_requires_reconciliation", reversal.id);
        }
      }
      for (const residual of residuals) {
        if (residual.status === "held" || ledger?.chargebackAt) add("residual_requires_reconciliation", residual.id);
        try {
          const basis = residual.basis as unknown as MarketplaceResidualBasis;
          const prefix = refunds.slice(0, basis.refunds.length);
          const priorGenerations = residuals.filter(r => r.generation < residual.generation);
          // A later dispute holds historical generations and cancels originals
          // that were never sent; their immutable funding proof remains valid.
          const disputeHeld = Boolean(ledger?.chargebackAt && plan.status === "held");
          if (!verifiedBudget || residual.hostMerchantId !== host || fundingHash(residual.basis) !== residual.basisHash ||
              fundingHash(residual.allocation) !== residual.allocationHash || basis.fundingPlanId !== plan.paymentIntentId ||
              basis.instructionsHash !== plan.instructionsHash || basis.budgetHash !== fundingHash(verifiedBudget) ||
              residual.generation !== residuals.indexOf(residual) + 1 || !basis.refunds.length || basis.refunds.length !== prefix.length ||
              prefix.some((r, i) => r.status !== "confirmed" || basis.refunds[i]?.refundPlanId !== r.id || !basis.refunds.some(b =>
                b.refundPlanId === r.id && b.returnId === r.returnId && b.allocationHash === r.allocationHash &&
                b.requestHash === r.operation?.requestHash && b.providerOperationId === r.operation?.providerOperationId && b.amountCents === r.amountCents))) throw Error("basis");
          if (basis.version === 3) {
            if (residual.generation < 2 || priorGenerations.length !== residual.generation - 1 ||
                fundingHash(basis.previousGenerations) !== fundingHash(priorGenerations.map(r => ({ residualPlanId: r.id,
                  generation: r.generation, basisHash: r.basisHash, allocationHash: r.allocationHash }))) ||
                priorGenerations.some(r => !(r.status === "completed" && !r.heldReason ||
                  disputeHeld && r.status === "held" && r.heldReason === "marketplace_residual_dispute_requires_reconciliation") ||
                  (r.basis as unknown as MarketplaceResidualBasis).refunds.length >= prefix.length ||
                  r.operations.some(o => o.status !== "confirmed" || !o.providerTransferId || !o.claimedAt || !o.reconciledAt))) throw Error("generation");
          } else if (basis.version === 6) {
            if (residual.generation !== 2 || priorGenerations.length !== 1 ||
                fundingHash(basis.previousGenerations) !== fundingHash(priorGenerations.map(r => ({residualPlanId: r.id,
                  generation: r.generation, basisHash: r.basisHash, allocationHash: r.allocationHash})))) throw Error("generation");
          } else if (residual.generation !== 1) throw Error("generation");
          if (basis.version === 6) {
            if (plan.provider !== "stripe" || disputeHeld) throw Error("stripe_successive_profile");
            const expected = buildStripeMarketplaceSuccessiveResidualAllocation(basis);
            const recipients = expected.sources.flatMap(source => source.beneficiaries.filter(b => b.amountCents > 0)
              .map(b => ({...b, sourceId: source.sourceId})));
            const evidence = await tx.$queryRaw<Array<{valid: boolean}>>`SELECT marketplace_stripe_successive_residual_evidence_valid(${residual.id}, false) AS valid`;
            if (evidence[0]?.valid !== true || fundingHash(expected) !== residual.allocationHash || residual.operations.length !== recipients.length) throw Error("stripe_successive_evidence");
            for (const beneficiary of recipients) {
              const members = residual.operations.filter(o => o.sourceId === beneficiary.sourceId && o.beneficiaryMerchantId === beneficiary.merchantId);
              const request = buildStripeMarketplaceSuccessiveResidualRequest(basis, beneficiary.sourceId, beneficiary.merchantId);
              if (members.length !== 1 || fundingHash(members[0].request) !== fundingHash(request) || members[0].requestHash !== request.requestHash ||
                  members[0].amountCents !== request.amountCents || members[0].reference !== request.reference ||
                  members[0].provider !== "stripe" || members[0].accountFingerprint !== plan.accountFingerprint) throw Error("stripe_successive_operation");
              if (["unknown", "pending", "failed"].includes(members[0].status)) add("residual_operation_requires_reconciliation", members[0].id);
            }
            if (residual.status !== "completed") add("residual_generation_certification_pending", residual.id);
            continue;
          }
          if (basis.version === 7) {
            if (plan.provider !== "asaas" || priorGenerations.length || disputeHeld || basis.asaasFunding.host.merchantId !== host ||
                basis.asaasFunding.host.accountFingerprint !== plan.accountFingerprint) throw Error("asaas_host_retention_profile");
            const certified = await readCertifiedAsaasMarketplaceWalletReturns(tx, host, plan.paymentIntentId, prefix.map(r => r.id));
            if (fundingHash(certified) !== fundingHash(basis.asaasFunding.walletReturns)) throw Error("asaas_host_retention_original_principal");
            const expected = buildAsaasMarketplaceHostRetentionAllocation(verifiedBudget,
              prefix.map(r => r.allocation as unknown as MarketplaceRefundAllocation), basis.asaasFunding);
            const retention = buildAsaasMarketplaceHostRetentionRequest({basis, allocation: expected, capture: verifiedBudget.capture});
            const journal = await tx.$queryRaw<Array<{id: string; request: AsaasMarketplaceHostRetentionRequest; request_hash: string;
              host_merchant_id: string; funding_plan_id: string; status: string; proof: AsaasMarketplaceHostRetentionProof | null; certificate_hash: string | null}>>`
              SELECT * FROM marketplace_asaas_host_retentions WHERE residual_plan_id=${residual.id}`;
            const j = journal[0];
            if (journal.length !== 1 || j.id !== asaasHostRetentionJournalId(retention.requestHash) || j.host_merchant_id !== host ||
                j.funding_plan_id !== plan.paymentIntentId || j.request_hash !== retention.requestHash ||
                !validAsaasMarketplaceHostRetentionRequest(j.request) || fundingHash(j.request) !== fundingHash(retention) ||
                !["planned", "certified"].includes(j.status) || j.status === "planned" && (j.proof || j.certificate_hash) ||
                j.status === "certified" && (!j.proof || !validAsaasMarketplaceHostRetentionProof(retention, j.proof) ||
                  j.certificate_hash !== fundingHash({request: retention, proof: j.proof}))) throw Error("asaas_host_retention_journal");
            const recipients = expected.beneficiaries.filter(b => b.amountCents > 0 && b.destination !== retention.host.walletId);
            const evidence = await tx.$queryRaw<Array<{valid: boolean}>>`SELECT marketplace_asaas_host_retention_evidence_valid(${residual.id}) AS valid`;
            if (evidence[0]?.valid !== true || fundingHash(expected) !== residual.allocationHash ||
                residual.operations.length !== recipients.length) throw Error("asaas_host_retention_allocation");
            for (const beneficiary of recipients) {
              const members = residual.operations.filter(o => o.sourceId === "original" && o.beneficiaryMerchantId === beneficiary.merchantId);
              const request = buildAsaasMarketplaceHostRetentionOutboundRequest({retention, beneficiaryMerchantId: beneficiary.merchantId});
              if (members.length !== 1 || fundingHash(members[0].request) !== fundingHash(request) || members[0].requestHash !== request.requestHash ||
                  members[0].amountCents !== request.amountCents || members[0].reference !== request.reference ||
                  members[0].provider !== "asaas" || members[0].accountFingerprint !== plan.accountFingerprint) throw Error("asaas_host_retention_operation");
              const operation = members[0];
              if (["unknown", "pending", "failed"].includes(operation.status)) add("residual_operation_requires_reconciliation", operation.id);
              if (operation.status === "confirmed") {
                const event = await tx.outboxMessage.findUnique({where: {eventId: `marketplace_residual_confirmed_${operation.id}`}});
                const payload = event?.payload as {asaas_proof?: import("../domain/ports/asaas-marketplace-residual.port.js").AsaasMarketplaceResidualTransferProof} | undefined;
                if (!event || event.eventType !== "marketplace.residual.confirmed" || event.schemaVersion !== 1 || event.producer !== "marketplace" ||
                    event.merchantId !== host || event.correlationId !== plan.paymentIntentId || event.causationId !== operation.id ||
                    !payload?.asaas_proof || payload.asaas_proof.providerTransferId !== operation.providerTransferId ||
                    !validAsaasHostRetentionOutboundProof(request, payload.asaas_proof)) throw Error("asaas_host_retention_receipt");
              }
            }
            if (residual.status !== "completed") add("residual_generation_certification_pending", residual.id);
            continue;
          }
          if (basis.version === 5) {
            if (plan.provider !== "asaas" || priorGenerations.length || disputeHeld ||
                basis.asaasFunding.host.merchantId !== host ||
                basis.asaasFunding.host.accountFingerprint !== plan.accountFingerprint) throw Error("asaas_profile");
            const certified = await readCertifiedAsaasMarketplaceWalletReturns(tx, host, plan.paymentIntentId, prefix.map(r => r.id));
            if (fundingHash(certified) !== fundingHash(basis.asaasFunding.walletReturns) ||
                fundingHash(basis.asaasFunding.originalPayouts) !== fundingHash([...payouts].sort((a, b) => a.id.localeCompare(b.id)).map(p => ({
                  id: p.id, merchantId: p.beneficiaryMerchantId, destination: p.destination, amountCents: p.amountCents, status: p.status,
                  ...(p.providerTransferId ? {providerTransferId: p.providerTransferId} : {}),
                })))) throw Error("asaas_original_principal");
            const expected = buildAsaasMarketplaceResidualAllocation(verifiedBudget,
              prefix.map(r => r.allocation as unknown as MarketplaceRefundAllocation), basis.asaasFunding);
            const recipients = expected.beneficiaries.filter(b => b.amountCents > 0);
            if (fundingHash(expected) !== residual.allocationHash || residual.operations.length !== recipients.length) throw Error("asaas_allocation");
            for (const beneficiary of recipients) {
              const members = residual.operations.filter(o => o.sourceId === "original" && o.beneficiaryMerchantId === beneficiary.merchantId);
              if (members.length !== 1) throw Error("asaas_operation_inventory");
              const operation = members[0]!, request = buildAsaasMarketplaceResidualRequest({basis, allocation: expected,
                capture: verifiedBudget.capture, beneficiaryMerchantId: beneficiary.merchantId});
              if (fundingHash(operation.request) !== fundingHash(request) || operation.requestHash !== request.requestHash ||
                  operation.reference !== request.reference || operation.amountCents !== request.amountCents || operation.provider !== "asaas" ||
                  operation.accountFingerprint !== plan.accountFingerprint) throw Error("asaas_operation");
              const event = await tx.outboxMessage.findUnique({where: {eventId: asaasResidualSubmissionEventId(operation.id)}});
              if (event && (event.eventType !== "marketplace.asaas_residual.submission_authorized" || event.schemaVersion !== 1 ||
                  event.producer !== "marketplace" || event.merchantId !== host || event.correlationId !== plan.paymentIntentId ||
                  event.causationId !== operation.id || fundingHash(event.payload) !== fundingHash({residual_plan_id: residual.id,
                    operation_id: operation.id, payment_intent_id: plan.paymentIntentId, request_hash: operation.requestHash}))) throw Error("asaas_submission_permission");
              if (["unknown", "pending", "failed"].includes(operation.status)) add("residual_operation_requires_reconciliation", operation.id);
              if (residual.status === "completed" && (operation.status !== "confirmed" || !operation.providerTransferId ||
                  !operation.claimedAt || !operation.reconciledAt || !event)) throw Error("asaas_receipt");
              if (operation.status === "confirmed") {
                const confirmed = await tx.outboxMessage.findUnique({where: {eventId: `marketplace_residual_confirmed_${operation.id}`}});
                const payload = confirmed?.payload as unknown as {asaas_proof?: import("../domain/ports/asaas-marketplace-residual.port.js").AsaasMarketplaceResidualTransferProof};
                if (!confirmed || confirmed.eventType !== "marketplace.residual.confirmed" || confirmed.merchantId !== host ||
                    confirmed.correlationId !== plan.paymentIntentId || confirmed.causationId !== operation.id || confirmed.schemaVersion !== 1 ||
                    confirmed.producer !== "marketplace" || !payload.asaas_proof ||
                    payload.asaas_proof.providerTransferId !== operation.providerTransferId ||
                    !validAsaasResidualTransferProof(request, payload.asaas_proof)) throw Error("asaas_native_ledger_receipt");
              }
            }
            continue;
          }
          if (basis.version === 4) {
            if (!instructions || priorGenerations.length || payouts.some(p =>
              !(p.status === "planned" || disputeHeld && p.status === "cancelled") || p.providerTransferId || p.claimedAt)) {
              throw Error("original_transfer_unreconciled");
            }
            const contribution = await readMarketplaceResidualContributionBasis(tx, {
              funding: plan, instructions: instructions as FrozenMarketplaceFunding, budget: verifiedBudget, refunds: prefix,
            });
            if (!contribution || fundingHash(contribution.funding) !== fundingHash(basis.fundingContributions)) throw Error("contribution_basis");
            const expected = buildMarketplaceResidualContributionAllocation(contribution.basis, contribution.funding);
            const recipients = expected.sources.flatMap(source => source.beneficiaries.map(b => ({ ...b, sourceId: source.sourceId })));
            if (fundingHash(expected) !== residual.allocationHash || residual.operations.length !== recipients.length) throw Error("allocation");
            for (const beneficiary of recipients) {
              const members = residual.operations.filter(o => o.sourceId === beneficiary.sourceId && o.beneficiaryMerchantId === beneficiary.merchantId);
              if (members.length !== 1) throw Error("source_operation_inventory");
              const operation = members[0]!;
              const request = buildMarketplaceResidualRequest({ plan, budget: verifiedBudget, basis, allocation: expected }, beneficiary, residual.basisHash);
              if (fundingHash(operation.request) !== fundingHash(request) || operation.requestHash !== request.requestHash ||
                  operation.reference !== request.reference || operation.amountCents !== request.amountCents ||
                  operation.provider !== plan.provider || operation.accountFingerprint !== plan.accountFingerprint) throw Error("source_operation");
              if (["unknown", "pending", "failed"].includes(operation.status)) add("residual_operation_requires_reconciliation", operation.id);
              if (residual.status === "completed" && (operation.status !== "confirmed" || !operation.providerTransferId ||
                  !operation.claimedAt || !operation.reconciledAt)) throw Error("receipt");
            }
            continue;
          }
          if (basis.version === 2 || basis.version === 3) {
            const originals = payouts.filter(p => p.status === "confirmed");
            const priorOperations = basis.version === 3 ? priorGenerations.flatMap(r => r.operations) : [];
            if (basis.originalTransfers.length !== originals.length + priorOperations.length || basis.originalTransfers.some(t => {
              const operation = t.kind === "residual" ? priorOperations.find(o => o.id === t.payoutId) : undefined;
              const payout = operation ? { ...operation, destination: (operation.request as { destination: string }).destination } : originals.find(p => p.id === t.payoutId);
              const reversals = prefix.flatMap(r => r.reversals).filter(r => operation ? r.residualOperationId === t.payoutId : r.payoutId === t.payoutId);
              return !payout || t.merchantId !== payout.beneficiaryMerchantId || t.destination !== payout.destination ||
                t.kind === "residual" && (!operation || t.residualPlanId !== operation.residualPlanId || t.requestHash !== operation.requestHash) ||
                t.kind !== "residual" && (t.kind !== undefined || t.residualPlanId !== undefined || t.requestHash !== undefined) ||
                t.reference !== payout.reference || t.providerTransferId !== payout.providerTransferId || t.amountCents !== payout.amountCents ||
                t.reversals.length !== reversals.length || reversals.some(r => r.status !== "confirmed" || !t.reversals.some(v =>
                  v.providerOperationId === r.providerOperationId && v.amountCents === r.amountCents && v.reference === r.reference && v.requestHash === r.requestHash));
            })) throw Error("original_transfer_proof");
          } else if (basis.version !== 1 || payouts.some(p =>
            !(p.status === "planned" || disputeHeld && p.status === "cancelled") || p.providerTransferId || p.claimedAt)) throw Error("original_transfer_unreconciled");
          const allocations = prefix.map(r => r.allocation as unknown as MarketplaceRefundAllocation);
          const expected = basis.version === 3 ? buildMarketplaceResidualAfterGenerationAllocation(verifiedBudget, allocations, basis.originalTransfers) :
            basis.version === 2 ? buildMarketplaceResidualAfterReversalAllocation(verifiedBudget, allocations, basis.originalTransfers) :
            buildMarketplaceResidualAllocation(verifiedBudget, allocations);
          const recipients = expected.beneficiaries.filter(b => b.amountCents > 0);
          if (fundingHash(expected) !== residual.allocationHash || residual.operations.length !== recipients.length || recipients.some(b =>
            residual.operations.filter(o => o.beneficiaryMerchantId === b.merchantId && o.amountCents === b.amountCents &&
              o.provider === plan.provider && o.accountFingerprint === plan.accountFingerprint).length !== 1)) throw Error("allocation");
          for (const operation of residual.operations) {
            const { requestHash, ...raw } = operation.request as Record<string, unknown>;
            const beneficiary = recipients.find(b => b.merchantId === operation.beneficiaryMerchantId);
            const referenceFor = (merchantId: string) => `mresidual_${fundingHash([host, plan.paymentIntentId, residual.basisHash, merchantId])}`;
            const expectedRequest = { provider: plan.provider, accountFingerprint: plan.accountFingerprint,
              providerPaymentId: plan.providerPaymentId, destination: beneficiary?.destination, amountCents: beneficiary?.amountCents,
              currency: "BRL", reference: referenceFor(operation.beneficiaryMerchantId), capture: verifiedBudget.capture,
              remainingTotalCents: expected.payoutTotalCents,
              ...(basis.version === 2 || basis.version === 3 ? { version: basis.version, originalTransfers: basis.originalTransfers } : {}),
              ...(basis.version === 3 ? { previousGenerations: basis.previousGenerations } : {}),
              transfers: recipients.map(b => ({ reference: referenceFor(b.merchantId), destination: b.destination, amountCents: b.amountCents })),
              refunds: basis.refunds.map(r => ({ providerOperationId: r.providerOperationId, amountCents: r.amountCents })) };
            if (requestHash !== operation.requestHash || fundingHash(raw) !== requestHash || raw.reference !== operation.reference ||
                raw.amountCents !== operation.amountCents || fundingHash(expectedRequest) !== requestHash) throw Error("operation");
            if (["unknown", "pending", "failed"].includes(operation.status)) add("residual_operation_requires_reconciliation", operation.id);
            if (residual.status === "completed" && (operation.status !== "confirmed" || !operation.providerTransferId)) throw Error("receipt");
          }
        } catch { add("residual_allocation_inconsistent", residual.id); }
      }
      const shipments = await tx.marketplaceShipmentJournal.findMany({ where: { fundingPlanId: plan.paymentIntentId } });
      for (const origin of new Set(shipments.map(row => row.originMerchantId))) {
        const members = shipments.filter(row => row.originMerchantId === origin);
        try {
          const bindings = instructions?.shippingQuotes?.filter(row => row.merchantId === origin);
          if (bindings?.length !== 1) throw Error("binding");
          const binding = bindings[0], quote = await tx.shippingQuote.findFirst({ where: { id: binding.quoteId, merchantId: host } });
          if (!quote || quote.quoteKey !== binding.quoteKey || quote.selectedCarrierKey !== binding.carrierKey || !Array.isArray(quote.results)) throw Error("quote");
          const options = (quote.results as Array<Record<string, unknown>>).filter(row => row.carrier_key === binding.carrierKey);
          if (options.length !== 1) throw Error("option");
          const proven = assertMarketplaceShipmentOriginRequests(members as unknown as MarketplaceShipmentRecord[], {
            hostMerchantId: host, paymentIntentId: plan.paymentIntentId, originMerchantId: origin, binding, option: options[0] });
          if (proven.every(row => row.status === "generated" && row.trackingStatus === "delivered" && !row.cancellationStatus && !row.blockReason)) {
            const eventId = `mship_origin_delivered_${marketplaceShippingContractHash([host, plan.paymentIntentId, origin])}`;
            const event = await tx.outboxMessage.findFirst({ where: { eventId, merchantId: host, eventType: "marketplace.shipment.origin_delivered" } });
            if (!event || event.correlationId !== plan.paymentIntentId || event.causationId !== origin || event.schemaVersion !== 1 ||
                event.producer !== "marketplace-shipping" || marketplaceShippingContractHash(event.payload) !== marketplaceShippingContractHash({
                  funding_plan_id: plan.paymentIntentId, origin_merchant_id: origin, volume_count: proven.length, shipment_ids: proven.map(row => row.id) })) {
              add("shipment_origin_delivery_event_missing_or_inconsistent", members[0].id);
            }
          }
        } catch { add("shipment_volume_set_invalid", members[0].id); }
      }
      for (const shipment of shipments) {
        if (shipment.blockReason) add("shipment_block_requires_reconciliation", shipment.id);
        if (shipment.cancellationStatus === "unknown") add("shipment_cancellation_requires_reconciliation", shipment.id);
        if (shipment.cancellationStatus === "canceled") add("shipment_wallet_refund_unproven", shipment.id);
        if (shipment.cancellationStatus || shipment.cancellationReceipt) {
          try {
            if (!shipment.cancellationClaimedAt || !["merchant_request", "return", "dispute"].includes(shipment.cancellationReason ?? "") ||
                !["purchased", "generated"].includes(shipment.status)) throw Error("claim");
            if (shipment.cancellationStatus === "canceled") {
              const receipt = shipment.cancellationReceipt as unknown as MarketplaceShipmentCancellationReceipt;
              if (!shipment.canceledAt || !shipment.carrierOrderId || marketplaceShippingContractHash(receipt) !== shipment.cancellationReceiptHash) throw Error("proof");
              assertMarketplaceShipmentCancellationReceipt(receipt, shipment.request as unknown as MarketplaceShipmentRequest,
                shipment.purchaseReceipt as unknown as MarketplaceShipmentPurchaseReceipt,
                shipment.generationReceipt as unknown as MarketplaceShipmentGenerationReceipt | null, shipment.carrierOrderId);
            } else if (shipment.cancellationStatus !== "unknown" || shipment.cancellationReceipt || shipment.cancellationReceiptHash || shipment.canceledAt) throw Error("state");
          } catch { add("shipment_cancellation_proof_invalid", shipment.id); }
        }
        if (shipment.hostMerchantId !== host || !instructions?.shippingQuotes?.some(q => q.merchantId === shipment.originMerchantId && q.quoteId === shipment.quoteId && q.quoteKey === shipment.quoteKey)) add("shipment_binding_invalid", shipment.id);
        if (["cart_unknown", "purchase_unknown", "generate_unknown", "blocked"].includes(shipment.status)) add("shipment_requires_reconciliation", shipment.id);
        if (["cart_created", "purchased"].includes(shipment.status) && shipment.cancellationStatus !== "canceled") add("shipment_fulfillment_incomplete", shipment.id);
        if (["cart_created", "purchased", "generated"].includes(shipment.status) && !shipment.carrierOrderId) add("shipment_receipt_missing", shipment.id);
        if (shipment.purchaseClaimedAt && (plan.status === "held" || ledger?.chargebackAt)) add("shipment_financial_interruption", shipment.id);
        if (shipment.purchaseReceipt || ["purchased", "generate_unknown", "generated"].includes(shipment.status)) {
          try {
            const receipt = shipment.purchaseReceipt as unknown as MarketplaceShipmentPurchaseReceipt;
            const request = shipment.request as unknown as MarketplaceShipmentRequest;
            if (!shipment.carrierOrderId || !receipt || marketplaceShippingContractHash(request) !== shipment.requestHash ||
                marketplaceShippingContractHash(receipt) !== shipment.purchaseReceiptHash || receipt.carrierPurchaseId !== shipment.carrierPurchaseId) throw Error("proof");
            assertMarketplaceShipmentPurchaseReceipt(receipt, request, shipment.carrierOrderId);
            if (["purchased", "generate_unknown", "generated"].includes(shipment.status) && !shipment.purchasedAt) throw Error("confirmation");
            if (shipment.status === "generated" || shipment.generationReceipt) {
              const generation = shipment.generationReceipt as unknown as MarketplaceShipmentGenerationReceipt;
              assertMarketplaceShipmentGenerationReceipt(generation, request, receipt, shipment.carrierOrderId);
              if (marketplaceShippingContractHash(generation) !== shipment.generationReceiptHash ||
                  shipment.status === "generated" && !shipment.generatedAt) throw Error("generation");
            }
          } catch { add("shipment_purchase_or_generation_proof_invalid", shipment.id); }
        }
      }
    }
    const recoveries = plan ? await auditMarketplaceTransferRecoveries(tx, host, plan.paymentIntentId) : { valid: new Map<string, string>(), findings: [] };
    findings.push(...recoveries.findings);
    const extinctions = plan ? await auditMarketplaceDebtPrincipalExtinctions(tx,host,plan.paymentIntentId) : {valid:new Map(),findings:[]};
    findings.push(...extinctions.findings);
    const disputeClosure = plan ? await auditMarketplaceOrderDisputeClosureCertificates(tx,host,plan.paymentIntentId)
      : {hostPrincipals:new Map<string,MarketplaceHostPrincipalExtinctionEvidence>(),orderClosed:false,findings:[]};
    findings.push(...disputeClosure.findings);
    for (const settlement of settlements) {
      const debt = await tx.marketplaceSellerDebt.findUnique({ where: { settlementId: settlement.id } });
      const payout = payouts.find(row => row.settlementId === settlement.id);
      const expectedDebt = payout?.amountCents ?? settlement.sellerNetCents;
      if ((settlement.status === "chargeback_debt" || debt) && (!debt || debt.sellerMerchantId !== settlement.sellerMerchantId ||
          debt.amountCents !== expectedDebt || expectedDebt <= 0 || !["outstanding", "deducted", "resolved", "extinguished"].includes(debt.status) ||
          (debt.status === "extinguished" && (!debt.resolvedAt || debt.recoveryId || debt.deductedFromSettlementId)) ||
          (debt.status === "resolved" && !debt.resolvedAt) || (debt.status === "deducted" && !debt.deductedFromSettlementId))) {
        add("seller_debt_missing_or_inconsistent", settlement.id);
      }
      if (debt?.status === "outstanding" && settlement.status !== "chargeback_debt") add("seller_debt_requires_reconciliation", settlement.id);
      if (debt?.status === "resolved" && (!debt.recoveryId || !payout || recoveries.valid.get(debt.recoveryId) !== payout.id)) add("seller_debt_resolution_unproven", settlement.id);
      if (debt?.status === "extinguished" && (!payout || !extinctions.valid.has(debt.id)) &&
          !extinctions.findings.some(finding=>finding.reference===debt.id)) add("seller_debt_principal_extinction_unproven", debt.id);
      if (debt?.status === "deducted" && debt.deductedFromSettlementId) {
        const target = await tx.marketplaceSettlement.findUnique({ where: { id: debt.deductedFromSettlementId } });
        if (!target || target.sellerMerchantId !== settlement.sellerMerchantId) add("seller_debt_deduction_inconsistent", settlement.id);
      }
    }
    for (const payout of payouts.filter(row => row.kind === "host_receivable")) {
      const debt = await tx.marketplaceHostDebt.findUnique({ where: { payoutId: payout.id } });
      const principalExtinguished = disputeClosure.hostPrincipals.has(payout.id);
      const required = Boolean(ledger?.chargebackAt && payout.status === "confirmed" && !principalExtinguished && ![...recoveries.valid.values()].includes(payout.id));
      if ((required || debt) && (!debt || debt.hostMerchantId !== host || debt.amountCents !== payout.amountCents || debt.amountCents <= 0 ||
          !["outstanding", "resolved", "extinguished"].includes(debt.status) ||
          (["resolved", "extinguished"].includes(debt.status) && !debt.resolvedAt) || debt.status === "extinguished" && Boolean(debt.recoveryId))) {
        add("host_debt_missing_or_inconsistent", payout.id);
      }
      if (debt?.status === "outstanding" && !required) add("host_debt_requires_reconciliation", payout.id);
      if (debt?.status === "resolved" && (!debt.recoveryId || recoveries.valid.get(debt.recoveryId) !== payout.id)) add("host_debt_resolution_unproven", payout.id);
      if (debt?.status === "extinguished" && !principalExtinguished) add("host_debt_principal_extinction_unproven", payout.id);
    }
    if (payment?.status === "chargeback_won" && !disputeClosure.orderClosed) add("won_dispute_requires_reconciliation");
    return { key: c.key, paymentIntentId: c.payment_id, orderId: order, findings };
  }
}
