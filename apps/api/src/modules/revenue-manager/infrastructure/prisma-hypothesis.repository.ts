import type { PrismaClient } from "@prisma/client";
import { HypothesisEntity, type HypothesisSnapshot } from "../domain/entities/hypothesis.entity.js";
import type { HypothesisRepositoryPort } from "../domain/ports/hypothesis-repository.port.js";

export class PrismaHypothesisRepository implements HypothesisRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(hypothesis: HypothesisEntity): Promise<void> {
    const snap = hypothesis.snapshot();
    await this.prisma.revenueManagerHypothesis.upsert({
      where: { id: snap.id },
      create: {
        id: snap.id,
        merchantId: snap.merchant_id,
        observationId: snap.observation_id,
        hypothesisText: snap.hypothesis_text,
        reasoning: snap.reasoning,
        expectedLiftPercent: snap.expected_lift_percent,
        riskLevel: snap.risk_level,
        templateJson: snap.template,
        status: snap.status,
        approvalStrategy: snap.approval_strategy,
        merchantApprovedAt: snap.merchant_approved_at ? new Date(snap.merchant_approved_at) : null,
        merchantApprovedBy: snap.merchant_approved_by ?? null,
        merchantApprovalReason: snap.merchant_approval_reason ?? null,
        rejectionReason: snap.rejection_reason ?? null,
        createdExperimentId: snap.created_experiment_id ?? null,
        experimentCreationError: snap.experiment_creation_error ?? null,
      },
      update: {
        status: snap.status,
        merchantApprovedAt: snap.merchant_approved_at ? new Date(snap.merchant_approved_at) : null,
        merchantApprovedBy: snap.merchant_approved_by ?? null,
        merchantApprovalReason: snap.merchant_approval_reason ?? null,
        rejectionReason: snap.rejection_reason ?? null,
        createdExperimentId: snap.created_experiment_id ?? null,
        experimentCreationError: snap.experiment_creation_error ?? null,
      },
    });
  }

  async findById(id: string, merchantId: string): Promise<HypothesisEntity | null> {
    const rec = await this.prisma.revenueManagerHypothesis.findUnique({
      where: { id },
    });
    if (!rec || rec.merchantId !== merchantId) return null;
    return HypothesisEntity.rehydrate(this.toDomain(rec));
  }

  async findByMerchant(merchantId: string, options?: { status?: string; limit?: number }): Promise<HypothesisEntity[]> {
    const recs = await this.prisma.revenueManagerHypothesis.findMany({
      where: { merchantId, ...(options?.status ? { status: options.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 20,
    });
    return recs.map((r) => HypothesisEntity.rehydrate(this.toDomain(r)));
  }

  async findPendingByMerchant(merchantId: string): Promise<HypothesisEntity[]> {
    return this.findByMerchant(merchantId, { status: "pending_review" });
  }

  async findByObservation(observationId: string): Promise<HypothesisEntity[]> {
    const recs = await this.prisma.revenueManagerHypothesis.findMany({
      where: { observationId },
      orderBy: { createdAt: "desc" },
    });
    return recs.map((r) => HypothesisEntity.rehydrate(this.toDomain(r)));
  }

  private toDomain(rec: {
    id: string;
    merchantId: string;
    observationId: string;
    hypothesisText: string;
    reasoning: string;
    expectedLiftPercent: unknown;
    riskLevel: string;
    templateJson: unknown;
    status: string;
    approvalStrategy: string;
    merchantApprovedAt: Date | null;
    merchantApprovedBy: string | null;
    merchantApprovalReason: string | null;
    rejectionReason: string | null;
    createdExperimentId: string | null;
    experimentCreationError: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): HypothesisSnapshot {
    return {
      id: rec.id,
      merchant_id: rec.merchantId,
      observation_id: rec.observationId,
      hypothesis_text: rec.hypothesisText,
      reasoning: rec.reasoning,
      expected_lift_percent: Number(rec.expectedLiftPercent),
      risk_level: rec.riskLevel as HypothesisSnapshot["risk_level"],
      template: rec.templateJson as HypothesisSnapshot["template"],
      status: rec.status as HypothesisSnapshot["status"],
      approval_strategy: rec.approvalStrategy as HypothesisSnapshot["approval_strategy"],
      merchant_approved_at: rec.merchantApprovedAt?.toISOString(),
      merchant_approved_by: rec.merchantApprovedBy ?? undefined,
      merchant_approval_reason: rec.merchantApprovalReason ?? undefined,
      rejection_reason: rec.rejectionReason ?? undefined,
      created_experiment_id: rec.createdExperimentId ?? undefined,
      experiment_creation_error: rec.experimentCreationError ?? undefined,
      created_at: rec.createdAt.toISOString(),
      updated_at: rec.updatedAt.toISOString(),
    };
  }
}
