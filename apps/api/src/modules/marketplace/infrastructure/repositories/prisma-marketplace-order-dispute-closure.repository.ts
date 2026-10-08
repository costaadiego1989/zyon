import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { MarketplaceContributionActor } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceDisputeClosureProof, MarketplaceDisputeClosureRequest } from "../../domain/ports/marketplace-dispute-closure.port.js";
import type { MarketplaceHostPrincipalExtinctionEvidence, MarketplaceHostPrincipalExtinctionResult,
  MarketplaceOrderDisputeClosureEvidence, MarketplaceOrderDisputeClosureResult, MarketplaceOrderDisputeClosureContext,
  MarketplaceOrderDisputeClosureRepository } from "../../domain/ports/marketplace-order-dispute-closure.port.js";
import { allocateMarketplaceDisputeFee, assertMarketplaceDisputeClosureProof, marketplaceDisputeClosureProofHash } from "../../domain/services/marketplace-dispute-closure-evidence.js";
import { marketplaceHostPrincipalExtinctionId, marketplaceHostPrincipalExtinctionPayload,
  marketplaceOrderDisputeClosureId, marketplaceOrderDisputeClosurePayload } from "../../domain/services/marketplace-order-dispute-closure.js";
import { fundingHash, lockMarketplaceOrder } from "./prisma-marketplace-funding.repository.js";
import { PrismaMarketplaceDisputeClosureRepository } from "./prisma-marketplace-dispute-closure.repository.js";

type Anchor = { paymentIntentId: string; hostMerchantId: string; providerPaymentId: string; environment: "test" | "live"; accountFingerprint: string };
type Certificate<E> = { id: string; funding_plan_id: string; host_merchant_id: string; provider_dispute_id: string;
  closure_snapshot_id: string; evidence: E; evidence_hash: string; payout_id?: string; amount_cents?: number; valid: boolean };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const dispute = (v: unknown): v is string => typeof v === "string" && /^(dp|du)_[A-Za-z0-9_]{1,100}$/.test(v);
const same = (a: unknown, b: unknown) => fundingHash(a) === fundingHash(b);
function fail(): never { throw new ConflictException("marketplace_order_dispute_closure_unproven"); }

/** Native won evidence extinguishes principal and certifies the whole obligation
 * separately. Neither command changes original funding, payouts or the ledger. */
@Injectable()
export class PrismaMarketplaceOrderDisputeClosureRepository implements MarketplaceOrderDisputeClosureRepository {
  constructor(private readonly prisma: PrismaClient, @Optional() private readonly tenants?: TenantContextService) {}

  private missing(): never { throw new NotFoundException("marketplace_order_dispute_closure_not_found"); }
  private scoped<T>(actor: MarketplaceContributionActor, work: () => Promise<T>) {
    return this.tenants ? this.tenants.run({ merchantId: actor.merchantId, userId: actor.userId, role: "system" }, work) : work();
  }
  private async active(actor: MarketplaceContributionActor, tx: Prisma.TransactionClient | PrismaClient = this.prisma) {
    if (!id(actor?.merchantId) || !id(actor?.userId)) this.missing();
    const user = await tx.merchantUser.findFirst({ where: { id: actor.userId, merchantId: actor.merchantId,
      disabledAt: null, role: { in: ["owner", "admin"] } }, select: { id: true } });
    if (!user) this.missing();
  }
  private async withOrder<T>(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string,
    work: (tx: Prisma.TransactionClient, anchor: Anchor) => Promise<T>): Promise<T> {
    if (!id(paymentIntentId) || !dispute(providerDisputeId)) this.missing();
    const ambient = this.tenants?.get();
    if (ambient && (ambient.merchantId !== actor.merchantId || ambient.userId !== actor.userId)) this.missing();
    return this.scoped(actor, async () => {
      await this.active(actor);
      return this.prisma.$transaction(async tx => {
        await this.active(actor, tx);
        const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: actor.merchantId } });
        if (!payment?.providerPaymentId) this.missing();
        await lockMarketplaceOrder(tx, actor.merchantId, payment.providerPaymentId);
        await tx.$queryRaw`SELECT payment_intent_id FROM marketplace_funding_plans
          WHERE payment_intent_id=${paymentIntentId} AND host_merchant_id=${actor.merchantId} FOR UPDATE`;
        const plan = await tx.marketplaceFundingPlan.findUnique({ where: { paymentIntentId } });
        const current = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: actor.merchantId } });
        if (!plan || plan.hostMerchantId !== actor.merchantId || !current || current.providerPaymentId !== payment.providerPaymentId) this.missing();
        if (plan.provider !== "stripe" || plan.status !== "held" || !plan.fundedAt || !plan.budget ||
            !["test", "live"].includes(plan.environment) || plan.providerPaymentId !== current.providerPaymentId || !plan.accountFingerprint) fail();
        return work(tx, { paymentIntentId, hostMerchantId: actor.merchantId, providerPaymentId: current.providerPaymentId,
          environment: plan.environment as "test" | "live", accountFingerprint: plan.accountFingerprint });
      }, { timeout: 30_000 });
    });
  }

  async request(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    // Membership and ownership precede the native repository's original-account
    // request. That repository independently rebuilds every frozen instruction.
    await this.withOrder(actor, paymentIntentId, providerDisputeId, async () => undefined);
    return this.scoped(actor, () => new PrismaMarketplaceDisputeClosureRepository(this.prisma)
      .request(actor.merchantId, paymentIntentId, providerDisputeId));
  }

  private async hostRows(tx: Prisma.TransactionClient, a: Anchor) {
    return tx.$queryRaw<Array<Certificate<MarketplaceHostPrincipalExtinctionEvidence>>>`SELECT c.*,
      marketplace_host_principal_extinction_valid(c.payout_id) AS valid FROM marketplace_host_principal_extinctions c
      WHERE c.funding_plan_id=${a.paymentIntentId} ORDER BY c.id LIMIT 2`;
  }
  private async orderRows(tx: Prisma.TransactionClient, a: Anchor) {
    return tx.$queryRaw<Array<Certificate<MarketplaceOrderDisputeClosureEvidence>>>`SELECT c.*,
      marketplace_order_dispute_closure_valid(c.funding_plan_id) AS valid FROM marketplace_order_dispute_closures c
      WHERE c.funding_plan_id=${a.paymentIntentId} ORDER BY c.id LIMIT 2`;
  }
  private async hostEvidence(tx: Prisma.TransactionClient, payoutId: string) {
    const [row] = await tx.$queryRaw<Array<{ evidence: MarketplaceHostPrincipalExtinctionEvidence | null }>>`
      SELECT marketplace_host_principal_extinction_evidence(${payoutId}) AS evidence`;
    return row?.evidence ?? null;
  }
  private async orderEvidence(tx: Prisma.TransactionClient, paymentIntentId: string) {
    const [row] = await tx.$queryRaw<Array<{ evidence: MarketplaceOrderDisputeClosureEvidence | null }>>`
      SELECT marketplace_order_dispute_closure_evidence(${paymentIntentId}) AS evidence`;
    return row?.evidence ?? null;
  }
  private bound(e: MarketplaceHostPrincipalExtinctionEvidence | MarketplaceOrderDisputeClosureEvidence, a: Anchor, providerDisputeId: string) {
    if (![1, 2, 3].includes(e?.version) || e.reason === "stripe_host_dispute_principal_extinguished" && e.version !== 1 ||
        e.hostMerchantId !== a.hostMerchantId || e.fundingPlanId !== a.paymentIntentId ||
        e.providerDisputeId !== providerDisputeId || e.provider !== "stripe" || e.environment !== a.environment ||
        e.accountFingerprint !== a.accountFingerprint || e.providerPaymentId !== a.providerPaymentId ||
        e.fundingHoldReleased !== false || e.payoutReauthorized !== false) fail();
  }
  private async event(tx: Prisma.TransactionClient, certificateId: string, eventType: string, a: Anchor, causationId: string, payload: unknown) {
    const event = await tx.outboxMessage.findUnique({ where: { eventId: certificateId } });
    if (!event || event.eventType !== eventType || event.schemaVersion !== 1 || event.producer !== "marketplace" ||
        event.merchantId !== a.hostMerchantId || event.correlationId !== a.paymentIntentId || event.causationId !== causationId || !same(event.payload, payload)) fail();
  }
  private async hostReplay(tx: Prisma.TransactionClient, a: Anchor, providerDisputeId: string): Promise<MarketplaceHostPrincipalExtinctionResult | null> {
    const rows = await this.hostRows(tx, a);
    if (!rows.length) return null;
    if (rows.length !== 1) fail();
    const row = rows[0]!, e = row.evidence;
    this.bound(e, a, providerDisputeId);
    const expected = await this.hostEvidence(tx, e.payoutId);
    if (!expected || row.valid !== true || row.id !== marketplaceHostPrincipalExtinctionId(e) || row.payout_id !== e.payoutId ||
        row.host_merchant_id !== a.hostMerchantId || row.provider_dispute_id !== providerDisputeId || row.funding_plan_id !== a.paymentIntentId ||
        row.closure_snapshot_id !== e.closureSnapshotId || row.amount_cents !== e.amountCents ||
        row.evidence_hash !== fundingHash(e) || !same(expected, e)) fail();
    await this.event(tx, row.id, "marketplace.host_principal_extinguished", a, e.payoutId, marketplaceHostPrincipalExtinctionPayload(e));
    return this.hostResult(row.id, e, true);
  }
  private async orderReplay(tx: Prisma.TransactionClient, a: Anchor, providerDisputeId: string): Promise<MarketplaceOrderDisputeClosureResult | null> {
    const rows = await this.orderRows(tx, a);
    if (!rows.length) return null;
    if (rows.length !== 1) fail();
    const row = rows[0]!, e = row.evidence;
    this.bound(e, a, providerDisputeId);
    const expected = await this.orderEvidence(tx, a.paymentIntentId);
    if (!expected || row.valid !== true || row.id !== marketplaceOrderDisputeClosureId(e) ||
        row.host_merchant_id !== a.hostMerchantId || row.provider_dispute_id !== providerDisputeId || row.funding_plan_id !== a.paymentIntentId ||
        row.closure_snapshot_id !== e.closureSnapshotId || row.evidence_hash !== fundingHash(e) || !same(expected, e)) fail();
    await this.event(tx, row.id, "marketplace.order_dispute_closed", a, providerDisputeId, marketplaceOrderDisputeClosurePayload(e));
    return this.orderResult(row.id, a.paymentIntentId, true);
  }
  replayHostPrincipal(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    return this.withOrder(actor, paymentIntentId, providerDisputeId, (tx, a) => this.hostReplay(tx, a, providerDisputeId));
  }
  replayClosure(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    return this.withOrder(actor, paymentIntentId, providerDisputeId, (tx, a) => this.orderReplay(tx, a, providerDisputeId));
  }
  private fresh(a: Anchor, request: MarketplaceDisputeClosureRequest, proof: MarketplaceDisputeClosureProof) {
    if (request.hostMerchantId !== a.hostMerchantId || request.paymentIntentId !== a.paymentIntentId || request.providerPaymentId !== a.providerPaymentId ||
        request.provider !== "stripe" || request.environment !== a.environment || request.accountFingerprint !== a.accountFingerprint) fail();
    // Recheck freshness after advisory/funding locks have been acquired.
    try { assertMarketplaceDisputeClosureProof(request, proof, new Date()); } catch { fail(); }
    if (proof.status !== "won" || proof.principalReinstatedCents !== request.amountCents || proof.balanceDeltaCents !== -proof.providerFeeCents) fail();
  }
  private observed(e: MarketplaceHostPrincipalExtinctionEvidence | MarketplaceOrderDisputeClosureEvidence,
    a: Anchor, request: MarketplaceDisputeClosureRequest, proof: MarketplaceDisputeClosureProof) {
    this.bound(e, a, request.providerDisputeId);
    if (e.requestHash !== request.requestHash || e.proofHash !== marketplaceDisputeClosureProofHash(proof) ||
        e.instructionsHash !== request.instructionsHash || e.budgetHash !== request.budgetHash) fail();
  }
  async recordHostPrincipal(actor: MarketplaceContributionActor, request: MarketplaceDisputeClosureRequest, proof: MarketplaceDisputeClosureProof) {
    return this.withOrder(actor, request.paymentIntentId, request.providerDisputeId, async (tx, a) => {
      const replay = await this.hostReplay(tx, a, request.providerDisputeId);
      if (replay) return replay;
      this.fresh(a, request, proof);
      const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: a.paymentIntentId, kind: "host_receivable" } });
      if (payouts.length !== 1) fail();
      const evidence = await this.hostEvidence(tx, payouts[0]!.id);
      if (!evidence) fail();
      this.observed(evidence, a, request, proof);
      const certificateId = marketplaceHostPrincipalExtinctionId(evidence), evidenceHash = fundingHash(evidence);
      await tx.$executeRaw`INSERT INTO marketplace_host_principal_extinctions
        (id,payout_id,funding_plan_id,host_merchant_id,provider_dispute_id,closure_snapshot_id,amount_cents,evidence,evidence_hash,observation)
        VALUES (${certificateId},${evidence.payoutId},${a.paymentIntentId},${a.hostMerchantId},${request.providerDisputeId},
          ${evidence.closureSnapshotId},${evidence.amountCents},${JSON.stringify(evidence)}::jsonb,${evidenceHash},${JSON.stringify(proof)}::jsonb)`;
      const updated = await tx.marketplaceHostDebt.updateMany({ where: { payoutId: evidence.payoutId, hostMerchantId: a.hostMerchantId,
        status: "outstanding", recoveryId: null, resolvedAt: null }, data: { status: "extinguished", resolvedAt: new Date() } });
      if (updated.count !== 1) fail();
      await tx.outboxMessage.create({ data: { eventId: certificateId, eventType: "marketplace.host_principal_extinguished", schemaVersion: 1,
        merchantId: a.hostMerchantId, occurredAt: new Date(), correlationId: a.paymentIntentId, causationId: evidence.payoutId,
        producer: "marketplace", payload: marketplaceHostPrincipalExtinctionPayload(evidence) } });
      if (!(await this.hostReplay(tx, a, request.providerDisputeId))) fail();
      return this.hostResult(certificateId, evidence, false);
    });
  }
  async recordClosure(actor: MarketplaceContributionActor, request: MarketplaceDisputeClosureRequest, proof: MarketplaceDisputeClosureProof) {
    return this.withOrder(actor, request.paymentIntentId, request.providerDisputeId, async (tx, a) => {
      const replay = await this.orderReplay(tx, a, request.providerDisputeId);
      if (replay) return replay;
      this.fresh(a, request, proof);
      // SQL rebuilds all allocations, unique native payout receipts, seller
      // obligations and zero excess. Caller input supplies none of that evidence.
      const evidence = await this.orderEvidence(tx, a.paymentIntentId);
      if (!evidence) fail();
      this.observed(evidence, a, request, proof);
      const certificateId = marketplaceOrderDisputeClosureId(evidence), evidenceHash = fundingHash(evidence);
      await tx.$executeRaw`INSERT INTO marketplace_order_dispute_closures
        (id,funding_plan_id,host_merchant_id,provider_dispute_id,closure_snapshot_id,evidence,evidence_hash,observation)
        VALUES (${certificateId},${a.paymentIntentId},${a.hostMerchantId},${request.providerDisputeId},${evidence.closureSnapshotId},
          ${JSON.stringify(evidence)}::jsonb,${evidenceHash},${JSON.stringify(proof)}::jsonb)`;
      await tx.outboxMessage.create({ data: { eventId: certificateId, eventType: "marketplace.order_dispute_closed", schemaVersion: 1,
        merchantId: a.hostMerchantId, occurredAt: new Date(), correlationId: a.paymentIntentId, causationId: request.providerDisputeId,
        producer: "marketplace", payload: marketplaceOrderDisputeClosurePayload(evidence) } });
      if (!(await this.orderReplay(tx, a, request.providerDisputeId))) fail();
      return this.orderResult(certificateId, a.paymentIntentId, false);
    });
  }
  async context(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string): Promise<MarketplaceOrderDisputeClosureContext> {
    const original = await this.request(actor, paymentIntentId, providerDisputeId);
    return this.withOrder(actor, paymentIntentId, providerDisputeId, async (tx, a) => {
      const host = await this.hostReplay(tx, a, providerDisputeId), order = await this.orderReplay(tx, a, providerDisputeId);
      const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: a.paymentIntentId, kind: "host_receivable" } });
      if (payouts.length > 1) fail();
      const hostCandidate = payouts.length ? await this.hostEvidence(tx, payouts[0]!.id) : null;
      const candidate = await this.orderEvidence(tx, a.paymentIntentId);
      const snapshots = await tx.$queryRaw<Array<{ request: MarketplaceDisputeClosureRequest; proof: MarketplaceDisputeClosureProof; proof_hash: string }>>`
        SELECT request,proof,proof_hash FROM marketplace_dispute_closure_snapshots WHERE funding_plan_id=${paymentIntentId}
          AND host_merchant_id=${actor.merchantId} AND provider_dispute_id=${providerDisputeId} AND proof->>'status'='won' ORDER BY id LIMIT 2`;
      if (snapshots.length !== 1) fail();
      const snapshot = snapshots[0]!;
      try { assertMarketplaceDisputeClosureProof(original, snapshot.proof, new Date(snapshot.proof.observedAt)); } catch { fail(); }
      if (!same(snapshot.request, original) || snapshot.proof_hash !== marketplaceDisputeClosureProofHash(snapshot.proof)) fail();
      const hostFee = allocateMarketplaceDisputeFee(original, snapshot.proof.providerFeeCents)
        .find(row => row.sellerMerchantId === actor.merchantId)?.feeCents ?? 0;
      const [hostObligation] = payouts.length ? await tx.$queryRaw<Array<{ valid: boolean }>>`
        SELECT marketplace_host_dispute_obligation_valid(${payouts[0]!.id}) AS valid` : [];
      if (hostCandidate) this.observed(hostCandidate, a, original, snapshot.proof);
      if (candidate) this.observed(candidate, a, original, snapshot.proof);
      const hostAmount = payouts[0]?.amountCents ?? 0;
      return { fundingPlanId: paymentIntentId, providerDisputeId, environment: a.environment,
        hostPrincipalAmountCents: hostAmount, hostDisputeFeeCents: hostFee, hostPrincipalExtinguished: Boolean(host),
        ...(host ? { hostPrincipalCertificateId: host.certificateId } : {}), orderClosed: Boolean(order),
        ...(order ? { orderCertificateId: order.certificateId } : {}), canExtinguishHostPrincipal: !host && Boolean(hostCandidate),
        canCloseOrder: !order && Boolean(candidate), ...(!order && !candidate ? { blockedReason: hostFee > 0 && hostObligation?.valid !== true ? "host_dispute_fee_uncollected"
          : hostAmount > 0 && !host ? "host_principal_pending" : "order_obligations_unreconciled" } : {}),
        originalFundingStatus: "held", operationalHoldClosed: Boolean(order), fundingHoldReleased: false, payoutReauthorized: false };
    });
  }
  private hostResult(certificateId: string, e: MarketplaceHostPrincipalExtinctionEvidence, replay: boolean): MarketplaceHostPrincipalExtinctionResult {
    return { status: "extinguished", certificateId, payoutId: e.payoutId, fundingPlanId: e.fundingPlanId,
      extinguishedAmountCents: e.amountCents, hostDisputeFeeCents: e.hostDisputeFeeCents, replay, fundingHoldReleased: false, payoutReauthorized: false };
  }
  private orderResult(certificateId: string, fundingPlanId: string, replay: boolean): MarketplaceOrderDisputeClosureResult {
    return { status: "closed", certificateId, fundingPlanId, replay, originalFundingStatus: "held",
      operationalHoldClosed: true, fundingHoldReleased: false, payoutReauthorized: false };
  }
}
