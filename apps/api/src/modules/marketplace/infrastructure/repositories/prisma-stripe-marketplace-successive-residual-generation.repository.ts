import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { StripeMarketplaceSuccessiveResidualBasis,
  StripeMarketplaceSuccessiveResidualGenerationOperation, StripeMarketplaceSuccessiveResidualGenerationRepository,
  StripeMarketplaceSuccessiveResidualGenerationObservation, StripeMarketplaceSuccessiveResidualGenerationRequest } from "../../domain/ports/stripe-marketplace-successive-residual.port.js";
import { buildStripeMarketplaceSuccessiveResidualGenerationRequest, stripeSuccessiveResidualRequests,
  validStripeSuccessiveResidualGenerationProof } from "../../domain/services/stripe-marketplace-successive-residual.js";
import { fundingHash as hash, lockMarketplaceOrder } from "./prisma-marketplace-funding.repository.js";
import { readStripeMarketplaceSuccessiveResidualBasis } from "./stripe-marketplace-successive-residual-history.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";

interface JournalRow { operation_id: string; residual_plan_id: string; host_merchant_id: string;
  version: number; status: "planned" | "unknown" | "confirmed"; request: StripeMarketplaceSuccessiveResidualGenerationRequest; request_hash: string }
export async function provisionStripeSuccessiveResidualGeneration(tx: Prisma.TransactionClient, plan: {
  id: string; fundingPlanId: string; hostMerchantId: string; generation: number; basis: unknown; basisHash: string; allocation: unknown; allocationHash: string;
}) {
  const basis = plan.basis as StripeMarketplaceSuccessiveResidualBasis;
  const request = buildStripeMarketplaceSuccessiveResidualGenerationRequest(basis, plan.id);
  if (plan.generation !== 2 || plan.hostMerchantId !== request.hostMerchantId || plan.fundingPlanId !== request.fundingPlanId ||
    plan.basisHash !== request.basisHash || plan.allocationHash !== request.allocationHash || hash(plan.allocation) !== request.allocationHash) {
    throw new ConflictException("marketplace_stripe_successive_generation_changed");
  }
  const operationId = `mresidual_cert_${hash([plan.id, request.requestHash])}`;
  await tx.$executeRaw`INSERT INTO marketplace_stripe_residual_generation_proofs
    (operation_id, residual_plan_id, funding_plan_id, host_merchant_id, request, request_hash, reference)
    VALUES (${operationId}, ${plan.id}, ${plan.fundingPlanId}, ${plan.hostMerchantId}, ${JSON.stringify(request)}::jsonb, ${request.requestHash}, ${request.reference})`;
  return { operationId, request };
}

@Injectable()
export class PrismaStripeMarketplaceSuccessiveResidualGenerationRepository implements StripeMarketplaceSuccessiveResidualGenerationRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Optional() @Inject(TenantContextService) private readonly tenants?: TenantContextService) {}
  private hostScope<T>(merchantId: string, work: () => Promise<T>): Promise<T> {
    const current = this.tenants?.get();
    if (current && current.merchantId !== merchantId) throw new ConflictException("marketplace_stripe_successive_tenant_mismatch");
    return this.tenants && !current ? this.tenants.run({ merchantId, userId: "marketplace_successive_residual", role: "system" }, work) : work();
  }
  private map(row: JournalRow): StripeMarketplaceSuccessiveResidualGenerationOperation {
    return { operationId: row.operation_id, hostMerchantId: row.host_merchant_id, residualPlanId: row.residual_plan_id,
      version: row.version, state: row.status, request: row.request };
  }
  private async lock(tx: Prisma.TransactionClient, hostMerchantId: string, residualPlanId: string) {
    const initial = await tx.marketplaceResidualPlan.findFirst({ where: { id: residualPlanId, hostMerchantId }, include: { fundingPlan: true } });
    if (!initial?.fundingPlan.providerPaymentId || (initial.basis as { version?: number }).version !== 6) return undefined;
    const payment = await tx.paymentIntent.findFirst({ where: { id: initial.fundingPlanId, merchantId: hostMerchantId } });
    if (!payment || payment.providerPaymentId !== initial.fundingPlan.providerPaymentId) return undefined;
    await lockMarketplaceOrder(tx, hostMerchantId, initial.fundingPlan.providerPaymentId);
    const plan = await tx.marketplaceResidualPlan.findFirst({ where: { id: residualPlanId, hostMerchantId }, include: { fundingPlan: true } });
    if (!plan) return undefined;
    const rows = await tx.$queryRaw<JournalRow[]>`SELECT * FROM marketplace_stripe_residual_generation_proofs
      WHERE residual_plan_id=${residualPlanId} AND host_merchant_id=${hostMerchantId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return undefined;
    const request = buildStripeMarketplaceSuccessiveResidualGenerationRequest(plan.basis as unknown as StripeMarketplaceSuccessiveResidualBasis, plan.id);
    if (row.request_hash !== request.requestHash || hash(row.request) !== hash(request)) throw new ConflictException("marketplace_stripe_successive_generation_changed");
    return { row, plan };
  }
  async claimGeneration(hostMerchantId: string, residualPlanId: string, now: Date) {
    return this.hostScope(hostMerchantId, () => this.prisma.$transaction(async tx => {
      const locked = await this.lock(tx, hostMerchantId, residualPlanId);
      if (!locked) return undefined;
      const { row, plan } = locked;
      if (row.status !== "planned") return this.map(row);
      if (plan.status !== "prepared" || plan.heldReason || plan.dueAt > now ||
        await tx.marketplaceResidualOperation.count({ where: { residualPlanId, status: { not: "confirmed" } } })) return undefined;
      const fresh = await readStripeMarketplaceSuccessiveResidualBasis(tx, hostMerchantId, plan.fundingPlanId);
      if (hash(fresh.basis) !== plan.basisHash || hash(fresh.allocation) !== plan.allocationHash) return undefined;
      const updated = await tx.$queryRaw<JournalRow[]>`UPDATE marketplace_stripe_residual_generation_proofs
        SET status='unknown',claimed_at=${now},version=version+1,updated_at=${now}
        WHERE operation_id=${row.operation_id} AND status='planned' AND version=${row.version} RETURNING *`;
      return updated[0] && this.map(updated[0]);
    }));
  }
  async recordGeneration(operation: StripeMarketplaceSuccessiveResidualGenerationOperation,
    observation: StripeMarketplaceSuccessiveResidualGenerationObservation): Promise<boolean> {
    return this.hostScope(operation.hostMerchantId, () => this.prisma.$transaction(async tx => {
      const locked = await this.lock(tx, operation.hostMerchantId, operation.residualPlanId);
      if (!locked || locked.row.operation_id !== operation.operationId || locked.row.version !== operation.version ||
        locked.row.status !== "unknown" || hash(locked.row.request) !== hash(operation.request)) return false;
      const { row, plan } = locked, now = new Date();
      let certified = observation.state === "confirmed" && validStripeSuccessiveResidualGenerationProof(row.request, observation.proof, now) &&
        plan.status === "prepared" && !plan.heldReason;
      if (certified) {
        try {
          const fresh = await readStripeMarketplaceSuccessiveResidualBasis(tx, operation.hostMerchantId, plan.fundingPlanId);
          if (hash(fresh.basis) !== plan.basisHash || hash(fresh.allocation) !== plan.allocationHash) certified = false;
        } catch { certified = false; }
      }
      if (certified && observation.state === "confirmed") {
        const operations = await tx.marketplaceResidualOperation.findMany({ where: { residualPlanId: plan.id } });
        const requests = stripeSuccessiveResidualRequests(row.request.basis);
        if (operations.length !== requests.length || operations.some(o => o.status !== "confirmed" || !o.claimedAt || !o.reconciledAt ||
          !observation.proof.transferReceipts.some(r => r.providerTransferId === o.providerTransferId && r.requestHash === o.requestHash &&
            r.sourceId === o.sourceId && r.merchantId === o.beneficiaryMerchantId && r.amountCents === o.amountCents))) certified = false;
      }
      if (!certified || observation.state !== "confirmed") {
        await tx.$executeRaw`UPDATE marketplace_stripe_residual_generation_proofs SET reconciled_at=${now},updated_at=${now},version=version+1
          WHERE operation_id=${row.operation_id} AND status='unknown' AND version=${row.version}`;
        return false;
      }
      await tx.$executeRaw`UPDATE marketplace_stripe_residual_generation_proofs SET status='confirmed',
        proof=${JSON.stringify(observation.proof)}::jsonb,proof_hash=${observation.proof.proofHash},
        reconciled_at=${now},updated_at=${now},version=version+1 WHERE operation_id=${row.operation_id} AND status='unknown' AND version=${row.version}`;
      await tx.outboxMessage.create({ data: { eventId: `marketplace_residual_generation_certified_${plan.id}`,
        eventType: "marketplace.residual.generation_certified", schemaVersion: 1, producer: "marketplace",
        merchantId: operation.hostMerchantId, correlationId: plan.fundingPlanId, causationId: row.operation_id, occurredAt: now,
        payload: { residual_plan_id: plan.id, generation: 2, payment_intent_id: plan.fundingPlanId,
          request_hash: row.request_hash, basis_hash: plan.basisHash, allocation_hash: plan.allocationHash,
          proof_hash: observation.proof.proofHash, provider_refund_id: row.request.basis.completedRefund.providerOperationId } } });
      await tx.marketplaceResidualPlan.update({ where: { id: plan.id }, data: { status: "completed" } });
      return true;
    }));
  }
  async listUnresolvedGenerations(limit: number) {
    const merchantId = this.tenants?.get()?.merchantId ?? null;
    const rows = await this.prisma.$queryRaw<Array<{ host_merchant_id: string; residual_plan_id: string }>>`
      SELECT j.host_merchant_id,j.residual_plan_id FROM marketplace_stripe_residual_generation_proofs j
      JOIN marketplace_residual_plans p ON p.id=j.residual_plan_id
      WHERE j.status IN ('planned','unknown') AND p.status='prepared' AND p.due_at<=NOW()
        AND (${merchantId}::text IS NULL OR j.host_merchant_id=${merchantId})
        AND NOT EXISTS(SELECT 1 FROM marketplace_residual_operations o WHERE o.residual_plan_id=p.id AND o.status<>'confirmed')
      ORDER BY j.created_at,j.operation_id LIMIT ${Math.min(100,Math.max(1,Math.floor(limit)||20))}`;
    return rows.map(r => ({ hostMerchantId: r.host_merchant_id, residualPlanId: r.residual_plan_id }));
  }
}
