import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { MarketplaceContributionActor, MarketplaceContributionApproval, MarketplaceContributionCustomerProof,
  MarketplaceContributionCustomerScope, MarketplaceContributionJournal, MarketplaceRefundContributionJournalRepository } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceRefundContributionCertificate, MarketplaceRefundContributionRequest } from "../../domain/ports/marketplace-refund-contribution.port.js";
import { buildMarketplaceRefundContributionCertificate, buildMarketplaceRefundContributionPlan, buildMarketplaceRefundContributionRequest,
  marketplaceContributionHash, validMarketplaceRefundContributionRequest, type MarketplaceRefundContributionBasis } from "../../domain/services/marketplace-refund-contribution.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";

interface Row {
  id: string; funding_plan_id: string; host_merchant_id: string; refund_plan_id: string; merchant_id: string; actor_user_id: string;
  approval_hash: string; request: MarketplaceRefundContributionRequest; request_hash: string; status: MarketplaceContributionJournal["status"];
  version: number; claim_token: string | null; claimed_at: Date | null; certificate: MarketplaceRefundContributionCertificate | null;
  certificate_hash: string | null; credit_sequence: number | null;
}
function fail(message = "marketplace_contribution_unproven"): never { throw new ConflictException(message); }
const fresh = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) >= Date.now() - 300_000 && Date.parse(value) <= Date.now() + 60_000;
const inputHash = (actor: MarketplaceContributionActor, input: MarketplaceContributionApproval) => marketplaceContributionHash({ actor, approval: input });
const json = (value: unknown) => JSON.stringify(value);

function verifyRow(row: Row): MarketplaceContributionJournal {
  if (!validMarketplaceRefundContributionRequest(row.request) || row.request.requestHash !== row.request_hash || row.id !== row.request.contributionId ||
    row.funding_plan_id !== row.request.fundingPlanId || row.host_merchant_id !== row.request.hostMerchantId || row.refund_plan_id !== row.request.refundPlanId ||
    row.merchant_id !== row.request.merchantId || row.request.authorisationId !== `contribution-consent:${row.id}:${row.actor_user_id}`) fail();
  if (row.status === "credited") {
    const c = row.certificate && buildMarketplaceRefundContributionCertificate(row.request, row.certificate.proof);
    if (!c || !row.credit_sequence || marketplaceContributionHash(c) !== marketplaceContributionHash(row.certificate) ||
      c.certificateHash !== row.certificate_hash) fail();
  } else if (row.certificate || row.certificate_hash || row.credit_sequence) fail();
  return { id: row.id, hostMerchantId: row.host_merchant_id, refundPlanId: row.refund_plan_id, merchantId: row.merchant_id,
    status: row.status, version: row.version, ...(row.claim_token ? { claimToken: row.claim_token } : {}),
    request: row.request, ...(row.certificate ? { certificate: row.certificate } : {}) };
}

/** Receipt sequence is durable, never sorted by provider timestamps. The parent
 * refund repository consumes this helper under the same original order lock. */
export async function readMarketplaceRefundContributionCredits(tx: Prisma.TransactionClient,
  fundingPlanId: string): Promise<MarketplaceRefundContributionCertificate[]> {
  const rows = await tx.$queryRaw<Array<{ id: string; credit_sequence: number; certificate: MarketplaceRefundContributionCertificate;
    certificate_hash: string; request_hash: string; credit_cents: number; processing_fee_cents: number }>>`
    SELECT c.id, c.credit_sequence, c.certificate, c.certificate_hash, c.request_hash, c.credit_cents, c.processing_fee_cents
    FROM marketplace_refund_contribution_credits c JOIN marketplace_refund_contribution_journals j ON j.id=c.id
    WHERE c.funding_plan_id=${fundingPlanId} AND j.status='credited' AND j.certificate=c.certificate
      AND j.certificate_hash=c.certificate_hash AND j.credit_sequence=c.credit_sequence
    ORDER BY c.credit_sequence ASC LIMIT 2001`;
  const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM marketplace_refund_contribution_credits WHERE funding_plan_id=${fundingPlanId}`;
  if (rows.length > 2000 || Number(count[0]?.count) !== rows.length) fail();
  return rows.map((row, index) => {
    const c = row.certificate;
    const rebuilt = c && buildMarketplaceRefundContributionCertificate(c.request, c.proof);
    if (!rebuilt || row.credit_sequence !== index + 1 || c.request.fundingPlanId !== fundingPlanId || c.request.contributionId !== row.id ||
      rebuilt.certificateHash !== row.certificate_hash || c.request.requestHash !== row.request_hash || rebuilt.creditCents !== row.credit_cents ||
      rebuilt.processingFeeCents !== row.processing_fee_cents || marketplaceContributionHash(rebuilt) !== marketplaceContributionHash(c)) fail();
    return c;
  });
}

@Injectable()
export class PrismaMarketplaceRefundContributionRepository implements MarketplaceRefundContributionJournalRepository {
  constructor(private readonly prisma: PrismaClient, @Optional() private readonly tenants?: TenantContextService) {}
  withActorScope<T>(actor: MarketplaceContributionActor, refundPlanId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.scope(actor,refundPlanId,action);
  }
  withFundingBasis<T>(actor: MarketplaceContributionActor, refundPlanId: string,
    action: (tx: Prisma.TransactionClient, basis: MarketplaceRefundContributionBasis) => Promise<T>) {
    return this.scope(actor,refundPlanId,async tx=>action(tx,await this.basis(tx,refundPlanId)));
  }

  async approvalContext(actor: MarketplaceContributionActor, approval: MarketplaceContributionApproval): Promise<MarketplaceContributionCustomerScope> {
    this.validate(actor, approval);
    return this.scope(actor, approval.refundPlanId, async tx => {
      const existing = await this.row(tx, approval.contributionId);
      if (existing) {
        if (existing.approval_hash !== inputHash(actor, approval)) fail("marketplace_contribution_approval_changed");
        return this.customerScope(verifyRow(existing).request);
      }
      const basis = await this.basis(tx, approval.refundPlanId);
      return { merchantId: actor.merchantId, customerId: approval.customerId,
        environment: basis.instructions.environment, accountFingerprint: basis.instructions.accountFingerprint };
    });
  }
  async approve(actor: MarketplaceContributionActor, approval: MarketplaceContributionApproval, customer: MarketplaceContributionCustomerProof) {
    this.validate(actor, approval);
    return this.scope(actor, approval.refundPlanId, async tx => {
      const existing = await this.row(tx, approval.contributionId);
      if (existing) {
        if (existing.approval_hash !== inputHash(actor, approval)) fail("marketplace_contribution_approval_changed");
        return verifyRow(existing);
      }
      const basis = await this.basis(tx, approval.refundPlanId);
      const scope = { merchantId: actor.merchantId, customerId: approval.customerId,
        environment: basis.instructions.environment, accountFingerprint: basis.instructions.accountFingerprint };
      if (!customer || marketplaceContributionHash(this.customerScope(customer)) !== marketplaceContributionHash(scope) || !fresh(customer.observedAt)) fail("marketplace_contribution_customer_unproven");
      const open = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM marketplace_refund_contribution_journals
        WHERE funding_plan_id=${basis.fundingPlanId} AND status<>'credited' LIMIT 1`;
      if (open.length) fail("marketplace_contribution_pending_approval");
      const checkouts = await tx.$queryRaw<Array<{ id: string; request: any; status: string; payment_intent_id: string | null }>>`
        SELECT id,request,status,payment_intent_id FROM marketplace_contribution_checkouts
        WHERE funding_plan_id=${basis.fundingPlanId} AND status NOT IN ('credited','expired')`;
      if (approval.collection) {
        const checkout=checkouts.find(row=>row.id===approval.collection!.journalId);
        if (!checkout || checkout.status!=='paid' || checkout.payment_intent_id!==approval.providerPaymentIntentId ||
          checkout.request.requestHash!==approval.collection.requestHash || checkout.request.reference!==approval.collection.reference ||
          checkout.request.actorUserId!==actor.userId || checkout.request.merchantId!==actor.merchantId ||
          checkout.request.customerId!==approval.customerId || checkout.request.grossAmountCents!==approval.grossAmountCents) fail("marketplace_contribution_collection_unproven");
      } else if (checkouts.length) fail("marketplace_contribution_pending_checkout");
      await this.bindCustomer(tx, scope, customer);
      const credits = await readMarketplaceRefundContributionCredits(tx, basis.fundingPlanId);
      const request = buildMarketplaceRefundContributionRequest(basis, { merchantId: actor.merchantId,
        contributionId: approval.contributionId, customerId: approval.customerId,
        authorisationId: `contribution-consent:${approval.contributionId}:${actor.userId}`, authorisedAt: new Date().toISOString(),
        providerPaymentIntentId: approval.providerPaymentIntentId, grossAmountCents: approval.grossAmountCents }, credits);
      if (approval.collection) { request.collection=approval.collection; const {requestHash:_,...raw}=request; request.requestHash=marketplaceContributionHash(raw); }
      await this.assertNotOriginalReceipt(tx, request.providerPaymentIntentId);
      await tx.$executeRaw`INSERT INTO marketplace_refund_contribution_journals
        (id,funding_plan_id,host_merchant_id,refund_plan_id,merchant_id,actor_user_id,approval_hash,customer_id,environment,
         account_fingerprint,provider_payment_intent_id,request,request_hash,customer_proof,status)
        VALUES (${approval.contributionId},${basis.fundingPlanId},${basis.hostMerchantId},${approval.refundPlanId},${actor.merchantId},${actor.userId},
         ${inputHash(actor,approval)},${approval.customerId},${request.environment},${request.accountFingerprint},${request.providerPaymentIntentId},
         ${json(request)}::jsonb,${request.requestHash},${json(customer)}::jsonb,'approved')`;
      await this.emit(tx, actor.merchantId, { eventId: `marketplace_refund_contribution_approved_${request.contributionId}`,
        eventType: "marketplace.refund.contribution_approved", schemaVersion: 1, merchantId: actor.merchantId,
        occurredAt: new Date(), correlationId: basis.fundingPlanId, causationId: approval.refundPlanId, producer: "marketplace",
        payload: { contribution_id: request.contributionId, refund_plan_id: approval.refundPlanId, actor_user_id: actor.userId,
          gross_amount_cents: request.grossAmountCents, maximum_credit_cents: request.maximumCreditCents, request_hash: request.requestHash,
          collection_mode: "separately_authorized_receipt_import" } });
      return verifyRow((await this.row(tx, approval.contributionId))!);
    });
  }
  async get(actor: MarketplaceContributionActor, contributionId: string) {
    const row = await this.owned(actor, contributionId);
    return this.scope(actor, row.refund_plan_id, async tx => {
      const current = await this.row(tx, contributionId); if (!current || current.merchant_id !== actor.merchantId) throw new NotFoundException();
      return verifyRow(current);
    });
  }
  async claim(actor: MarketplaceContributionActor, contributionId: string) {
    const row = await this.owned(actor, contributionId);
    return this.scope(actor, row.refund_plan_id, async tx => {
      const current = await this.row(tx, contributionId); if (!current || current.merchant_id !== actor.merchantId) throw new NotFoundException();
      const operation = verifyRow(current);
      if (operation.status === "credited" || current.status === "observing" && current.claimed_at && current.claimed_at.getTime() > Date.now() - 60_000) return undefined;
      await this.assertRequest(tx, operation.request);
      const token = randomUUID();
      await tx.$executeRaw`UPDATE marketplace_refund_contribution_journals SET status='observing',version=version+1,
        claim_token=${token},claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${contributionId}`;
      return verifyRow((await this.row(tx, contributionId))!);
    });
  }
  async record(operation: MarketplaceContributionJournal, certificate: MarketplaceRefundContributionCertificate) {
    return this.hostScope(operation.hostMerchantId, () => this.prisma.$transaction(async tx => {
      const before = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: operation.request.fundingPlanId, hostMerchantId: operation.hostMerchantId } });
      if (!before?.providerPaymentId) fail(); await lockMarketplaceOrder(tx, operation.hostMerchantId, before.providerPaymentId);
      const current = await this.row(tx, operation.id); if (!current) fail();
      const owned = verifyRow(current);
      if (owned.status === "credited") {
        if (owned.certificate?.certificateHash !== certificate.certificateHash) fail("marketplace_contribution_receipt_changed");
        return owned;
      }
      this.assertLease(current, operation);
      const rebuilt = buildMarketplaceRefundContributionCertificate(operation.request, certificate.proof);
      if (!rebuilt || !fresh(certificate.proof.observedAt) || marketplaceContributionHash(rebuilt) !== marketplaceContributionHash(certificate)) fail("marketplace_contribution_receipt_unproven");
      const basis = await this.assertRequest(tx, operation.request);
      const credits = await readMarketplaceRefundContributionCredits(tx, basis.fundingPlanId);
      const plan = buildMarketplaceRefundContributionPlan(basis, [...credits, certificate]);
      await this.assertNotOriginalReceipt(tx, operation.request.providerPaymentIntentId, certificate.proof.charge.id, certificate.proof.balance.id);
      const sequence = credits.length + 1;
      await tx.$executeRaw`INSERT INTO marketplace_refund_contribution_credits
        (id,funding_plan_id,host_merchant_id,refund_plan_id,merchant_id,environment,account_fingerprint,provider_payment_intent_id,
         provider_charge_id,provider_balance_transaction_id,credit_sequence,request_hash,certificate,certificate_hash,credit_cents,processing_fee_cents,projected_plan)
        VALUES (${operation.id},${basis.fundingPlanId},${basis.hostMerchantId},${operation.refundPlanId},${operation.merchantId},
         ${operation.request.environment},${operation.request.accountFingerprint},${operation.request.providerPaymentIntentId},${certificate.proof.charge.id},
         ${certificate.proof.balance.id},${sequence},${operation.request.requestHash},${json(certificate)}::jsonb,${certificate.certificateHash},
         ${certificate.creditCents},${certificate.processingFeeCents},${json(plan)}::jsonb)`;
      if (certificate.excessLiabilityCents) await tx.$executeRaw`INSERT INTO marketplace_contribution_excess_liabilities
        (contribution_id,funding_plan_id,host_merchant_id,merchant_id,amount_cents,certificate_hash)
        VALUES (${operation.id},${basis.fundingPlanId},${basis.hostMerchantId},${operation.merchantId},${certificate.excessLiabilityCents},${certificate.certificateHash})`;
      await tx.$executeRaw`UPDATE marketplace_refund_contribution_journals SET status='credited',certificate=${json(certificate)}::jsonb,
        certificate_hash=${certificate.certificateHash},credit_sequence=${sequence},credited_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=${operation.id}`;
      await this.emit(tx, operation.merchantId, { eventId: `marketplace_refund_contribution_credited_${operation.id}`,
        eventType: "marketplace.refund.contribution_credited", schemaVersion: 1, merchantId: operation.merchantId,
        occurredAt: new Date(), correlationId: basis.fundingPlanId, causationId: operation.refundPlanId, producer: "marketplace",
        payload: { contribution_id: operation.id, refund_plan_id: operation.refundPlanId, payment_intent_id: basis.fundingPlanId,
          credited_net_cents: certificate.creditCents, processing_fee_cents: certificate.processingFeeCents,
          ...(certificate.excessLiabilityCents !== undefined ? {excess_liability_cents:certificate.excessLiabilityCents} : {}),
          certificate_hash: certificate.certificateHash, plan_hash: plan.planHash, fully_funded: plan.fullyFunded } });
      return verifyRow((await this.row(tx, operation.id))!);
    }, { timeout: 15_000 }));
  }
  async release(operation: MarketplaceContributionJournal) {
    await this.hostScope(operation.hostMerchantId, () => this.prisma.$transaction(async tx => {
      const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: operation.request.fundingPlanId, hostMerchantId: operation.hostMerchantId } });
      if (!funding?.providerPaymentId) return; await lockMarketplaceOrder(tx, operation.hostMerchantId, funding.providerPaymentId);
      await tx.$executeRaw`UPDATE marketplace_refund_contribution_journals SET status='unproven',claim_token=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=${operation.id} AND status='observing' AND version=${operation.version} AND claim_token=${operation.claimToken ?? ""}
        AND request_hash=${operation.request.requestHash}`;
    }));
  }
  async listUnresolved(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("invalid_marketplace_contribution_limit");
    const rows = await this.prisma.$queryRaw<Array<{ id: string; merchant_id: string; actor_user_id: string }>>`
      SELECT j.id,j.merchant_id,j.actor_user_id FROM marketplace_refund_contribution_journals j
      JOIN marketplace_refund_plans rp ON rp.id=j.refund_plan_id
      LEFT JOIN marketplace_refund_contribution_credits c ON c.id=j.id
      WHERE j.status IN ('approved','unproven') OR j.status='observing' AND j.claimed_at<CURRENT_TIMESTAMP-INTERVAL '60 seconds'
        OR j.status='credited' AND rp.status='blocked' AND c.projected_plan->'fullyFunded'='true'::jsonb
      ORDER BY j.updated_at ASC,j.id ASC LIMIT ${limit}`;
    return rows.map(row => ({ actor: { merchantId: row.merchant_id, userId: row.actor_user_id }, contributionId: row.id }));
  }
  private async assertRequest(tx: Prisma.TransactionClient, request: MarketplaceRefundContributionRequest) {
    const basis = await this.basis(tx, request.refundPlanId);
    const credits = await readMarketplaceRefundContributionCredits(tx, basis.fundingPlanId);
    const expected = buildMarketplaceRefundContributionRequest(basis, { merchantId: request.merchantId, contributionId: request.contributionId,
      customerId: request.customerId, authorisationId: request.authorisationId, authorisedAt: request.authorisedAt,
      providerPaymentIntentId: request.providerPaymentIntentId, grossAmountCents: request.grossAmountCents }, credits);
    if (request.collection) { expected.collection=request.collection; const {requestHash:_,...raw}=expected; expected.requestHash=marketplaceContributionHash(raw); }
    if (marketplaceContributionHash(expected) !== marketplaceContributionHash(request)) fail("marketplace_contribution_plan_changed");
    const mapping = await tx.$queryRaw<Array<{ customer_id: string }>>`SELECT customer_id FROM marketplace_refund_contribution_customers
      WHERE merchant_id=${request.merchantId} AND environment=${request.environment} AND account_fingerprint=${request.accountFingerprint}`;
    if (mapping.length !== 1 || mapping[0]!.customer_id !== request.customerId) fail("marketplace_contribution_customer_changed");
    return basis;
  }
  private async basis(tx: Prisma.TransactionClient, refundPlanId: string): Promise<MarketplaceRefundContributionBasis> {
    const refund = await tx.marketplaceRefundPlan.findUnique({ where: { id: refundPlanId }, include: { operation: true, return: true } });
    if (!refund || !["blocked", "prepared"].includes(refund.status) || refund.blockReason !== "marketplace_refund_seller_contribution_required" ||
      refund.operation && (refund.operation.status !== "planned" || refund.operation.claimedAt || refund.operation.providerOperationId) ||
      refund.return.merchantId !== refund.hostMerchantId || refund.return.status !== "INSPECTED_PASS") fail("marketplace_contribution_refund_unavailable");
    const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: refund.fundingPlanId, hostMerchantId: refund.hostMerchantId } });
    const payment = await tx.paymentIntent.findFirst({ where: { id: refund.fundingPlanId, merchantId: refund.hostMerchantId } });
    if (!funding?.providerPaymentId || funding.provider !== "stripe" || funding.status !== "held" || !funding.budget || !funding.fundedAt ||
      !payment || payment.status !== "approved" || payment.providerPaymentId !== funding.providerPaymentId || payment.currency !== "BRL" ||
      payment.amountCents !== funding.amountCents || payment.approvedAmountCents !== funding.amountCents || payment.sessionId !== funding.checkoutSessionId) fail();
    const instructions = funding.instructions as unknown as FrozenMarketplaceFunding, budget = funding.budget as unknown as FundingBudget;
    if (fundingHash(instructions) !== funding.instructionsHash || fundingHash((payment.creation as any)?.input?.marketplaceFunding) !== funding.instructionsHash ||
      instructions.hostMerchantId !== funding.hostMerchantId || instructions.provider !== funding.provider || instructions.environment !== funding.environment ||
      instructions.accountFingerprint !== funding.accountFingerprint || fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) ||
      budget.capture.providerPaymentId !== funding.providerPaymentId || budget.capture.accountFingerprint !== funding.accountFingerprint ||
      budget.capture.providerFeeCents !== funding.providerFeeCents || budget.capture.netAmountCents !== funding.netAmountCents ||
      budget.payoutTotalCents !== funding.payoutTotalCents || budget.platformRetainedCents !== funding.platformRetainedCents) fail();
    const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId: funding.hostMerchantId, orderId: funding.providerPaymentId } } });
    if (!ledger?.purchasedAt || ledger.chargebackAt || ledger.checkoutSessionId !== funding.checkoutSessionId) fail("marketplace_contribution_dispute_unresolved");
    if (await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: funding.paymentIntentId } }) ||
      await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: funding.paymentIntentId } }) ||
      await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: funding.paymentIntentId } }) ||
      await tx.marketplaceTransferReversal.count({ where: { refundPlan: { fundingPlanId: funding.paymentIntentId } } })) fail("marketplace_contribution_history_unavailable");
    const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { settlement: true }, take: 2001 });
    const expected = fundingTransferAllocations(instructions, budget);
    if (payouts.length > 2000 || payouts.length !== expected.length || new Set(payouts.map(row => JSON.stringify([row.settlement?.lineItemId ?? null, row.beneficiaryMerchantId]))).size !== payouts.length ||
      payouts.some(row => {
        const e = expected.find(value => value.lineItemId === (row.settlement?.lineItemId ?? null) && value.merchantId === row.beneficiaryMerchantId);
        return !e || row.kind !== e.kind || row.amountCents !== e.amountCents || row.status !== "planned" || row.claimedAt || row.providerTransferId ||
          row.currency !== "BRL" || row.provider !== "stripe" || row.accountFingerprint !== funding.accountFingerprint || row.providerPaymentId !== funding.providerPaymentId ||
          row.destination !== instructions.destinations.find(value => value.merchantId === row.beneficiaryMerchantId)?.destination;
      })) fail("marketplace_contribution_payout_submitted");
    const rows = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operation: true }, take: 2001 });
    rows.sort((a, b) => (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents -
      (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (rows.length > 2000 || rows.at(-1)?.id !== refund.id || rows.some((row, i) => row.hostMerchantId !== funding.hostMerchantId ||
      fundingHash(row.allocation) !== row.allocationHash || i < rows.length - 1 && (row.status !== "confirmed" || row.operation?.status !== "confirmed" ||
      !row.operation.providerOperationId || !row.operation.claimedAt || !row.operation.reconciledAt))) fail("marketplace_contribution_refund_history_changed");
    const cross = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId: funding.hostMerchantId, orderId: funding.providerPaymentId } });
    const identities = [...cross.map(row => {
      const line = budget.lines.find(value => value.lineItemId === row.id);
      if (!row.sourceVariantId || !line || line.sellerMerchantId !== row.sellerMerchantId || line.grossAmountCents !== row.unitPriceCents * row.quantity ||
        line.commissionCents !== row.commissionCents) fail("marketplace_contribution_line_changed");
      return { lineItemId: row.id, variantId: row.sourceVariantId, quantity: row.quantity };
    }), ...(instructions.hostStockItems ?? []).map(row => ({ lineItemId: row.lineItemId, variantId: row.variantId, quantity: row.quantity }))];
    const basis = { fundingPlanId: funding.paymentIntentId, hostMerchantId: funding.hostMerchantId, instructionsHash: funding.instructionsHash,
      budgetHash: fundingHash(budget), instructions, budget, identities,
      refunds: rows.map(row => ({ refundPlanId: row.id, allocationHash: row.allocationHash, allocation: row.allocation as unknown as MarketplaceRefundAllocation })) };
    buildMarketplaceRefundContributionPlan(basis, await readMarketplaceRefundContributionCredits(tx, funding.paymentIntentId));
    return basis;
  }
  private async scope<T>(actor: MarketplaceContributionActor, refundPlanId: string, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const user = await this.prisma.merchantUser.findFirst({ where: { id: actor.userId, merchantId: actor.merchantId, disabledAt: null, role: { in: ["owner", "admin"] } }, select: { id: true } });
    if (!user) throw new NotFoundException("marketplace_contribution_not_found");
    // Prove the caller using its own immutable payout, before entering host context.
    const payout = await this.prisma.marketplacePayout.findFirst({ where: { beneficiaryMerchantId: actor.merchantId,
      fundingPlan: { refunds: { some: { id: refundPlanId } } } }, include: { fundingPlan: true } });
    if (!payout?.fundingPlan?.providerPaymentId || !payout.fundingPlan.hostMerchantId) throw new NotFoundException("marketplace_contribution_not_found");
    const host = payout.fundingPlan.hostMerchantId;
    return this.hostScope(host, () => this.prisma.$transaction(async tx => {
      await lockMarketplaceOrder(tx, host, payout.fundingPlan!.providerPaymentId!);
      const anchor = await tx.marketplacePayout.findFirst({ where: { id: payout.id, beneficiaryMerchantId: actor.merchantId,
        fundingPlanId: payout.fundingPlanId, fundingPlan: { hostMerchantId: host, refunds: { some: { id: refundPlanId, hostMerchantId: host } } } } });
      if (!anchor) throw new NotFoundException("marketplace_contribution_not_found");
      return action(tx);
    }, { timeout: 15_000 }));
  }
  private hostScope<T>(merchantId: string, action: () => Promise<T>): Promise<T> {
    return this.tenants ? this.tenants.run({ merchantId, userId: "marketplace-contribution-import", role: "system" }, async () => await action()) : action();
  }
  private emit(tx: Prisma.TransactionClient, merchantId: string, data: Prisma.OutboxMessageCreateInput) {
    // PrismaPromise starts on await. Execute that await inside the seller ALS
    // context so tenant middleware cannot replace the event owner with host.
    const write = async () => await tx.outboxMessage.create({ data });
    return this.tenants ? this.tenants.run({ merchantId, userId: "marketplace-contribution-event", role: "system" }, write) : write();
  }
  private async owned(actor: MarketplaceContributionActor, id: string) {
    const rows = await this.prisma.$queryRaw<Row[]>`SELECT * FROM marketplace_refund_contribution_journals WHERE id=${id} AND merchant_id=${actor.merchantId}`;
    if (rows.length !== 1) throw new NotFoundException("marketplace_contribution_not_found"); return rows[0]!;
  }
  private async row(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM marketplace_refund_contribution_journals WHERE id=${id} FOR UPDATE`;
    return rows[0];
  }
  private customerScope(scope: MarketplaceContributionCustomerScope): MarketplaceContributionCustomerScope {
    return { merchantId: scope.merchantId, customerId: scope.customerId, environment: scope.environment, accountFingerprint: scope.accountFingerprint };
  }
  private async bindCustomer(tx: Prisma.TransactionClient, scope: MarketplaceContributionCustomerScope, proof: MarketplaceContributionCustomerProof) {
    await tx.$executeRaw`INSERT INTO marketplace_refund_contribution_customers (merchant_id,environment,account_fingerprint,customer_id,proof)
      VALUES (${scope.merchantId},${scope.environment},${scope.accountFingerprint},${scope.customerId},${json(proof)}::jsonb) ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ customer_id: string }>>`SELECT customer_id FROM marketplace_refund_contribution_customers
      WHERE merchant_id=${scope.merchantId} AND environment=${scope.environment} AND account_fingerprint=${scope.accountFingerprint}`;
    if (rows.length !== 1 || rows[0]!.customer_id !== scope.customerId) fail("marketplace_contribution_customer_changed");
  }
  private async assertNotOriginalReceipt(tx: Prisma.TransactionClient, pi: string, charge?: string, balance?: string) {
    const rows = await tx.$queryRaw<Array<{ payment_intent_id: string }>>`SELECT payment_intent_id FROM marketplace_funding_plans
      WHERE provider='stripe' AND (provider_payment_id=${pi} OR budget#>>'{capture,sourceId}'=${charge ?? ""}
        OR budget#>>'{capture,balanceTransactionId}'=${balance ?? ""}) LIMIT 1`;
    if (rows.length) fail("marketplace_contribution_original_receipt_forbidden");
    const ordinary = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM payment_intents WHERE provider_payment_id=${pi} LIMIT 1`;
    if (ordinary.length) fail("marketplace_contribution_original_receipt_forbidden");
  }
  private assertLease(row: Row, operation: MarketplaceContributionJournal) {
    if (row.status !== "observing" || !operation.claimToken || row.claim_token !== operation.claimToken || row.version !== operation.version ||
      marketplaceContributionHash(row.request) !== marketplaceContributionHash(operation.request) || operation.hostMerchantId !== row.host_merchant_id ||
      operation.merchantId !== row.merchant_id || operation.refundPlanId !== row.refund_plan_id) fail("marketplace_contribution_claim_changed");
  }
  private validate(actor: MarketplaceContributionActor, approval: MarketplaceContributionApproval) {
    if (!actor.merchantId?.trim() || !actor.userId?.trim() || approval.confirmed !== true ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(approval.contributionId) || !/^[A-Za-z0-9_-]{1,200}$/.test(approval.refundPlanId) ||
      !/^cus_[A-Za-z0-9_]+$/.test(approval.customerId) || !/^pi_[A-Za-z0-9_]+$/.test(approval.providerPaymentIntentId) ||
      !Number.isSafeInteger(approval.grossAmountCents) || approval.grossAmountCents < 1 || approval.grossAmountCents > 2_147_483_647) throw new BadRequestException("invalid_marketplace_contribution_confirmation");
  }
}
