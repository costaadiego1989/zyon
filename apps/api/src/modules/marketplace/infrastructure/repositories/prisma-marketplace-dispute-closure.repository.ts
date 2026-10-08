import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { MarketplaceDisputeBalanceEntry, MarketplaceDisputeClosureProof, MarketplaceDisputeClosureRepository, MarketplaceDisputeClosureRequest } from "../../domain/ports/marketplace-dispute-closure.port.js";
import { allocateMarketplaceDisputeFee, assertMarketplaceDisputeClosureProof, assertMarketplaceDisputeClosureRequest,
  marketplaceDisputeClosureProofHash } from "../../domain/services/marketplace-dispute-closure-evidence.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { fundingHash, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { marketplaceDebtPrincipalExtinctionId,
  type MarketplaceDebtPrincipalExtinctionInput, type MarketplaceDebtPrincipalExtinctionResult,
  } from "../../domain/services/marketplace-debt-principal-extinction.js";
import {rebuildMarketplaceDebtPrincipalExtinction,marketplaceDebtPrincipalExtinctionFeeEvent,
  type MarketplaceDebtPrincipalExtinctionCertificateEvidence} from "../../domain/services/marketplace-debt-principal-extinction-positive-fee.js";

function fail(): never { throw new ConflictException("marketplace_dispute_closure_reconciliation_required"); }
type LedgerEntry = { id: string; funding_plan_id: string; host_merchant_id: string; provider_dispute_id: string;
  request_hash: string; entry: MarketplaceDisputeBalanceEntry; entry_hash: string };
type Snapshot = { id: string; request_hash: string; request: MarketplaceDisputeClosureRequest; proof_hash: string;
  proof: MarketplaceDisputeClosureProof; fee_allocation: unknown };

@Injectable()
export class PrismaMarketplaceDisputeClosureRepository implements MarketplaceDisputeClosureRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async request(hostMerchantId: string, paymentIntentId: string, providerDisputeId: string): Promise<MarketplaceDisputeClosureRequest> {
    return this.prisma.$transaction(tx => this.readFrozen(tx, hostMerchantId, paymentIntentId, providerDisputeId));
  }

  async record(request: MarketplaceDisputeClosureRequest, proof: MarketplaceDisputeClosureProof) {
    return this.prisma.$transaction(async tx => {
      const current = await this.readFrozen(tx, request.hostMerchantId, request.paymentIntentId, request.providerDisputeId);
      if (fundingHash(current) !== fundingHash(request)) fail();
      // Must run after acquiring the order/funding locks, not before a possibly
      // long lock wait. A stale observation cannot append financial evidence.
      try { assertMarketplaceDisputeClosureProof(current, proof, new Date()); } catch { fail(); }
      const proofHash = marketplaceDisputeClosureProofHash(proof), feeAllocation = allocateMarketplaceDisputeFee(current, proof.providerFeeCents);
      const snapshotId = `mdispute_snapshot_${fundingHash([current.hostMerchantId, current.paymentIntentId, current.providerDisputeId, proofHash])}`;
      const history = await tx.$queryRaw<Snapshot[]>`SELECT id,request_hash,request,proof_hash,proof,fee_allocation
        FROM marketplace_dispute_closure_snapshots WHERE funding_plan_id=${current.paymentIntentId}
        AND provider_dispute_id=${current.providerDisputeId} ORDER BY created_at,id`;
      for (const row of history) {
        try { assertMarketplaceDisputeClosureProof(current, row.proof, new Date(row.proof.observedAt)); } catch { fail(); }
        if (row.request_hash !== current.requestHash || fundingHash(row.request) !== fundingHash(current) ||
            row.proof_hash !== marketplaceDisputeClosureProofHash(row.proof) ||
            fundingHash(row.fee_allocation) !== fundingHash(allocateMarketplaceDisputeFee(current, row.proof.providerFeeCents)) ||
            row.proof.status === "won" && row.proof_hash !== proofHash) fail();
      }
      const known = await tx.$queryRaw<LedgerEntry[]>`SELECT id,funding_plan_id,host_merchant_id,provider_dispute_id,request_hash,entry,entry_hash
        FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=${current.paymentIntentId} AND provider_dispute_id=${current.providerDisputeId}`;
      if (known.some(row => row.host_merchant_id !== current.hostMerchantId || row.request_hash !== current.requestHash ||
          row.entry_hash !== fundingHash(row.entry) || !proof.entries.some(entry => fundingHash(entry) === row.entry_hash))) fail();
      const additions = proof.entries.filter(entry => !known.some(row => row.entry.balanceTransactionId === entry.balanceTransactionId));
      if (history.some(row => row.id === snapshotId)) {
        if (additions.length || known.length !== proof.entries.length) fail();
        return this.result(proof, 0, true);
      }
      if (history.length && additions.length !== 1 || history.length > 1) fail();
      for (const entry of additions) {
        const entryHash = fundingHash(entry), entryId = `mdispute_entry_${fundingHash([current.provider, current.environment,
          current.accountFingerprint, entry.balanceTransactionId])}`;
        const inserted = await tx.$executeRaw`INSERT INTO marketplace_dispute_ledger_entries
          (id,funding_plan_id,host_merchant_id,provider,environment,account_fingerprint,provider_dispute_id,
           provider_balance_transaction_id,request_hash,request,proof_hash,proof,entry,entry_hash)
          VALUES (${entryId},${current.paymentIntentId},${current.hostMerchantId},'stripe',${current.environment},${current.accountFingerprint},
            ${current.providerDisputeId},${entry.balanceTransactionId},${current.requestHash},${JSON.stringify(current)}::jsonb,
            ${proofHash},${JSON.stringify(proof)}::jsonb,${JSON.stringify(entry)}::jsonb,${entryHash}) ON CONFLICT DO NOTHING`;
        if (inserted !== 1) fail();
      }
      await tx.$executeRaw`INSERT INTO marketplace_dispute_closure_snapshots
        (id,funding_plan_id,host_merchant_id,provider_dispute_id,request_hash,request,proof_hash,proof,fee_allocation,observed_at)
        VALUES (${snapshotId},${current.paymentIntentId},${current.hostMerchantId},${current.providerDisputeId},${current.requestHash},
          ${JSON.stringify(current)}::jsonb,${proofHash},${JSON.stringify(proof)}::jsonb,${JSON.stringify(feeAllocation)}::jsonb,${new Date(proof.observedAt)})`;
      await tx.outboxMessage.create({ data: { eventId: snapshotId, eventType: "marketplace.dispute.closure_observed", schemaVersion: 1,
        merchantId: current.hostMerchantId, occurredAt: new Date(), correlationId: current.paymentIntentId, causationId: current.providerDisputeId,
        producer: "marketplace", payload: { funding_plan_id: current.paymentIntentId, provider_dispute_id: current.providerDisputeId,
          request_hash: current.requestHash, proof_hash: proofHash, status: proof.status,
          principal_withdrawn_cents: proof.principalWithdrawnCents, principal_reinstated_cents: proof.principalReinstatedCents,
          provider_fee_cents: proof.providerFeeCents, balance_delta_cents: proof.balanceDeltaCents,
          new_entry_count: additions.length,
          principal_withdrawn_delta_cents: additions.filter(row => row.kind === "principal_withdrawal").reduce((sum, row) => sum - row.amountCents, 0),
          principal_reinstated_delta_cents: additions.filter(row => row.kind === "principal_reinstatement").reduce((sum, row) => sum + row.amountCents, 0),
          provider_fee_delta_cents: additions.reduce((sum, row) => sum + row.feeCents, 0),
          account_balance_delta_cents: additions.reduce((sum, row) => sum + row.netCents, 0),
          fee_allocation: feeAllocation.map(row => ({ ...row })), fee_collection_state: "uncollected", hold_release_proven: false } } });
      return this.result(proof, additions.length, false);
    });
  }

  /** The caller obtains proof through the native adapter; this method accepts no
   * payment/collection instruction and preserves every funding/payout hold. */
  async extinguishPrincipal(input: MarketplaceDebtPrincipalExtinctionInput, proof: MarketplaceDisputeClosureProof): Promise<MarketplaceDebtPrincipalExtinctionResult> {
    return this.prisma.$transaction(async tx => {
      const current = await this.readFrozen(tx,input.hostMerchantId,input.paymentIntentId,input.providerDisputeId);
      try { assertMarketplaceDisputeClosureProof(current,proof,new Date()); } catch { fail(); }
      if (proof.status !== "won" || proof.balanceDeltaCents !== -proof.providerFeeCents || !input.debtId?.trim()) fail();
      const disputes = await tx.$queryRaw<Array<{provider_dispute_id:string}>>`SELECT DISTINCT provider_dispute_id
        FROM marketplace_dispute_closure_snapshots WHERE funding_plan_id=${input.paymentIntentId}`;
      if (disputes.length !== 1 || disputes[0]!.provider_dispute_id !== input.providerDisputeId) fail();
      const [history] = await tx.$queryRaw<Snapshot[]>`SELECT id,request_hash,request,proof_hash,proof,fee_allocation
        FROM marketplace_dispute_closure_snapshots WHERE funding_plan_id=${input.paymentIntentId}
        AND provider_dispute_id=${input.providerDisputeId} AND proof_hash=${marketplaceDisputeClosureProofHash(proof)}`;
      if (!history || history.request_hash !== current.requestHash || fundingHash(history.request) !== fundingHash(current) ||
          history.proof_hash !== marketplaceDisputeClosureProofHash(history.proof) ||
          fundingHash(history.fee_allocation) !== fundingHash(allocateMarketplaceDisputeFee(current,proof.providerFeeCents))) fail();
      const event = await tx.outboxMessage.findUnique({where:{eventId:history.id}});
      const payload = event?.payload as {proof_hash?:string;request_hash?:string;fee_collection_state?:string;hold_release_proven?:boolean}|undefined;
      if (!event || event.eventType !== "marketplace.dispute.closure_observed" || event.merchantId !== input.hostMerchantId ||
          event.correlationId !== input.paymentIntentId || event.causationId !== input.providerDisputeId ||
          event.producer !== "marketplace" || event.schemaVersion !== 1 || payload?.proof_hash !== history.proof_hash ||
          payload.request_hash !== current.requestHash || payload.fee_collection_state !== "uncollected" || payload.hold_release_proven !== false) fail();
      const entries = await tx.$queryRaw<LedgerEntry[]>`SELECT id,funding_plan_id,host_merchant_id,provider_dispute_id,request_hash,entry,entry_hash
        FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=${input.paymentIntentId} AND provider_dispute_id=${input.providerDisputeId}`;
      if (entries.length !== 2 || entries.some(row=>row.host_merchant_id !== input.hostMerchantId || row.request_hash !== current.requestHash ||
          row.entry_hash !== fundingHash(row.entry) || !proof.entries.some(entry=>fundingHash(entry) === row.entry_hash))) fail();
      const [exposure] = await tx.$queryRaw<Array<{blocked:boolean}>>`SELECT
        EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=${input.paymentIntentId}) OR
        EXISTS(SELECT 1 FROM marketplace_refund_contribution_credits WHERE funding_plan_id=${input.paymentIntentId}) OR
        EXISTS(SELECT 1 FROM marketplace_contribution_checkouts WHERE funding_plan_id=${input.paymentIntentId}) OR
        EXISTS(SELECT 1 FROM marketplace_contribution_excess_liabilities WHERE funding_plan_id=${input.paymentIntentId}) AS blocked`;
      if (!exposure || exposure.blocked) fail();
      const debt = await tx.marketplaceSellerDebt.findUnique({where:{id:input.debtId}});
      const payout = debt && await tx.marketplacePayout.findUnique({where:{settlementId:debt.settlementId}});
      const settlement = debt && await tx.marketplaceSettlement.findUnique({where:{id:debt.settlementId}});
      const ledger = await tx.marketplaceOrderLedger.findUnique({where:{hostMerchantId_orderId:{hostMerchantId:input.hostMerchantId,orderId:current.providerPaymentId}}});
      const funding = await tx.marketplaceFundingPlan.findUniqueOrThrow({where:{paymentIntentId:input.paymentIntentId}});
      const beneficiary = (funding.budget as unknown as FundingBudget).beneficiaries.find(row=>row.merchantId === debt?.sellerMerchantId);
      if (!debt || !payout || !settlement || !ledger?.chargebackAt || !beneficiary) fail();
      const certificates = await tx.$queryRaw<Array<{id:string;evidence:unknown;evidence_hash:string}>>`
        SELECT id,evidence,evidence_hash FROM marketplace_debt_principal_extinctions WHERE debt_id=${input.debtId}`;
      let evidence: MarketplaceDebtPrincipalExtinctionCertificateEvidence;
      try { evidence = rebuildMarketplaceDebtPrincipalExtinction({request:current,proof,closureSnapshotId:history.id,
        chargebackAt:ledger.chargebackAt,beneficiaryAmountCents:beneficiary.amountCents,debt,payout,settlement,replay:certificates.length>0},proof.providerFeeCents===0?1:2); } catch { fail(); }
      const evidenceHash = fundingHash(evidence),certificateId = marketplaceDebtPrincipalExtinctionId(evidence);
      const eventPayload = {certificate_id:certificateId,debt_id:debt.id,payout_id:payout.id,funding_plan_id:input.paymentIntentId,
        seller_merchant_id:debt.sellerMerchantId,provider_dispute_id:input.providerDisputeId,amount_cents:debt.amountCents,
        evidence_hash:evidenceHash,reason:evidence.reason,dispute_fee_cents:evidence.disputeFeeCents,funding_hold_released:false,payout_reauthorized:false,
        ...marketplaceDebtPrincipalExtinctionFeeEvent(evidence)};
      if (certificates.length) {
        const certificate = certificates[0]!,receipt = await tx.outboxMessage.findUnique({where:{eventId:certificateId}});
        if (certificates.length !== 1 || certificate.id !== certificateId || certificate.evidence_hash !== evidenceHash ||
            fundingHash(certificate.evidence) !== evidenceHash || !receipt || receipt.merchantId !== input.hostMerchantId ||
            receipt.eventType !== "marketplace.debt.principal_extinguished" || receipt.correlationId !== input.paymentIntentId ||
            receipt.causationId !== debt.id || receipt.producer !== "marketplace" || receipt.schemaVersion !== 1 ||
            fundingHash(receipt.payload) !== fundingHash(eventPayload)) fail();
      } else {
        await tx.$executeRaw`INSERT INTO marketplace_debt_principal_extinctions
          (id,debt_id,payout_id,funding_plan_id,host_merchant_id,seller_merchant_id,provider_dispute_id,closure_snapshot_id,
           request_hash,proof_hash,amount_cents,evidence,evidence_hash,observation)
          VALUES (${certificateId},${debt.id},${payout.id},${input.paymentIntentId},${input.hostMerchantId},${debt.sellerMerchantId},
            ${input.providerDisputeId},${history.id},${current.requestHash},${history.proof_hash},${debt.amountCents},
            ${JSON.stringify(evidence)}::jsonb,${evidenceHash},${JSON.stringify(proof)}::jsonb)`;
        await tx.marketplaceSellerDebt.update({where:{id:debt.id,status:"outstanding"},data:{status:"extinguished",resolvedAt:new Date()}});
        await tx.outboxMessage.create({data:{eventId:certificateId,eventType:"marketplace.debt.principal_extinguished",schemaVersion:1,
          merchantId:input.hostMerchantId,occurredAt:new Date(),correlationId:input.paymentIntentId,causationId:debt.id,producer:"marketplace",payload:eventPayload}});
      }
      return {status:"extinguished",debtId:debt.id,certificateId,extinguishedAmountCents:debt.amountCents,
        replay:certificates.length>0,fundingHoldReleased:false,payoutReauthorized:false};
    });
  }

  private result(proof: MarketplaceDisputeClosureProof, newEntries: number, replay: boolean) {
    return { status: proof.status, principalWithdrawnCents: proof.principalWithdrawnCents,
      principalReinstatedCents: proof.principalReinstatedCents, providerFeeCents: proof.providerFeeCents, newEntries, replay };
  }

  private async readFrozen(tx: Prisma.TransactionClient, hostMerchantId: string, paymentIntentId: string, providerDisputeId: string) {
    if (!hostMerchantId?.trim() || !paymentIntentId?.trim() || !/^(dp|du)_[A-Za-z0-9_]+$/.test(providerDisputeId)) fail();
    const first = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: hostMerchantId } });
    if (!first?.providerPaymentId) fail();
    await lockMarketplaceOrder(tx, hostMerchantId, first.providerPaymentId);
    await tx.$queryRaw`SELECT payment_intent_id FROM marketplace_funding_plans WHERE payment_intent_id=${paymentIntentId} FOR UPDATE`;
    const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: hostMerchantId } });
    const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
    if (!payment || !funding || funding.provider !== "stripe" || funding.status !== "held" || !funding.fundedAt || !funding.budget ||
        !["test", "live"].includes(funding.environment) || funding.providerPaymentId !== first.providerPaymentId ||
        payment.providerPaymentId !== first.providerPaymentId || payment.sessionId !== funding.checkoutSessionId ||
        payment.currency !== "BRL" || payment.amountCents !== funding.amountCents || payment.approvedAmountCents !== funding.amountCents ||
        !["approved","chargeback_pending","chargeback_disputed","chargeback_lost","chargeback_won"].includes(payment.status)) fail();
    const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId, orderId: first.providerPaymentId } } });
    if (!ledger?.chargebackAt || !ledger.purchasedAt || ledger.checkoutSessionId !== funding.checkoutSessionId) fail();
    const instructions = funding.instructions as unknown as FrozenMarketplaceFunding, budget = funding.budget as unknown as FundingBudget;
    const creation = payment.creation as { input?: { provider?: string; providerAccountFingerprint?: string;
      marketplaceFunding?: unknown; merchantId?: string; sessionId?: string; intentId?: string;
      stripeConnectAccountId?: unknown; merchantPayoutDestination?: unknown; settlementMode?: unknown } } | null;
    if (funding.instructionsHash !== fundingHash(instructions) || !creation?.input || creation.input.provider !== "stripe" ||
        creation.input.providerAccountFingerprint !== funding.accountFingerprint || creation.input.merchantId !== hostMerchantId ||
        creation.input.sessionId !== funding.checkoutSessionId || creation.input.intentId !== paymentIntentId ||
        fundingHash(creation.input.marketplaceFunding) !== funding.instructionsHash || creation.input.stripeConnectAccountId ||
        creation.input.merchantPayoutDestination || creation.input.settlementMode || instructions.hostMerchantId !== hostMerchantId ||
        instructions.accountFingerprint !== funding.accountFingerprint || instructions.environment !== funding.environment ||
        instructions.amountCents !== funding.amountCents || budget.capture.providerPaymentId !== first.providerPaymentId) fail();
    try { if (fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget)) fail(); } catch { fail(); }
    const orders = await tx.completedOrder.findMany({ where: { merchantId: hostMerchantId, OR: [
      { externalOrderId: { in: [first.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])] } },
      { sessionId: payment.sessionId } ] }, select: { id: true, externalOrderId: true } });
    const orderIds = [...new Set([first.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : []),
      ...orders.flatMap(order => [order.id, ...(order.externalOrderId ? [order.externalOrderId] : [])])])];
    if (await tx.marketplaceRefundPlan.count({ where: { fundingPlanId: paymentIntentId } }) ||
        await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: paymentIntentId } }) ||
        await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: paymentIntentId } }) ||
        await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: paymentIntentId } }) ||
        await tx.marketplaceTransferReversal.count({ where: { OR: [{ payout: { fundingPlanId: paymentIntentId } },
          { refundPlan: { fundingPlanId: paymentIntentId } }, { residualOperation: { residualPlan: { fundingPlanId: paymentIntentId } } }] } }) ||
        await tx.return.count({ where: { merchantId: hostMerchantId, orderId: { in: orderIds },
          OR:[{status:{notIn:["REJECTED","CANCELLED"]}},{refund:{isNot:null}}] } })) fail();
    const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: paymentIntentId } });
    const beneficiaries = budget.beneficiaries.filter(row => row.amountCents > 0);
    if (payouts.length !== beneficiaries.length || new Set(payouts.map(row => row.beneficiaryMerchantId)).size !== payouts.length ||
        payouts.some(row => row.provider !== "stripe" || row.currency !== "BRL" || row.accountFingerprint !== funding.accountFingerprint ||
          row.providerPaymentId !== first.providerPaymentId || !beneficiaries.some(beneficiary => beneficiary.merchantId === row.beneficiaryMerchantId &&
            beneficiary.destination === row.destination && beneficiary.amountCents === row.amountCents) ||
          !((row.status === "planned" || row.status === "cancelled") && !row.claimedAt && !row.providerTransferId ||
            row.status === "confirmed" && /^tr_[A-Za-z0-9_]+$/.test(row.providerTransferId ?? "") && row.claimedAt && row.reconciledAt))) fail();
    const body = { version: 1 as const, hostMerchantId, paymentIntentId, checkoutSessionId: funding.checkoutSessionId,
      instructionsHash: funding.instructionsHash, budgetHash: fundingHash(budget), provider: "stripe" as const,
      environment: funding.environment as "test" | "live", accountFingerprint: funding.accountFingerprint,
      providerPaymentId: first.providerPaymentId, sourceId: budget.capture.sourceId,
      captureBalanceTransactionId: budget.capture.balanceTransactionId!, captureFeeCents: budget.capture.providerFeeCents,
      captureNetCents: budget.capture.netAmountCents, providerDisputeId, amountCents: funding.amountCents, currency: "BRL" as const,
      feePolicy: "proportional_seller_sales_v1" as const,
      sales: instructions.lines.map(({ lineItemId, sellerMerchantId, grossAmountCents, commissionCents }) => ({
        lineItemId, sellerMerchantId, grossAmountCents, commissionCents })).sort((a, b) => a.lineItemId < b.lineItemId ? -1 : a.lineItemId > b.lineItemId ? 1 : 0) };
    const request = { ...body, requestHash: fundingHash(body) };
    try { assertMarketplaceDisputeClosureRequest(request); } catch { fail(); }
    return request;
  }
}
