import {Prisma} from "@prisma/client";
import {marketplaceDebtPrincipalExtinctionId} from "../domain/services/marketplace-debt-principal-extinction.js";
import {rebuildMarketplaceDebtPrincipalExtinction,marketplaceDebtPrincipalExtinctionFeeEvent} from "../domain/services/marketplace-debt-principal-extinction-positive-fee.js";
import {allocateMarketplaceDisputeFee,assertMarketplaceDisputeClosureProof,marketplaceDisputeClosureProofHash} from "../domain/services/marketplace-dispute-closure-evidence.js";
import type {MarketplaceDisputeClosureRequest,MarketplaceDisputeClosureProof} from "../domain/ports/marketplace-dispute-closure.port.js";
import {buildMarketplaceFundingBudget} from "../domain/services/marketplace-funding-budget.js";
import {fundingHash,type FrozenMarketplaceFunding,type FundingBudget} from "./repositories/prisma-marketplace-funding.repository.js";

type RecordValue = Record<string,any>;
export interface MarketplaceDebtExtinctionAuditRow {
  debt: RecordValue | null; certificate: RecordValue | null; payout: RecordValue | null;
  settlement: RecordValue | null; funding: RecordValue | null; ledger: RecordValue | null;
  payment: RecordValue | null; closure: RecordValue | null; native: RecordValue[];
  closure_event: RecordValue | null; extinction_event: RecordValue | null;
}
const stamp=(value:unknown):Date|null => value instanceof Date ? new Date(value) : typeof value === "string"
  ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?value:value+"Z") : null;
const same=(left:unknown,right:unknown):boolean => fundingHash(left)===fundingHash(right);
function fail():never{throw Error("marketplace_debt_principal_extinction_certificate_invalid");}
const event=(row:RecordValue|null,id:string,type:string,host:string,funding:string,causation:string,payload:unknown)=>
  Boolean(row&&row.event_id===id&&row.event_type===type&&row.merchant_id===host&&row.correlation_id===funding&&
    row.causation_id===causation&&row.producer==="marketplace"&&row.schema_version===1&&same(row.payload,payload));

/** Validate persisted historical evidence at its original observation time.
 * This does not fetch a fresh native proof or grant any funding/payout release. */
export function validateMarketplaceDebtPrincipalExtinctionRow(row:MarketplaceDebtExtinctionAuditRow,host?:string,fundingPlanId?:string) {
  const {certificate:c,debt:d,payout:p,settlement:s,funding:f,ledger:l,payment:payment,closure:closure}=row;
  if(!c||!d||!p||!s||!f||!l||!payment||!closure||!Array.isArray(row.native))fail();
  const request=closure.request as MarketplaceDisputeClosureRequest,proof=closure.proof as MarketplaceDisputeClosureProof;
  const observation=c.observation as MarketplaceDisputeClosureProof;
  assertMarketplaceDisputeClosureProof(request,proof,new Date(proof.observedAt));
  const budget=f.budget as FundingBudget,instructions=f.instructions as FrozenMarketplaceFunding;
  if((host&&f.host_merchant_id!==host)||(fundingPlanId&&f.payment_intent_id!==fundingPlanId)||
    c.host_merchant_id!==f.host_merchant_id||c.funding_plan_id!==f.payment_intent_id||c.debt_id!==d.id||c.payout_id!==p.id||
    c.seller_merchant_id!==d.seller_merchant_id||c.provider_dispute_id!==request.providerDisputeId||c.closure_snapshot_id!==closure.id||
    c.request_hash!==request.requestHash||c.proof_hash!==marketplaceDisputeClosureProofHash(proof)||
    c.proof_hash!==marketplaceDisputeClosureProofHash(observation)||closure.request_hash!==request.requestHash||closure.proof_hash!==c.proof_hash||
    closure.funding_plan_id!==f.payment_intent_id||closure.host_merchant_id!==f.host_merchant_id||closure.provider_dispute_id!==c.provider_dispute_id||
    f.provider!=="stripe"||f.environment!==request.environment||f.account_fingerprint!==request.accountFingerprint||
    f.instructions_hash!==request.instructionsHash||f.instructions_hash!==fundingHash(instructions)||request.budgetHash!==fundingHash(budget)||
    !same(buildMarketplaceFundingBudget(instructions,budget.capture),budget)||request.paymentIntentId!==f.payment_intent_id||
    request.hostMerchantId!==f.host_merchant_id||request.checkoutSessionId!==f.checkout_session_id||request.providerPaymentId!==f.provider_payment_id||
    request.sourceId!==budget.capture.sourceId||request.captureBalanceTransactionId!==budget.capture.balanceTransactionId||
    request.amountCents!==f.amount_cents||request.captureNetCents!==f.net_amount_cents||request.captureFeeCents!==f.provider_fee_cents||
    payment.id!==f.payment_intent_id||payment.merchant_id!==f.host_merchant_id||payment.session_id!==request.checkoutSessionId||
    payment.provider_payment_id!==request.providerPaymentId||payment.currency!=="BRL"||payment.amount_cents!==request.amountCents||
    payment.approved_amount_cents!==request.amountCents||l.host_merchant_id!==f.host_merchant_id||l.order_id!==request.providerPaymentId||
    !same(request.sales,instructions.lines.map(({lineItemId,sellerMerchantId,grossAmountCents,commissionCents})=>
      ({lineItemId,sellerMerchantId,grossAmountCents,commissionCents})).sort((a,b)=>a.lineItemId<b.lineItemId?-1:a.lineItemId>b.lineItemId?1:0))||
    !same(closure.fee_allocation,allocateMarketplaceDisputeFee(request,proof.providerFeeCents)))fail();
  const beneficiary=budget.beneficiaries.find(entry=>entry.merchantId===d.seller_merchant_id);
  if(!beneficiary||beneficiary.destination!==p.destination)fail();
  const expected=rebuildMarketplaceDebtPrincipalExtinction({request,proof:observation,closureSnapshotId:closure.id,
    chargebackAt:stamp(l.chargeback_at)!,beneficiaryAmountCents:beneficiary.amountCents,replay:true,
    debt:{id:d.id,sellerMerchantId:d.seller_merchant_id,settlementId:d.settlement_id,amountCents:d.amount_cents,status:d.status,
      recoveryId:d.recovery_id,resolvedAt:stamp(d.resolved_at),deductedFromSettlementId:d.deducted_from_settlement_id},
    payout:{id:p.id,fundingPlanId:p.funding_plan_id,beneficiaryMerchantId:p.beneficiary_merchant_id,settlementId:p.settlement_id,
      kind:p.kind,status:p.status,provider:p.provider,accountFingerprint:p.account_fingerprint,providerPaymentId:p.provider_payment_id,
      providerTransferId:p.provider_transfer_id,amountCents:p.amount_cents,claimedAt:stamp(p.claimed_at),reconciledAt:stamp(p.reconciled_at)},
    settlement:{id:s.id,hostMerchantId:s.host_merchant_id,sellerMerchantId:s.seller_merchant_id,orderId:s.order_id,
      status:s.status,chargebackAt:stamp(s.chargeback_at)}},c.evidence?.version,new Date(observation.observedAt));
  const evidenceHash=fundingHash(expected),certificateId=marketplaceDebtPrincipalExtinctionId(expected);
  if(c.id!==certificateId||c.amount_cents!==expected.amountCents||c.evidence_hash!==evidenceHash||!same(c.evidence,expected)||
    row.native.length!==2||new Set(row.native.map(entry=>entry.entry?.balanceTransactionId)).size!==2||
    row.native.some(entry=>entry.funding_plan_id!==f.payment_intent_id||entry.host_merchant_id!==f.host_merchant_id||
      entry.provider_dispute_id!==c.provider_dispute_id||entry.provider!==request.provider||entry.environment!==request.environment||
      entry.account_fingerprint!==request.accountFingerprint||entry.request_hash!==request.requestHash||!same(entry.request,request)||
      entry.entry_hash!==fundingHash(entry.entry)||entry.provider_balance_transaction_id!==entry.entry.balanceTransactionId||
      entry.id!==`mdispute_entry_${fundingHash([request.provider,request.environment,request.accountFingerprint,entry.entry.balanceTransactionId])}`||
      entry.proof_hash!==marketplaceDisputeClosureProofHash(entry.proof)||!proof.entries.some(value=>same(value,entry.entry))))fail();
  for(const entry of row.native){assertMarketplaceDisputeClosureProof(request,entry.proof,new Date(entry.proof.observedAt));
    if(!entry.proof.entries.some((nativeEntry:unknown)=>same(nativeEntry,entry.entry)))fail();}
  const additions=row.native.filter(entry=>entry.proof_hash===closure.proof_hash).map(entry=>entry.entry);
  const closurePayload={funding_plan_id:f.payment_intent_id,provider_dispute_id:c.provider_dispute_id,
    request_hash:request.requestHash,proof_hash:closure.proof_hash,status:"won",principal_withdrawn_cents:proof.principalWithdrawnCents,
    principal_reinstated_cents:proof.principalReinstatedCents,provider_fee_cents:proof.providerFeeCents,balance_delta_cents:proof.balanceDeltaCents,new_entry_count:additions.length,
    principal_withdrawn_delta_cents:additions.filter(entry=>entry.kind==="principal_withdrawal").reduce((sum,entry)=>sum-entry.amountCents,0),
    principal_reinstated_delta_cents:additions.filter(entry=>entry.kind==="principal_reinstatement").reduce((sum,entry)=>sum+entry.amountCents,0),
    provider_fee_delta_cents:additions.reduce((sum,entry)=>sum+entry.feeCents,0),account_balance_delta_cents:additions.reduce((sum,entry)=>sum+entry.netCents,0),
    fee_allocation:allocateMarketplaceDisputeFee(request,proof.providerFeeCents),fee_collection_state:"uncollected",hold_release_proven:false};
  const extinctionPayload={certificate_id:certificateId,debt_id:d.id,payout_id:p.id,funding_plan_id:f.payment_intent_id,
    seller_merchant_id:d.seller_merchant_id,provider_dispute_id:c.provider_dispute_id,amount_cents:d.amount_cents,evidence_hash:evidenceHash,
    reason:expected.reason,dispute_fee_cents:expected.disputeFeeCents,funding_hold_released:false,payout_reauthorized:false,
    ...marketplaceDebtPrincipalExtinctionFeeEvent(expected)};
  if(!event(row.closure_event,closure.id,"marketplace.dispute.closure_observed",f.host_merchant_id,f.payment_intent_id,c.provider_dispute_id,closurePayload)||
    !event(row.extinction_event,certificateId,"marketplace.debt.principal_extinguished",f.host_merchant_id,f.payment_intent_id,d.id,extinctionPayload))fail();
  return {certificateId,debtId:d.id as string,amountCents:expected.amountCents};
}

/** A single SELECT supplies a consistent snapshot for page audits and gauges. */
export async function auditMarketplaceDebtPrincipalExtinctions(tx:Pick<Prisma.TransactionClient,"$queryRaw">,host?:string,fundingPlanId?:string) {
  const rows=await tx.$queryRaw<MarketplaceDebtExtinctionAuditRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT c.debt_id FROM marketplace_debt_principal_extinctions c JOIN marketplace_funding_plans f ON f.payment_intent_id=c.funding_plan_id
        WHERE (${host??null}::text IS NULL OR f.host_merchant_id=${host??null}) AND (${fundingPlanId??null}::text IS NULL OR f.payment_intent_id=${fundingPlanId??null})
      UNION SELECT d.id FROM marketplace_seller_debts d JOIN marketplace_payouts p ON p.settlement_id=d.settlement_id
        JOIN marketplace_funding_plans f ON f.payment_intent_id=p.funding_plan_id WHERE d.status='extinguished'
        AND (${host??null}::text IS NULL OR f.host_merchant_id=${host??null}) AND (${fundingPlanId??null}::text IS NULL OR f.payment_intent_id=${fundingPlanId??null})
    ) SELECT to_jsonb(d) AS debt,to_jsonb(c) AS certificate,to_jsonb(p) AS payout,to_jsonb(s) AS settlement,to_jsonb(f) AS funding,
      to_jsonb(l) AS ledger,jsonb_build_object('id',payment.id,'merchant_id',payment.merchant_id,'session_id',payment.session_id,
        'provider_payment_id',payment.provider_payment_id,'currency',payment.currency,'amount_cents',payment.amount_cents,
        'approved_amount_cents',payment.approved_amount_cents) AS payment,to_jsonb(snapshot) AS closure,
      COALESCE((SELECT jsonb_agg(to_jsonb(native) ORDER BY native.id) FROM marketplace_dispute_ledger_entries native
        WHERE native.funding_plan_id=f.payment_intent_id AND native.provider_dispute_id=c.provider_dispute_id),'[]'::jsonb) AS native,
      to_jsonb(ce) AS closure_event,to_jsonb(ee) AS extinction_event
    FROM candidates candidate LEFT JOIN marketplace_seller_debts d ON d.id=candidate.debt_id
      LEFT JOIN marketplace_debt_principal_extinctions c ON c.debt_id=candidate.debt_id LEFT JOIN marketplace_payouts p ON p.settlement_id=d.settlement_id
      LEFT JOIN marketplace_settlements s ON s.id=d.settlement_id LEFT JOIN marketplace_funding_plans f ON f.payment_intent_id=p.funding_plan_id
      LEFT JOIN payment_intents payment ON payment.id=f.payment_intent_id
      LEFT JOIN marketplace_order_ledgers l ON l.host_merchant_id=f.host_merchant_id AND l.order_id=f.provider_payment_id
      LEFT JOIN marketplace_dispute_closure_snapshots snapshot ON snapshot.id=c.closure_snapshot_id
      LEFT JOIN outbox_messages ce ON ce.event_id=snapshot.id LEFT JOIN outbox_messages ee ON ee.event_id=c.id`);
  const valid=new Map<string,{certificateId:string;amountCents:number}>(),findings:Array<{code:string;reference:string}>=[];
  for(const row of rows){try{const certificate=validateMarketplaceDebtPrincipalExtinctionRow(row,host,fundingPlanId);
    if(valid.has(certificate.debtId))fail();valid.set(certificate.debtId,{certificateId:certificate.certificateId,amountCents:certificate.amountCents});
  }catch{findings.push({code:"seller_debt_principal_extinction_unproven",reference:row.debt?.id??row.certificate?.id??"unbound_principal_extinction"});}}
  return {valid,findings};
}
