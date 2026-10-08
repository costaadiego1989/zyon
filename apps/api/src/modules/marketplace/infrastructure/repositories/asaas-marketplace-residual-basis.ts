import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { buildAsaasMarketplaceResidualAllocation, buildAsaasMarketplaceResidualRequest,
  type AsaasMarketplaceResidualBasis, type AsaasMarketplaceResidualFunding,type AsaasMarketplaceResidualAllocation } from "../../domain/services/asaas-marketplace-residual.js";
import {buildAsaasMarketplaceHostRetentionAllocation,buildAsaasMarketplaceHostRetentionRequest,buildAsaasMarketplaceHostRetentionOutboundRequest} from '../../domain/services/asaas-marketplace-host-retention.js';
import type {AsaasMarketplaceHostRetentionBasis,AsaasMarketplaceHostRetentionAllocation} from '../../domain/ports/asaas-marketplace-host-retention.port.js';
import {buildMarketplaceResidualAllocation} from '../../domain/services/marketplace-residual-allocation.js';
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { readConfirmedAsaasMarketplaceRefundHistory } from "./asaas-marketplace-refund-history.js";
import { readCertifiedAsaasMarketplaceWalletReturns } from "./prisma-asaas-marketplace-wallet-return.repository.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";
import { decryptPaymentSecret } from "../../../payment/infrastructure/payment-secret-cipher.js";
import { marketplaceCaptureAccount } from "../marketplace-capture-account.js";

const fail = (reason: string): never => { throw Error(reason); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

/** Own transaction + marketplace order lock are required by callers. This
 * reconstruction is shared by preparation and one-use submission admission;
 * it does not release original payouts or certify aggregate wallet balance. */
export async function readMarketplaceAsaasResidualBasis(tx: Prisma.TransactionClient, hostMerchantId: string, fundingPlanId: string) {
  const data=await readAsaasResidualBasis(tx,hostMerchantId,fundingPlanId,5);
  return {...data,basis:data.basis as AsaasMarketplaceResidualBasis,allocation:data.allocation as AsaasMarketplaceResidualAllocation};
}
export async function readMarketplaceAsaasHostRetentionBasis(tx:Prisma.TransactionClient,hostMerchantId:string,fundingPlanId:string) {
  const data=await readAsaasResidualBasis(tx,hostMerchantId,fundingPlanId,7);
  return {...data,basis:data.basis as AsaasMarketplaceHostRetentionBasis,allocation:data.allocation as AsaasMarketplaceHostRetentionAllocation};
}
/** Choose accounting retention only when the host's own positive entitlement
 * belongs to the frozen collector. Every other self-wallet remains blocked. */
export async function readMarketplaceAsaasResidualProfileBasis(tx:Prisma.TransactionClient,hostMerchantId:string,fundingPlanId:string) {
  return readAsaasResidualBasis(tx,hostMerchantId,fundingPlanId,'auto');
}
async function readAsaasResidualBasis(tx:Prisma.TransactionClient,hostMerchantId:string,fundingPlanId:string,profile:5|7|'auto') {
  const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: fundingPlanId, hostMerchantId } });
  if (!plan?.providerPaymentId) fail("marketplace_asaas_residual_order_missing");
  await lockMarketplaceOrder(tx, hostMerchantId, plan!.providerPaymentId!);
  const payment = await tx.paymentIntent.findFirst({ where: { id: fundingPlanId, merchantId: hostMerchantId } });
  if (!plan?.budget || plan.provider !== "asaas" || plan.status !== "held" || !payment || payment.status !== "approved" ||
    !["pix","card"].includes(payment.method) || payment.amountCents !== plan.amountCents || payment.approvedAmountCents !== plan.amountCents ||
    payment.currency !== "BRL" || payment.providerPaymentId !== plan.providerPaymentId) fail("marketplace_asaas_residual_payment_unavailable");
  const p = plan!, pi = payment!, instructions = p.instructions as unknown as FrozenMarketplaceFunding,
    budget = p.budget as unknown as FundingBudget;
  const frozen = (pi.creation as unknown as { input?: { marketplaceFunding?: unknown } })?.input?.marketplaceFunding;
  if (fundingHash(instructions) !== p.instructionsHash || fundingHash(frozen) !== p.instructionsHash || instructions.provider !== "asaas" ||
    instructions.hostMerchantId !== hostMerchantId || instructions.environment !== p.environment ||
    instructions.accountFingerprint !== p.accountFingerprint || instructions.amountCents !== p.amountCents ||
    fundingHash(buildMarketplaceFundingBudget(instructions,budget.capture)) !== fundingHash(budget) ||
    budget.capture.sourceId !== p.providerPaymentId || budget.capture.providerPaymentId !== p.providerPaymentId ||
    budget.capture.accountFingerprint !== p.accountFingerprint || p.providerFeeCents !== budget.capture.providerFeeCents ||
    p.netAmountCents !== budget.capture.netAmountCents || p.platformRetainedCents !== budget.platformRetainedCents ||
    p.payoutTotalCents !== budget.payoutTotalCents) fail("marketplace_asaas_residual_budget_changed");
  const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId,orderId:p.providerPaymentId! } } });
  if (!ledger?.purchasedAt || ledger.chargebackAt) fail("marketplace_asaas_residual_dispute_unreconciled");
  if (await tx.marketplaceTransferRecovery.count({where:{fundingPlanId}}) ||
    await tx.$queryRaw<Array<{found:boolean}>>`SELECT EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=${fundingPlanId}) AS found`
      .then(rows=>rows[0]?.found === true)) fail("marketplace_asaas_residual_recovery_unreconciled");
  if (await tx.$queryRaw<Array<{found:boolean}>>`SELECT EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=${fundingPlanId}) AS found`
      .then(rows=>rows[0]?.found === true)) fail("marketplace_asaas_residual_contribution_unavailable");
  const allRefunds = await tx.marketplaceRefundPlan.findMany({where:{fundingPlanId}});
  if (!allRefunds.length || allRefunds.length>2000 || allRefunds.some(r=>r.hostMerchantId!==hostMerchantId||r.status!=="confirmed")) {
    fail("marketplace_asaas_residual_refund_unconfirmed");
  }
  const history = await readConfirmedAsaasMarketplaceRefundHistory(tx,hostMerchantId,fundingPlanId,budget.capture);
  if (history.rows.length !== allRefunds.length) fail("marketplace_asaas_residual_refund_prefix_changed");
  const payouts = await tx.marketplacePayout.findMany({where:{fundingPlanId},include:{settlement:true},orderBy:{id:"asc"}});
  const expected = fundingTransferAllocations(instructions,budget);
  if (payouts.length !== expected.length || !payouts.length || new Set(payouts.map(row=>JSON.stringify([row.settlement?.lineItemId??null,row.beneficiaryMerchantId]))).size!==payouts.length ||
    payouts.some(row=>{
      const a=expected.find(a=>a.lineItemId===(row.settlement?.lineItemId??null)&&a.merchantId===row.beneficiaryMerchantId);
      const planned=row.status==="planned"&&!row.claimedAt&&!row.providerTransferId;
      const confirmed=row.status==="confirmed"&&!!row.claimedAt&&!!row.reconciledAt&&identifier(row.providerTransferId)&&
        (!row.settlement||["transferred","finalized"].includes(row.settlement.status)&&row.settlement.providerTransferId===row.providerTransferId);
      return !a||!(planned||confirmed)||!row.dueAt||row.kind!==a.kind||row.amountCents!==a.amountCents||row.currency!=="BRL"||
        row.provider!=="asaas"||row.providerPaymentId!==p.providerPaymentId||row.accountFingerprint!==p.accountFingerprint||
        row.destination!==instructions.destinations.find(d=>d.merchantId===a.merchantId)?.destination;
    })) fail("marketplace_asaas_residual_original_payout_unavailable");
  const certified = await readCertifiedAsaasMarketplaceWalletReturns(tx,hostMerchantId,fundingPlanId,history.rows.map(r=>r.id));
  if (!certified.length) fail("marketplace_asaas_residual_return_certificate_missing");
  for (const certificate of certified) {
    const r=certificate.request;
    if (r.host.merchantId!==hostMerchantId||r.fundingPlanId!==fundingPlanId||r.instructionsHash!==p.instructionsHash||
      !history.rows.some(refund=>refund.id===r.refundPlanId&&refund.returnId===r.returnId&&refund.allocationHash===r.allocationHash)) {
      fail("marketplace_asaas_residual_return_certificate_foreign");
    }
    const event=await tx.outboxMessage.findUnique({where:{eventId:`marketplace_asaas_wallet_return_${certificate.id}`}});
    if (!event||event.eventType!=="marketplace.asaas_wallet_return.returned"||event.merchantId!==hostMerchantId||event.schemaVersion!==1||
      event.producer!=="marketplace"||event.correlationId!==fundingPlanId||event.causationId!==certificate.id||
      fundingHash(event.payload)!==fundingHash({journal_id:certificate.id,funding_plan_id:fundingPlanId,refund_plan_id:r.refundPlanId,
        payout_id:certificate.payoutId,amount_cents:certificate.amountCents,certificate_hash:certificate.certificateHash})) {
      fail("marketplace_asaas_residual_return_event_unproven");
    }
  }
  const completed=await tx.completedOrder.findMany({where:{merchantId:hostMerchantId,
    externalOrderId:{in:[p.providerPaymentId!,...(pi.commerceOrderId?[pi.commerceOrderId]:[])]}},select:{id:true}});
  const orderIds=[p.providerPaymentId!,...(pi.commerceOrderId?[pi.commerceOrderId]:[]),...completed.map(r=>r.id)];
  const returns=await tx.return.findMany({where:{merchantId:hostMerchantId,orderId:{in:orderIds}},include:{items:true,refund:true}});
  if (returns.some(r=>!["REJECTED","CANCELLED"].includes(r.status)&&!history.rows.some(refund=>refund.returnId===r.id))||
    returns.some(r=>r.refund&&!history.rows.some(refund=>refund.returnId===r.id))) fail("marketplace_asaas_residual_open_return");
  for (const refund of history.rows) {
    const returned=returns.find(r=>r.id===refund.returnId),allocation=refund.allocation as unknown as MarketplaceRefundAllocation;
    if (!returned||fundingHash(returned.items.map(r=>({variantId:r.variantId,quantity:r.quantity})).sort((a,b)=>a.variantId.localeCompare(b.variantId)))!==
      fundingHash(allocation.lines.map(r=>({variantId:r.variantId,quantity:r.quantity})).sort((a,b)=>a.variantId.localeCompare(b.variantId)))) {
      fail("marketplace_asaas_residual_return_items_changed");
    }
  }
  for (const beneficiary of budget.beneficiaries) if (
    await tx.marketplaceSellerDebt.count({where:{sellerMerchantId:beneficiary.merchantId,status:{in:["outstanding","deducted"]}}})||
    await tx.marketplaceHostDebt.count({where:{hostMerchantId:beneficiary.merchantId,status:{in:["outstanding","deducted"]}}})||
    await hasMarketplaceRecoveryExposure(tx,beneficiary.merchantId)) fail("marketplace_asaas_residual_beneficiary_exposure_unreconciled");
  const destinationAccounts:AsaasMarketplaceResidualFunding["destinationAccounts"]=[];
  const canonicalOrigin=`https://${p.environment==="test"?"api-sandbox":"api"}.asaas.com/v3`;
  for (const beneficiary of budget.beneficiaries) {
    if (!beneficiary.amountCents) continue;
    const rows=await tx.$queryRaw<Array<{merchant_id:string;provider:string;secret_cipher:string|null;wallet_id:string|null;environment:string;status:string;payouts_enabled:boolean}>>`
      SELECT merchant_id,provider,secret_cipher,wallet_id,environment,status,payouts_enabled FROM merchant_payment_connections
      WHERE merchant_id=${beneficiary.merchantId} AND provider='asaas'`;
    const row=rows[0];
    if (rows.length!==1||!row.secret_cipher||row.wallet_id!==beneficiary.destination||row.environment!==p.environment||
      row.status!=="active"||!row.payouts_enabled) fail("marketplace_asaas_residual_destination_account_unavailable");
    const key=decryptPaymentSecret(row.secret_cipher!);
    const expectedFingerprint=beneficiary.merchantId===hostMerchantId?budget.capture.accountFingerprint:
      certified.find(c=>c.request.seller.merchantId===beneficiary.merchantId)?.request.seller.accountFingerprint;
    const origin=expectedFingerprint?[canonicalOrigin,canonicalOrigin.replace(/\/v3$/,""),canonicalOrigin.replace(/\/v3$/,"/") ,canonicalOrigin+"/"]
      .find(origin=>marketplaceCaptureAccount("asaas",p.environment as "test"|"live",key,origin).accountFingerprint===expectedFingerprint):canonicalOrigin;
    if (!origin) fail("marketplace_asaas_residual_destination_account_changed");
    destinationAccounts.push({merchantId:beneficiary.merchantId,walletId:beneficiary.destination,asaasOrigin:origin!,
      connectionId:fundingHash({merchantId:row.merchant_id,provider:row.provider}),secretCipherHash:fundingHash(row.secret_cipher),
      accountFingerprint:marketplaceCaptureAccount("asaas",p.environment as "test"|"live",key,origin!).accountFingerprint});
  }
  const asaasFunding:AsaasMarketplaceResidualFunding={host:certified[0]!.request.host,paymentMethod:pi.method as "pix"|"card",destinationAccounts,
    originalPayouts:payouts.map(row=>({id:row.id,merchantId:row.beneficiaryMerchantId!,destination:row.destination,
      amountCents:row.amountCents,status:row.status as "planned"|"confirmed",...(row.providerTransferId?{providerTransferId:row.providerTransferId}:{})})),
    walletReturns:certified};
  const remaining=buildMarketplaceResidualAllocation(budget,history.allocations);
  const retain=profile===7||profile==='auto'&&remaining.beneficiaries.some(b=>b.merchantId===hostMerchantId&&b.destination===asaasFunding.host.walletId&&b.amountCents>0);
  const basis:AsaasMarketplaceResidualBasis|AsaasMarketplaceHostRetentionBasis={version:retain?7:5,fundingPlanId,instructionsHash:p.instructionsHash,budgetHash:fundingHash(budget),
    refunds:history.rows.map(r=>({refundPlanId:r.id,returnId:r.returnId,allocationHash:r.allocationHash,requestHash:r.operation!.requestHash,
      providerOperationId:r.operation!.providerOperationId!,amountCents:r.amountCents})),asaasFunding};
  const allocation=retain?buildAsaasMarketplaceHostRetentionAllocation(budget,history.allocations,asaasFunding):buildAsaasMarketplaceResidualAllocation(budget,history.allocations,asaasFunding);
  const generations=await tx.marketplaceResidualPlan.findMany({where:{fundingPlanId}});
  if (generations.length>1||generations.some(row=>row.hostMerchantId!==hostMerchantId||row.generation!==1||
    fundingHash(row.basis)!==fundingHash(basis)||row.basisHash!==fundingHash(basis)||
    fundingHash(row.allocation)!==fundingHash(allocation)||row.allocationHash!==fundingHash(allocation))) {
    fail("marketplace_asaas_residual_previous_generation_unavailable");
  }
  return {plan:p,instructions,budget,basis,allocation,generation:1,dueAt:new Date(Math.max(...payouts.map(p=>p.dueAt!.getTime())))};
}

export function buildMarketplaceAsaasHostRetentionOperationRequest(data:Awaited<ReturnType<typeof readMarketplaceAsaasHostRetentionBasis>>,
  beneficiary:{merchantId:string;destination:string;amountCents:number},basisHash:string) {
  if(basisHash!==fundingHash(data.basis)||!data.allocation.beneficiaries.some(b=>b.merchantId===beneficiary.merchantId&&b.destination===beneficiary.destination&&b.amountCents===beneficiary.amountCents)) {
    fail('marketplace_asaas_residual_operation_changed');
  }
  const retention=buildAsaasMarketplaceHostRetentionRequest({basis:data.basis,allocation:data.allocation,capture:data.budget.capture});
  return buildAsaasMarketplaceHostRetentionOutboundRequest({retention,beneficiaryMerchantId:beneficiary.merchantId});
}

export function buildMarketplaceAsaasResidualOperationRequest(data: Awaited<ReturnType<typeof readMarketplaceAsaasResidualBasis>>,
  beneficiary: {merchantId:string;destination:string;amountCents:number},basisHash:string) {
  if (basisHash!==fundingHash(data.basis)||!data.allocation.beneficiaries.some(b=>b.merchantId===beneficiary.merchantId&&
    b.destination===beneficiary.destination&&b.amountCents===beneficiary.amountCents)) fail("marketplace_asaas_residual_operation_changed");
  return buildAsaasMarketplaceResidualRequest({basis:data.basis,allocation:data.allocation,capture:data.budget.capture,
    beneficiaryMerchantId:beneficiary.merchantId});
}
