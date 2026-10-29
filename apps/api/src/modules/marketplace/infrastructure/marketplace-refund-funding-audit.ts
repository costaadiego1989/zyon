import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundRequest } from "../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceRefundContributionCertificate } from "../domain/ports/marketplace-refund-contribution.port.js";
import { buildMarketplaceRefundContributionPlan, validMarketplaceRefundContributionRequest } from "../domain/services/marketplace-refund-contribution.js";
import type { MarketplaceRefundAllocation } from "../domain/services/marketplace-refund-allocation.js";
import { fundingHash, type FrozenMarketplaceFunding, type FundingBudget } from "./repositories/prisma-marketplace-funding.repository.js";
import { readMarketplaceRefundContributionCredits } from "./repositories/prisma-marketplace-refund-contribution.repository.js";
import { readCertifiedAsaasMarketplaceWalletReturns, type AsaasWalletReturnJournal } from "./repositories/prisma-asaas-marketplace-wallet-return.repository.js";
import { validAsaasMarketplaceWalletReturnRequest } from "./asaas-marketplace-transfer-recovery.adapter.js";
import { checkoutMetadata, validContributionCheckout, validContributionExcessProof } from "../domain/services/marketplace-contribution-checkout.js";
import type { MarketplaceContributionCheckoutRequest, MarketplaceContributionExcessRequest } from "../domain/ports/marketplace-contribution-checkout.port.js";
import { selectAsaasMarketplaceReturnedFunds } from "../domain/services/asaas-marketplace-returned-funds.js";

interface Finding { code: string; reference?: string }
interface Refund { id: string; allocationHash: string; allocation: unknown }
interface Journal {
  id: string; host_merchant_id: string; merchant_id: string; funding_plan_id: string; refund_plan_id: string;
  actor_user_id: string; request_hash: string; status: string; request: MarketplaceRefundContributionCertificate["request"];
}
interface Event { event_id: string; event_type: string; merchant_id: string; correlation_id: string; causation_id: string;
  schema_version: number; producer: string; payload: Record<string, unknown>; status: string }

/** Read-only history inspection. A missing receipt is a finding, never a repair,
 * release, or permission to submit a financial command. */
export async function auditMarketplaceRefundFundingJournals(tx: Prisma.TransactionClient, host: string, fundingPlanId: string) {
  const findings: Finding[] = [];
  const add = (code: string, reference?: string) => findings.push({ code, ...(reference ? { reference } : {}) });
  let certificates: MarketplaceRefundContributionCertificate[] = [];
  if (!await tx.paymentIntent.findFirst({ where: { id: fundingPlanId, merchantId: host }, select: { id: true } })) {
    return { certificates, findings: [{ code: "refund_funding_scope_missing" }] };
  }
  try { certificates = await readMarketplaceRefundContributionCredits(tx, fundingPlanId); }
  catch { add("refund_contribution_credit_history_invalid"); }
  const journals = await tx.$queryRaw<Journal[]>`SELECT id,host_merchant_id,merchant_id,funding_plan_id,refund_plan_id,
    actor_user_id,request_hash,status,request FROM marketplace_refund_contribution_journals
    WHERE host_merchant_id=${host} AND funding_plan_id=${fundingPlanId} ORDER BY id LIMIT 2001`;
  if (journals.length > 2000) add("refund_contribution_audit_limit_exceeded");
  for (const row of journals.slice(0, 2000)) {
    const r = row.request;
    if (!r || !validMarketplaceRefundContributionRequest(r) || r.contributionId !== row.id || r.hostMerchantId !== host ||
      r.merchantId !== row.merchant_id || r.fundingPlanId !== fundingPlanId || r.refundPlanId !== row.refund_plan_id ||
      r.requestHash !== row.request_hash || r.authorisationId !== `contribution-consent:${row.id}:${row.actor_user_id}`) {
      add("refund_contribution_journal_invalid", row.id); continue;
    }
    if (row.status !== "credited") add("refund_contribution_requires_reconciliation", row.id);
    const credit = certificates.find(c => c.request.contributionId === row.id);
    if (row.status === "credited" && (!credit || fundingHash(credit.request) !== fundingHash(r))) add("refund_contribution_certificate_missing", row.id);
    const events = await tx.$queryRaw<Event[]>`SELECT event_id,event_type,merchant_id,correlation_id,causation_id,
      schema_version,producer,payload,status FROM outbox_messages WHERE merchant_id=${row.merchant_id}
      AND event_id IN (${`marketplace_refund_contribution_approved_${row.id}`},${`marketplace_refund_contribution_credited_${row.id}`})`;
    const validEvent = (event: Event | undefined, type: string) => event && event.event_type === type && event.merchant_id === row.merchant_id &&
      event.correlation_id === fundingPlanId && event.causation_id === row.refund_plan_id && event.schema_version === 1 &&
      event.producer === "marketplace" && event.payload?.contribution_id === row.id && event.payload.refund_plan_id === row.refund_plan_id;
    const approval = events.find(e => e.event_id === `marketplace_refund_contribution_approved_${row.id}`);
    if (!validEvent(approval, "marketplace.refund.contribution_approved") || approval!.payload.request_hash !== r.requestHash ||
      approval!.payload.actor_user_id !== row.actor_user_id || approval!.payload.gross_amount_cents !== r.grossAmountCents ||
      approval!.payload.maximum_credit_cents !== r.maximumCreditCents) add("refund_contribution_approval_event_invalid", row.id);
    if (credit) {
      const event = events.find(e => e.event_id === `marketplace_refund_contribution_credited_${row.id}`);
      if (!validEvent(event, "marketplace.refund.contribution_credited") || event!.payload.certificate_hash !== credit.certificateHash ||
        event!.payload.credited_net_cents !== credit.creditCents || event!.payload.processing_fee_cents !== credit.processingFeeCents ||
        event!.payload.payment_intent_id !== fundingPlanId) add("refund_contribution_credit_event_invalid", row.id);
    }
    if (events.some(e => ["dead", "failed"].includes(e.status))) add("refund_contribution_event_delivery_failed", row.id);
  }
  const walletRows = await tx.$queryRaw<AsaasWalletReturnJournal[]>`
    SELECT * FROM marketplace_asaas_wallet_returns
    WHERE host_merchant_id=${host} AND funding_plan_id=${fundingPlanId} ORDER BY id LIMIT 2001`;
  if (walletRows.length > 2000) add("wallet_return_audit_limit_exceeded");
  for (const row of walletRows.slice(0, 2000)) {
    const r = row.request;
    if (!r || !validAsaasMarketplaceWalletReturnRequest(r) || r.requestHash !== row.request_hash || r.reference !== row.reference ||
      r.host.merchantId !== host || r.seller.merchantId !== row.seller_merchant_id || r.fundingPlanId !== fundingPlanId ||
      r.refundPlanId !== row.refund_plan_id || r.originalPayout.id !== row.payout_id || r.amountCents !== row.amount_cents ||
      r.authorization.actorId !== row.actor_id) add("wallet_return_journal_invalid", row.id);
    if (row.status !== "returned") add("wallet_return_requires_reconciliation", row.id);
  }
  for (const refundId of new Set(walletRows.slice(0, 2000).filter(r => r.status === "returned").map(r => r.refund_plan_id))) {
    try {
      const certified = await readCertifiedAsaasMarketplaceWalletReturns(tx, host, fundingPlanId, refundId);
      const expected = walletRows.filter(row => row.refund_plan_id === refundId && row.status === "returned");
      if (certified.length !== expected.length || expected.some(row => !certified.some(c => c.id === row.id))) throw Error("missing");
    } catch { add("wallet_return_certificate_or_event_invalid", refundId); }
  }
  findings.push(...await auditCollectedContributions(tx,host,fundingPlanId,certificates));
  return { certificates, findings };
}

async function auditCollectedContributions(tx: Prisma.TransactionClient,host: string,fundingPlanId: string,certificates: MarketplaceRefundContributionCertificate[]) {
  const findings: Finding[]=[];
  const add=(code:string,reference:string)=>findings.push({code,reference});
  const rows=await tx.$queryRaw<Array<{id:string;host_merchant_id:string;merchant_id:string;actor_user_id:string;refund_plan_id:string;
    request_hash:string;request:MarketplaceContributionCheckoutRequest;status:string;version:number;submitted_at:Date|null;
    session_id:string|null;payment_intent_id:string|null;observation:any}>>`
    SELECT * FROM marketplace_contribution_checkouts WHERE host_merchant_id=${host} AND funding_plan_id=${fundingPlanId} ORDER BY id LIMIT 2001`;
  if(rows.length>2000)add("contribution_checkout_audit_limit_exceeded",fundingPlanId);
  for(const row of rows.slice(0,2000)) {
    const r=row.request;
    if(!r || !validContributionCheckout(r) || r.contributionId!==row.id || r.hostMerchantId!==host || r.fundingPlanId!==fundingPlanId ||
      r.merchantId!==row.merchant_id || r.actorUserId!==row.actor_user_id || r.refundPlanId!==row.refund_plan_id || r.requestHash!==row.request_hash) {
      add("contribution_checkout_journal_invalid",row.id);continue;
    }
    if(!["credited","expired"].includes(row.status))add("contribution_checkout_requires_reconciliation",row.id);
    const events=await tx.$queryRaw<Event[]>`SELECT event_id,event_type,merchant_id,correlation_id,causation_id,schema_version,producer,payload,status
      FROM outbox_messages WHERE merchant_id=${row.merchant_id} AND event_id IN (
        ${`marketplace_contribution_checkout_approved_${row.id}`},${`marketplace_contribution_checkout_submitted_${row.id}`},
        ${`marketplace_contribution_checkout_paid_${row.id}`},${`marketplace_contribution_checkout_expired_${row.id}`},
        ${`marketplace_contribution_checkout_excess_returned_${row.id}`})`;
    const event=(suffix:string,type=`marketplace.contribution_checkout_${suffix}`)=>{
      const e=events.find(v=>v.event_id===`marketplace_contribution_checkout_${suffix}_${row.id}`);
      return e && e.event_type===type && e.merchant_id===row.merchant_id && e.correlation_id===fundingPlanId && e.causation_id===row.refund_plan_id &&
        e.schema_version===1 && e.producer==="marketplace" && e.payload.contribution_id===row.id && e.payload.refund_plan_id===row.refund_plan_id &&
        e.payload.request_hash===r.requestHash ? e : undefined;
    };
    const localCancellation=row.status==="expired" && row.version===0 && row.submitted_at===null && row.session_id===null &&
      row.payment_intent_id===null && row.observation?.reason==="unsubmitted_approval_cancelled" && row.observation.requestHash===r.requestHash;
    const approval=event("approved");
    if(!approval || approval.payload.gross_amount_cents!==r.grossAmountCents || approval.payload.maximum_credit_cents!==r.maximumCreditCents ||
      row.status!=="approved" && !localCancellation && !event("submitted") || ["paid","credited"].includes(row.status) && !event("paid") ||
      row.status==="expired" && (!event("expired") || localCancellation && event("expired")!.payload.reason!=="unsubmitted_approval_cancelled"))
      add("contribution_checkout_event_invalid",row.id);
    if(["paid","credited","expired","open"].includes(row.status) && !localCancellation) {
      const s=row.observation?.session;
      if(!s || s.id!==row.session_id || s.customer!==r.customerId || s.amount_total!==r.grossAmountCents || s.client_reference_id!==r.reference ||
        s.currency!=="brl" || s.livemode!==(r.environment==="live") || fundingHash(s.metadata)!==fundingHash(checkoutMetadata(r)) ||
        ["paid","credited"].includes(row.status) && (s.status!=="complete" || s.payment_status!=="paid" || s.payment_intent!==row.payment_intent_id) ||
        row.status==="expired" && (s.status!=="expired" || s.payment_status!=="unpaid")) add("contribution_checkout_receipt_invalid",row.id);
    }
    const c=certificates.find(v=>v.request.contributionId===row.id);
    if(row.status==="credited" && (!c || c.request.collection?.journalId!==row.id || c.request.collection.requestHash!==r.requestHash ||
      c.request.collection.reference!==r.reference || c.request.providerPaymentIntentId!==row.payment_intent_id ||
      c.request.grossAmountCents!==r.grossAmountCents || c.request.maximumCreditCents!==r.maximumCreditCents || c.request.customerId!==r.customerId))
      add("contribution_checkout_credit_invalid",row.id);
    const liabilities=await tx.$queryRaw<Array<{contribution_id:string;funding_plan_id:string;host_merchant_id:string;merchant_id:string;amount_cents:number;
      returned_cents:number;certificate_hash:string;status:string;request:MarketplaceContributionExcessRequest|null;request_hash:string|null;
      provider_refund_id:string|null;proof:unknown;returned_at:Date|null}>>`SELECT * FROM marketplace_contribution_excess_liabilities WHERE contribution_id=${row.id}`;
    const l=liabilities[0],excess=c?.excessLiabilityCents??0;
    if(excess>0 && (!l || liabilities.length!==1 || l.amount_cents!==excess || l.certificate_hash!==c!.certificateHash || l.merchant_id!==row.merchant_id ||
      l.host_merchant_id!==host || l.funding_plan_id!==fundingPlanId) || excess===0 && liabilities.length) {
      add("contribution_excess_liability_invalid",row.id);continue;
    }
    if(l) {
      if(l.status!=="returned")add("contribution_excess_requires_reconciliation",row.id);
      else {
        const e=event("excess_returned","marketplace.contribution_excess_returned");
        if(!l.request || l.request.requestHash!==l.request_hash || fundingHash(l.request.certificate)!==fundingHash(c) || !l.returned_at ||
          l.returned_cents!==excess || !validContributionExcessProof(l.request,{state:"confirmed",amountCents:l.returned_cents,
            providerRefundId:l.provider_refund_id??undefined,proof:l.proof},false) || !e || e.payload.returned_excess_cents!==excess ||
          e.payload.refund_request_hash!==l.request_hash)add("contribution_excess_return_proof_invalid",row.id);
      }
    }
    if(events.some(e=>["dead","failed"].includes(e.status)))add("contribution_checkout_event_delivery_failed",row.id);
  }
  return findings;
}

/** Replay the immutable prefix at the time this refund was prepared. Later
 * credits never invalidate an earlier certificate or lend it another cent. */
export async function assertAuditedMarketplaceRefundFunding(tx: Prisma.TransactionClient, input: {
  host: string; fundingPlanId: string; instructionsHash: string; instructions: FrozenMarketplaceFunding;
  budget: FundingBudget; refunds: Refund[]; certificates: MarketplaceRefundContributionCertificate[]; request: MarketplaceRefundRequest;
}) {
  const { request, budget } = input;
  if (request.fundingContributions && request.asaasWalletReturns) throw Error("mixed_refund_funding");
  if (request.fundingContributions) {
    if (request.provider !== "stripe") throw Error("contribution_provider");
    const lines = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId: input.host, orderId: budget.capture.providerPaymentId } });
    const identities = [...lines.map(row => {
      const original = budget.lines.find(line => line.lineItemId === row.id);
      if (!original || !row.sourceVariantId || original.sellerMerchantId !== row.sellerMerchantId ||
        original.grossAmountCents !== row.unitPriceCents * row.quantity || original.commissionCents !== row.commissionCents) throw Error("line");
      return { lineItemId: row.id, variantId: row.sourceVariantId, quantity: row.quantity };
    }), ...(input.instructions.hostStockItems ?? []).map(row => ({ lineItemId: row.lineItemId, variantId: row.variantId, quantity: row.quantity }))];
    const prefix = input.certificates.filter(c => input.refunds.some(r => r.id === c.request.refundPlanId));
    const plan = buildMarketplaceRefundContributionPlan({ fundingPlanId: input.fundingPlanId, hostMerchantId: input.host,
      instructionsHash: input.instructionsHash, budgetHash: fundingHash(budget), instructions: input.instructions, budget, identities,
      refunds: input.refunds.map(row => ({ refundPlanId: row.id, allocationHash: row.allocationHash, allocation: row.allocation as MarketplaceRefundAllocation })) }, prefix);
    if (!plan.fullyFunded || plan.planHash !== request.fundingContributions.planHash ||
      plan.contributedNetCents !== request.fundingContributions.contributedNetCents ||
      fundingHash(prefix) !== fundingHash(request.fundingContributions.certificates)) throw Error("contribution_prefix");
  }
  if (request.asaasWalletReturns) {
    if (request.provider !== "asaas" || !request.asaasWalletReturns.length || !input.refunds.length ||
      request.previousRefunds.length !== input.refunds.length - 1 ||
      input.refunds.reduce((sum, row) => sum + (row.allocation as MarketplaceRefundAllocation).amountCents, 0) > budget.capture.netAmountCents) throw Error("wallet_return_scope");
    const certified = await readCertifiedAsaasMarketplaceWalletReturns(tx, input.host, input.fundingPlanId, input.refunds.map(row => row.id));
    if (new Set(request.asaasWalletReturns.map(c => c.id)).size !== request.asaasWalletReturns.length || request.asaasWalletReturns.some(c => {
      const receipt = certified.find(r => r.id === c.id);
      return !receipt || receipt.payoutId !== c.payoutId || receipt.certificateHash !== c.certificateHash ||
        fundingHash(receipt.request) !== fundingHash(c.request) || fundingHash(receipt.proof) !== fundingHash(c.proof);
    })) throw Error("wallet_return_proof");
    const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: input.fundingPlanId } });
    const allocations = input.refunds.map(row => row.allocation as MarketplaceRefundAllocation);
    const selected = selectAsaasMarketplaceReturnedFunds({ netAmountCents: budget.capture.netAmountCents,
      allocation: allocations.at(-1)!, previous: allocations.slice(0, -1), payouts,
      returns: certified.map(row => ({ id: row.id, payoutId: row.payoutId, amountCents: row.amountCents,
        sellerMerchantId: row.request.seller.merchantId, originalProviderTransferId: row.request.originalPayout.providerTransferId })) });
    if (!selected || fundingHash(selected) !== fundingHash(request.asaasWalletReturns.map(row => row.id).sort())) throw Error("wallet_return_cumulative_budget");
  }
}
