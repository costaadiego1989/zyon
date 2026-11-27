import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { buildMeasurementPlan, digest, fingerprintVariants, type MeasurementPlan } from "../domain/services/measurement-plan.js";
import { requiresWeeklyReview } from "./weekly-experiment-governance.js";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { createExperimentEventEnvelope } from "../domain/events/experiment-domain-event.js";

@Injectable()
export class ExperimentActivationService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async review(merchantId: string, experimentId: string) {
    // One consistent read snapshot; GET never freezes a plan or approves a draft.
    return this.prisma.$transaction(tx => this.reviewOn(tx, merchantId, experimentId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async activate(principal: TenantPrincipal, experimentId: string, input: {
    expected_review_hash: string; request_key: string; acknowledged: true;
  }) {
    if (principal.kind !== "human" || !["owner", "admin"].includes(principal.role)) {
      throw new ForbiddenException("EXPERIMENT_HUMAN_APPROVAL_REQUIRED");
    }
    if (!input || input.acknowledged !== true || !/^[a-f0-9]{64}$/.test(input.expected_review_hash)
      || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.request_key)) throw new BadRequestException("EXPERIMENT_APPROVAL_INPUT_INVALID");
    const merchantId = principal.tenantId;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
      const rows = await tx.$queryRaw`SELECT id FROM prompt_experiments WHERE id = ${experimentId} AND merchant_id = ${merchantId} FOR UPDATE`;
      if (!(rows as unknown[]).length) throw new NotFoundException("EXPERIMENT_NOT_FOUND");
      // Membership, including a multistore membership, is checked again under
      // locks. A role claimed by a request or a revoked user cannot approve.
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${principal.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM merchant_team_members WHERE merchant_id = ${merchantId} AND user_id = ${principal.userId} FOR UPDATE`;
      const member = await tx.merchantTeamMember.findUnique({
        where: { merchantId_userId: { merchantId, userId: principal.userId } }, include: { user: true },
      });
      if (!member || member.user.disabledAt || member.role.toLowerCase() !== principal.role) {
        throw new ForbiddenException("EXPERIMENT_HUMAN_APPROVAL_REQUIRED");
      }
      const prior = await tx.experimentActivationApproval.findUnique({ where: { experimentId } });
      if (prior) {
        if (prior.merchantId !== merchantId || prior.requestKey !== input.request_key
          || prior.reviewHash !== input.expected_review_hash || prior.actorUserId !== principal.userId) {
          throw new ConflictException("EXPERIMENT_ALREADY_APPROVED");
        }
        return prior;
      }
      const review = await this.reviewOn(tx, merchantId, experimentId);
      if (review.reviewHash !== input.expected_review_hash) throw new ConflictException("EXPERIMENT_REVIEW_STALE");
      if (review.blockers.length) throw new ConflictException(review.blockers[0]);
      const now = new Date();
      const approval = await tx.experimentActivationApproval.create({ data: {
        experimentId, merchantId, requestKey: input.request_key, reviewHash: review.reviewHash,
        variantFingerprint: review.variantFingerprint, actorUserId: principal.userId, actorRole: principal.role,
        snapshot: review as unknown as Prisma.InputJsonValue, approvedAt: now,
        endsAt: review.measurementPlan ? new Date(now.getTime() + review.measurementPlan.durationDays * 86_400_000) : null,
      } });
      await tx.promptExperiment.update({ where: { id: experimentId, merchantId }, data: { status: "running", startedAt: now } });
      const event = createExperimentEventEnvelope({ eventType: "experiment.started", merchantId, occurredAt: now,
        payload: { experiment_id: experimentId, name: review.name, variant_count: review.variants.length,
          review_hash: review.reviewHash, approved_by: principal.userId } });
      await tx.outboxMessage.create({ data: { eventId: event.event_id, eventType: event.event_type, schemaVersion: event.schema_version,
        merchantId, occurredAt: now, correlationId: event.correlation_id, causationId: event.causation_id,
        producer: event.producer, payload: event.payload as Prisma.InputJsonValue } });
      return approval;
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
    if (stored) {
      try {
        const canonical = buildMeasurementPlan({ variants, durationDays: plan!.durationDays,
          conversionWindowHours: plan!.conversionWindowHours, minimumEffectBps: plan!.minimumEffectBps, baseline: plan!.baseline });
        if (digest(plan) !== stored.planHash || digest(canonical) !== stored.planHash || stored.createdAt > new Date()) {
          blockers.push("EXPERIMENT_MEASUREMENT_PLAN_CORRUPT");
        }
      } catch { blockers.push("EXPERIMENT_MEASUREMENT_PLAN_CORRUPT"); }
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
