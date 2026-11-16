import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { digest, fingerprintVariants, type MeasurementPlan } from "../domain/services/measurement-plan.js";
import { requiresWeeklyReview } from "./weekly-experiment-governance.js";

@Injectable()
export class ExperimentActivationService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async review(merchantId: string, experimentId: string) {
    // One consistent read snapshot; GET never freezes a plan or approves a draft.
    return this.prisma.$transaction(tx => this.reviewOn(tx, merchantId, experimentId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async reviewOn(tx: Prisma.TransactionClient, merchantId: string, experimentId: string) {
    const experiment = await tx.promptExperiment.findFirst({ where: { id: experimentId, merchantId }, include: { variants: true } });
    if (!experiment) throw new NotFoundException("EXPERIMENT_NOT_FOUND");
    const stored = await tx.experimentMeasurementPlan.findFirst({ where: { experimentId, merchantId } });
    const required = Boolean(stored) || await requiresWeeklyReview(tx as PrismaClient, merchantId);
    const plan = stored?.plan as unknown as MeasurementPlan | undefined;
    const variants = [...experiment.variants].sort((a, b) => a.id.localeCompare(b.id));
    const blockers: string[] = [];
    if (experiment.status !== "draft" || experiment.startedAt) blockers.push("EXPERIMENT_NOT_DRAFT");
    if (variants.length < 2 || variants.length > 4 || variants.filter(v => v.isControl).length !== 1
      || variants.some(v => !v.systemPrompt.trim() || !Number.isInteger(v.weight) || v.weight <= 0 || v.appliedRuleId)
      || variants.reduce((sum, v) => sum + v.weight, 0) !== 100) blockers.push("EXPERIMENT_COMMUNICATION_VARIANTS_REQUIRED");
    if (required && !stored) blockers.push("EXPERIMENT_MEASUREMENT_PLAN_REQUIRED");
    if (stored && (digest(plan) !== stored.planHash || plan?.variantFingerprint !== fingerprintVariants(variants))) {
      blockers.push("EXPERIMENT_MEASUREMENT_PLAN_CORRUPT");
    }
    if (await tx.promptExperiment.count({ where: { merchantId, status: "running", id: { not: experimentId } } })) {
      blockers.push("MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT");
    }
    const snapshot = {
      version: "communication-approval-v1", experimentId, merchantId, name: experiment.name,
      description: experiment.description, updatedAt: experiment.updatedAt.toISOString(),
      variants: variants.map(v => ({ id: v.id, name: v.name, systemPrompt: v.systemPrompt, weight: v.weight, isControl: v.isControl })),
      variantFingerprint: fingerprintVariants(variants), measurementRequired: required,
      planHash: stored?.planHash ?? null, measurementPlan: plan ?? null,
      // Both arms use their displayed instructions; this is not a promise that
      // an arbitrarily authored control reproduces every production behavior.
      scope: "reviewed_communication_variants_only", automaticPromotion: false,
    };
    return { ...snapshot, reviewHash: digest(snapshot), blockers, canApprove: blockers.length === 0 };
  }
}
