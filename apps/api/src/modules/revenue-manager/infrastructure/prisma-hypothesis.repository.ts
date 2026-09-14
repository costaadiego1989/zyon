import type { PrismaClient, Prisma } from "@prisma/client";
import { HypothesisEntity, type HypothesisSnapshot } from "../domain/entities/hypothesis.entity.js";
import type { HypothesisRepositoryPort } from "../domain/ports/hypothesis-repository.port.js";

export class PrismaHypothesisRepository implements HypothesisRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(hypothesis: HypothesisEntity): Promise<void> {
    const snap = hypothesis.snapshot();
    // F2-T03: hypothesis_type + discount_rule_json embedded in the existing
    // templateJson column (no schema migration; backward-compat on rehydrate).
    const templateJson = {
      ...snap.template,
      hypothesis_type: snap.hypothesis_type ?? "prompt",
      ...(snap.discount_rule_json ? { discount_rule_json: snap.discount_rule_json } : {}),
    } as unknown as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${snap.merchant_id} FOR UPDATE`;
      const existing = await tx.revenueManagerHypothesis.findUnique({ where: { id: snap.id } });
      if (existing && existing.merchantId !== snap.merchant_id) throw new Error("HYPOTHESIS_NOT_FOUND");
      if (existing && snap.status !== "pending_review") {
        const expected = ["approved", "rejected"].includes(snap.status) ? "pending_review" : "approved";
        const claimed = await tx.revenueManagerHypothesis.updateMany({
          where: { id: snap.id, merchantId: snap.merchant_id, status: expected },
          data: { status: snap.status },
        });
        if (claimed.count !== 1) throw new Error("HYPOTHESIS_NOT_PENDING_REVIEW");
      }
      if (existing && snap.status === "pending_review" && existing.status !== "pending_review") return;
      await tx.revenueManagerHypothesis.upsert({
        where: { id: snap.id },
        create: {
          id: snap.id,
          merchantId: snap.merchant_id,
          observationId: snap.observation_id,
          hypothesisText: snap.hypothesis_text,
          reasoning: snap.reasoning,
          expectedLiftPercent: snap.expected_lift_percent,
          riskLevel: snap.risk_level,
          templateJson,
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
      const noticeId = `strategy:${snap.id}`;
      if (snap.status === "pending_review") {
        await tx.merchantNotification.upsert({
          where: { id: noticeId }, update: {},
          create: { id: noticeId, merchantId: snap.merchant_id, type: "ai_strategy_suggestion",
            title: "Nova estratégia para revisar", body: snap.hypothesis_text,
            metadata: { hypothesisId: snap.id, hypothesisType: snap.hypothesis_type ?? "prompt" } },
        });
      } else {
        await tx.merchantNotification.updateMany({
          where: { merchantId: snap.merchant_id, OR: [{ id: noticeId },
            { type: "ai_rule_suggestion", metadata: { path: ["hypothesisId"], equals: snap.id } }] },
          data: { read: true },
        });
      }
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
    // F2-T03: extract embedded hypothesis_type + discount_rule_json from
    // templateJson. Backward-compat: legacy snapshots lack these keys → default.
    const tpl = (rec.templateJson ?? {}) as Record<string, unknown>;
    const hypothesisType = (tpl.hypothesis_type as HypothesisSnapshot["hypothesis_type"]) ?? "prompt";
    const discountRuleJson = tpl.discount_rule_json as HypothesisSnapshot["discount_rule_json"] | undefined;
    return {
      id: rec.id,
      merchant_id: rec.merchantId,
      observation_id: rec.observationId,
      hypothesis_text: rec.hypothesisText,
      reasoning: rec.reasoning,
      expected_lift_percent: Number(rec.expectedLiftPercent),
      risk_level: rec.riskLevel as HypothesisSnapshot["risk_level"],
      template: tpl as HypothesisSnapshot["template"],
      hypothesis_type: hypothesisType,
      ...(discountRuleJson ? { discount_rule_json: discountRuleJson } : {}),
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
