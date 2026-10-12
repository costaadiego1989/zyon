import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";
import { AnalysisDeferred } from "../domain/weekly-analysis-policy.js";
import { aggregateSharedStrategyLearning, assertSharedStrategyLearning, sharedLearningConfiguration,
  sharedLearningContextHash, SHARED_LEARNING_LOOKBACK_DAYS, SHARED_LEARNING_SCAN_LIMIT,
  type SharedLearningEvidence, type SharedLearningTarget, type SharedStrategyLearning } from "../domain/shared-strategy-learning.js";

@Injectable()
export class SharedStrategyLearningService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /** Deterministic, once per existing weekly run, before the existing budgeted
   * generation. Revisions reuse this frozen snapshot; no new LLM work is added. */
  async prepare(request: HypothesisGenerationRequest): Promise<SharedStrategyLearning | undefined> {
    const analysis = request.analysis_context;
    if (!analysis || !request.checkout_baseline || !request.measurement_planning) return undefined;
    if (process.env.REVENUE_SHARED_LEARNING_ENABLED !== "true") return undefined;
    const config = sharedLearningConfiguration();
    // Disabling sharing suppresses the old context too. A paid cached response
    // remains bound to its old context hash and cannot silently masquerade as new.
    if (!config.enabled || !config.merchantIds.includes(request.merchant_id)) return undefined;
    return this.prisma.$transaction(async tx => {
      const now = new Date();
      await tx.$queryRaw`SELECT id FROM revenue_analysis_runs WHERE id = ${analysis.runId}
        AND merchant_id = ${request.merchant_id} FOR UPDATE`;
      const run = await tx.revenueAnalysisRun.findFirst({ where: { id: analysis.runId, merchantId: request.merchant_id,
        ...(analysis.revisionId ? { status: "completed" } : { status: "running", leaseToken: analysis.leaseToken, leaseUntil: { gt: now } }) } });
      if (!run?.asOf || !run.observationId || run.observationId !== request.observation.id
        || request.measurement_planning!.asOf !== run.asOf.toISOString()) throw new AnalysisDeferred("analysis_lease_lost");
      if (analysis.revisionId && !await tx.revenueStrategyRevision.findFirst({ where: { id: analysis.revisionId,
        merchantId: request.merchant_id, status: "running", leaseToken: analysis.leaseToken, leaseUntil: { gt: now },
        action: { proposal: { strategy: { runId: analysis.runId } } } }, select: { id: true } })) {
        throw new AnalysisDeferred("revision_lease_lost");
      }
      const [merchant] = await tx.$queryRaw<Array<{ storeCategory: string | null; ownerIds: string[] }>>`
        SELECT m.store_category AS "storeCategory", ARRAY(
          SELECT u.id FROM merchant_users u WHERE u.merchant_id = m.id
          UNION SELECT t.user_id FROM merchant_team_members t WHERE t.merchant_id = m.id AND t.role = 'OWNER'
        ) AS "ownerIds" FROM merchants m WHERE m.id = ${request.merchant_id}`;
      if (!merchant) throw new Error("SHARED_LEARNING_MERCHANT_UNAVAILABLE");
      const target: SharedLearningTarget = { merchantId: request.merchant_id, ...merchant,
        baseline: request.checkout_baseline!, planning: request.measurement_planning!, abandonment: request.observation.abandonment };
      if (run.sharedLearningJson) {
        assertSharedStrategyLearning(run.sharedLearningJson);
        if (run.sharedLearningJson.asOf !== run.asOf.toISOString()
          || run.sharedLearningJson.contextHash !== sharedLearningContextHash(target)) throw new Error("SHARED_LEARNING_CONTEXT_CHANGED");
        return run.sharedLearningJson;
      }
      // A revision never adds cross-store evidence to a proposal that was made
      // without it. It only revises the destination's existing proposal.
      if (analysis.revisionId) return undefined;
      const sources = config.merchantIds.filter(id => id !== request.merchant_id);
      const rows = sources.length >= config.minimumMerchants ? await this.readEvidence(tx, sources, run.asOf) : [];
      // A truncated scan would hide losses and bias toward recent winning stores.
      // Fail closed to local analysis until the bounded source cohort is reduced.
      const snapshot = aggregateSharedStrategyLearning(target, rows.length > SHARED_LEARNING_SCAN_LIMIT ? [] : rows,
        run.asOf, config.minimumMerchants);
      const saved = await tx.revenueAnalysisRun.updateMany({ where: { id: run.id, merchantId: request.merchant_id,
        status: "running", leaseToken: analysis.leaseToken, leaseUntil: { gt: new Date() } }, data: {
        sharedLearningJson: snapshot as unknown as Prisma.InputJsonValue,
      } });
      if (saved.count !== 1) throw new AnalysisDeferred("analysis_lease_lost");
      return snapshot;
    });
  }

  private async readEvidence(tx: Prisma.TransactionClient, merchants: string[], asOf: Date): Promise<SharedLearningEvidence[]> {
    const earliest = new Date(asOf.getTime() - SHARED_LEARNING_LOOKBACK_DAYS * 86_400_000);
    // Latest evidence is selected BEFORE testing its outcome. A corrected loss,
    // incomplete result or invalid snapshot must supersede a prior positive one.
    // Fetch only opted-in stores, no buyer-level data, no raw chat or orders.
    return tx.$queryRaw<SharedLearningEvidence[]>`
      SELECT e.merchant_id AS "merchantId", e.id AS "executionId", e.contract, e.contract_hash AS "contractHash",
        e.proposal_hash AS "proposalHash", e.started_at AS "startedAt", e.ends_at AS "endsAt",
        x.completed_at AS "completedAt", p.plan, p.plan_hash AS "planHash", p.created_at AS "registeredAt",
        r.collected_at AS "collectedAt", r.evidence_hash AS "evidenceHash", r.plan_hash AS "reviewPlanHash", r.result,
        m.store_category AS "storeCategory", o.abandonment_json AS abandonment,
        ARRAY(SELECT u.id FROM merchant_users u WHERE u.merchant_id = m.id
          UNION SELECT t.user_id FROM merchant_team_members t WHERE t.merchant_id = m.id AND t.role = 'OWNER') AS "ownerIds"
      FROM strategy_executions e
      JOIN merchants m ON m.id = e.merchant_id
      JOIN prompt_experiments x ON x.id = e.experiment_id AND x.merchant_id = e.merchant_id
      JOIN experiment_measurement_plans p ON p.experiment_id = e.experiment_id AND p.merchant_id = e.merchant_id
      JOIN revenue_strategies s ON s.id = e.strategy_id AND s.merchant_id = e.merchant_id
      JOIN revenue_analysis_runs a ON a.id = s.run_id AND a.merchant_id = s.merchant_id
      JOIN revenue_manager_observations o ON o.id = a.observation_id AND o.merchant_id = a.merchant_id
      JOIN LATERAL (SELECT result, evidence_hash, plan_hash, collected_at FROM experiment_measurement_reviews
        WHERE experiment_id = e.experiment_id AND merchant_id = e.merchant_id AND collected_at <= ${asOf}
        ORDER BY collected_at DESC, id DESC LIMIT 1) r ON true
      WHERE e.merchant_id IN (${Prisma.join(merchants)}) AND e.ends_at >= ${earliest} AND e.ends_at <= ${asOf}
      ORDER BY e.ends_at DESC, e.id LIMIT ${SHARED_LEARNING_SCAN_LIMIT + 1}`;
  }
}
