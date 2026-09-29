import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient, RevenueAnalysisRun } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { BillingPlanMeteringService } from "../../payment/domain/billing-plan-guard.js";
import { BILLING_PLANS } from "../../payment/domain/billing-plans.js";
import { ObserveMetricsUseCase } from "../application/use-cases/observe-metrics.use-case.js";
import { GenerateHypothesisUseCase } from "../application/use-cases/generate-hypothesis.use-case.js";
import { MeasurementBaselineUnavailable } from "../domain/strategy-measurement.js";
import { hasOpenIncentiveExecution } from "./incentive-execution-ledger.js";
import { AnalysisDeferred, analysisGroup, isNight, LEASE_MS, MAX_RUN_ATTEMPTS, nextNight,
  positiveInteger, WEEK_MS, weeklyAnalysisEnabled, weeklyGenerationEnabled, weeklyMerchantAllowed } from "../domain/weekly-analysis-policy.js";

@Injectable()
export class WeeklyAnalysisService {
  clock = () => new Date();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly billing: BillingPlanMeteringService,
    private readonly observe: ObserveMetricsUseCase,
    private readonly generate: GenerateHypothesisUseCase) {}

  async owns(merchantId: string): Promise<boolean> {
    return !!await this.prisma.revenueAnalysisSchedule.findUnique({ where: { merchantId }, select: { merchantId: true } });
  }

  private async eligible(merchantId: string, now: Date): Promise<boolean> {
    if (!weeklyMerchantAllowed(merchantId)) return false;
    const plan = await this.billing.getEffectivePlan(merchantId, now);
    if (!BILLING_PLANS[plan].features.revenueManager) return false;
    const rules = await this.prisma.merchantRule.findUnique({ where: { merchantId }, select: { autonomousEngineEnabled: true } });
    return rules?.autonomousEngineEnabled === true;
  }

  async enroll(now = this.clock()): Promise<void> {
    if (!weeklyAnalysisEnabled()) return;
    let cursor: string | undefined;
    while (true) {
      const merchants = await this.prisma.merchant.findMany({ where: cursor ? { id: { gt: cursor } } : {},
        orderBy: { id: "asc" }, take: 200, select: { id: true } });
      if (!merchants.length) break;
      const enrolled = new Set((await this.prisma.revenueAnalysisSchedule.findMany({
        where: { merchantId: { in: merchants.map(m => m.id) } }, select: { merchantId: true },
      })).map(s => s.merchantId));
      for (const merchant of merchants) {
        if (enrolled.has(merchant.id)) continue;
        if (!weeklyMerchantAllowed(merchant.id) || !await this.eligible(merchant.id, now)) continue;
        const group = analysisGroup(merchant.id);
        await this.prisma.revenueAnalysisSchedule.upsert({ where: { merchantId: merchant.id }, update: {},
          create: { merchantId: merchant.id, group, nextDueAt: nextNight(now, "America/Sao_Paulo", group) } });
      }
      cursor = merchants[merchants.length - 1].id;
    }
  }

  async request(merchantId: string, now = this.clock()) {
    if (!weeklyAnalysisEnabled()) return this.status(merchantId, now);
    if (!await this.eligible(merchantId, now)) throw new AnalysisDeferred("merchant_ineligible");
    const group = analysisGroup(merchantId);
    await this.prisma.revenueAnalysisSchedule.upsert({ where: { merchantId }, update: {},
      create: { merchantId, group, nextDueAt: nextNight(now, "America/Sao_Paulo", group) } });
    await this.ensureRun(merchantId, now);
    return this.status(merchantId, now);
  }

  private async ensureRun(merchantId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT merchant_id FROM revenue_analysis_schedules WHERE merchant_id = ${merchantId} FOR UPDATE`;
      const schedule = await tx.revenueAnalysisSchedule.findUniqueOrThrow({ where: { merchantId } });
      if (schedule.nextDueAt > now || !isNight(now, schedule.timezone)) return;
      if (schedule.currentRunId) {
        const current = await tx.revenueAnalysisRun.findUniqueOrThrow({ where: { id: schedule.currentRunId } });
        if (current.status !== "completed") return;
      }
      const cycle = schedule.cycle + 1;
      const run = await tx.revenueAnalysisRun.create({ data: { merchantId, cycle, createdAt: now, retryAt: now } });
      await tx.revenueAnalysisSchedule.update({ where: { merchantId }, data: { currentRunId: run.id, cycle } });
      await this.notice(tx, run, "queued", now);
    });
  }

  /** Stable keyset scan plus oldest-first recovery; enqueue is retried every poll. */
  async dispatch(enqueue: (runId: string) => Promise<void>, now = this.clock()): Promise<number> {
    if (!weeklyAnalysisEnabled()) return 0;
    await this.enroll(now);
    let cursor: string | undefined;
    while (true) {
      const schedules = await this.prisma.revenueAnalysisSchedule.findMany({ where: {
        nextDueAt: { lte: now }, ...(cursor ? { merchantId: { gt: cursor } } : {}) },
        orderBy: { merchantId: "asc" }, take: 200 });
      if (!schedules.length) break;
      for (const s of schedules) {
        if (isNight(now, s.timezone) && await this.eligible(s.merchantId, now)) await this.ensureRun(s.merchantId, now);
      }
      cursor = schedules[schedules.length - 1].merchantId;
    }
    const runs = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT r.id FROM revenue_analysis_runs r
      JOIN revenue_analysis_schedules s ON s.merchant_id = r.merchant_id
      WHERE r.retry_at <= ${now}
        AND (r.status IN ('queued','retry_wait','deferred_budget') OR (r.status = 'running' AND r.lease_until <= ${now}))
        AND EXTRACT(HOUR FROM (${now}::timestamptz AT TIME ZONE s.timezone)) >= 3
        AND EXTRACT(HOUR FROM (${now}::timestamptz AT TIME ZONE s.timezone)) < 6
      ORDER BY r.created_at, r.id LIMIT 200`;
    for (const run of runs) await enqueue(run.id);
    return runs.length;
  }

  async claim(id: string, now = this.clock()): Promise<RevenueAnalysisRun | null> {
    if (!weeklyAnalysisEnabled()) return null;
    const dailyLimit = positiveInteger("REVENUE_ANALYSIS_DAILY_LIMIT");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(762402)::text`;
      await tx.$queryRaw`SELECT id FROM revenue_analysis_runs WHERE id = ${id} FOR UPDATE`;
      const run = await tx.revenueAnalysisRun.findUnique({ where: { id } });
      if (!run || ["completed", "failed"].includes(run.status) || run.retryAt > now
        || (run.status === "running" && run.leaseUntil && run.leaseUntil > now)) return null;
      const schedule = await tx.revenueAnalysisSchedule.findUniqueOrThrow({ where: { merchantId: run.merchantId } });
      if (!isNight(now, schedule.timezone)) return null;
      if (run.attempts >= MAX_RUN_ATTEMPTS) {
        await tx.revenueAnalysisRun.update({ where: { id }, data: { status: "failed", reason: "attempt_limit", leaseUntil: null } });
        await this.notice(tx, run, "failed", now);
        return null;
      }
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const count = await tx.revenueAnalysisRun.count({ where: { startedAt: { gte: day } } });
      if (!run.startedAt && count >= dailyLimit) {
        await tx.revenueAnalysisRun.update({ where: { id }, data: { status: "deferred_budget", reason: "daily_analysis_limit",
          retryAt: nextNight(new Date(now.getTime() + 6 * 3_600_000), schedule.timezone) } });
        await this.notice(tx, run, "deferred_budget", now);
        return null;
      }
      return tx.revenueAnalysisRun.update({ where: { id }, data: { status: "running", reason: null,
        attempts: { increment: 1 }, leaseToken: { increment: 1 }, leaseUntil: new Date(now.getTime() + LEASE_MS),
        startedAt: run.startedAt ?? now, asOf: run.asOf ?? now } });
    });
  }

  async process(id: string): Promise<void> {
    if (!weeklyAnalysisEnabled()) return;
    const run = await this.claim(id);
    if (!run) return;
    try {
      if (!await this.eligible(run.merchantId, this.clock())) throw new AnalysisDeferred("merchant_ineligible");
      let observationId = run.observationId;
      if (!observationId) {
        const asOf = run.asOf!;
        const observed = await this.observe.execute({ merchant_id: run.merchantId,
          window_start: new Date(asOf.getTime() - WEEK_MS), window_end: asOf, as_of: asOf });
        observationId = observed.observation_id;
        await this.checkpoint(run, { observationId });
      }
      const observation = await this.prisma.revenueManagerObservation.findFirstOrThrow({ where: { id: observationId, merchantId: run.merchantId } });
      const quality = observation.dataQualityJson as { status?: string };
      if (quality.status !== "ready") return this.complete(run, "insufficient_data");
      const existing = await this.prisma.revenueManagerHypothesis.findUnique({ where: { id: `analysis-${run.id}` } });
      if (existing) return this.complete(run, "recommendations", existing.id);
      if (!weeklyGenerationEnabled()) throw new AnalysisDeferred("generation_disabled");
      // Existing experiments and pending decisions get time to collect outcomes.
      const [active, pending, incentiveActive] = await Promise.all([
        this.prisma.promptExperiment.count({ where: { merchantId: run.merchantId, status: "running" } }),
        this.pendingDecisions(run.merchantId),
        hasOpenIncentiveExecution(this.prisma, run.merchantId, this.clock()),
      ]);
      if (active || pending || incentiveActive) return this.complete(run, "keep_current");
      const proposal = await this.generate.execute({ merchant_id: run.merchantId, observation_id: observationId,
        analysis_context: { runId: run.id, leaseToken: run.leaseToken } });
      await this.complete(run, "recommendations", proposal.hypothesis_id);
    } catch (error) {
      // A mature cohort that cannot support a plan waits for next week's data,
      // rather than retrying a paid generation or looping every hour.
      if (error instanceof MeasurementBaselineUnavailable) return this.complete(run, "insufficient_data");
      const deferred = error instanceof AnalysisDeferred;
      const reason = deferred ? error.code : "analysis_processing_failed";
      await this.prisma.$transaction(async tx => {
        const changed = await tx.revenueAnalysisRun.updateMany({ where: this.fence(run), data: {
          status: deferred ? "deferred_budget" : run.attempts >= MAX_RUN_ATTEMPTS ? "failed" : "retry_wait",
          reason, leaseUntil: null, retryAt: new Date(this.clock().getTime() + (deferred ? 3_600_000 : 15 * 60_000)),
          ...(deferred ? { attempts: { decrement: 1 } } : {}) } });
        if (changed.count) await this.notice(tx, run, deferred ? "deferred_budget" : "failed", this.clock());
      });
    }
  }

  /** An expired immutable proposal cannot indefinitely suppress later weekly
   * analyses. Legacy pending hypotheses retain their existing review behavior. */
  async pendingDecisions(merchantId: string, now = this.clock()): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ pending: bigint }>>`
      SELECT count(*) AS pending FROM revenue_manager_hypotheses h
      LEFT JOIN revenue_strategies s ON s.id = h.id AND s.merchant_id = h.merchant_id
      LEFT JOIN revenue_strategy_versions v ON v.strategy_id = s.id AND v.merchant_id = s.merchant_id AND v.version = s.current_version
      WHERE h.merchant_id = ${merchantId} AND h.status = 'pending_review'
        AND (s.id IS NULL OR v.expires_at IS NULL OR v.expires_at > ${now})`;
    return Number(row.pending);
  }

  private fence(run: RevenueAnalysisRun) {
    return { id: run.id, merchantId: run.merchantId, status: "running", leaseToken: run.leaseToken, leaseUntil: { gt: this.clock() } };
  }
  private async checkpoint(run: RevenueAnalysisRun, data: Prisma.RevenueAnalysisRunUpdateManyMutationInput) {
    const changed = await this.prisma.revenueAnalysisRun.updateMany({ where: this.fence(run), data });
    if (changed.count !== 1) throw new AnalysisDeferred("analysis_lease_lost");
  }

  async complete(run: RevenueAnalysisRun, result: string, hypothesisId?: string, now = this.clock()): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const changed = await tx.revenueAnalysisRun.updateMany({ where: { ...this.fence(run), leaseUntil: { gt: now } },
        data: { status: "completed", result, hypothesisId, completedAt: now, leaseUntil: null, reason: null } });
      if (changed.count !== 1) throw new AnalysisDeferred("analysis_lease_lost");
      const schedule = await tx.revenueAnalysisSchedule.findUniqueOrThrow({ where: { merchantId: run.merchantId } });
      await tx.revenueAnalysisSchedule.update({ where: { merchantId: run.merchantId },
        data: { lastSuccessfulAt: now, nextDueAt: nextNight(new Date(now.getTime() + WEEK_MS), schedule.timezone) } });
      await this.notice(tx, { ...run, hypothesisId: hypothesisId ?? null }, result, now);
    });
  }

  private async notice(tx: Prisma.TransactionClient, run: RevenueAnalysisRun, state: string, now: Date) {
    const titles: Record<string, string> = { queued: "Análise semanal agendada", recommendations: "Análise concluída: estratégia para revisar",
      insufficient_data: "Análise concluída: aguardando mais dados", keep_current: "Análise concluída: manter a estratégia atual",
      deferred_budget: "Análise semanal aguardando disponibilidade", failed: "Análise semanal precisa de atenção" };
    const data = { title: titles[state] ?? "Análise semanal atualizada", body: "Veja o resultado e os próximos passos no Revenue Manager.",
      metadata: { analysisRunId: run.id, state, ...(run.hypothesisId ? { hypothesisId: run.hypothesisId } : {}) } };
    await tx.merchantNotification.upsert({ where: { id: `analysis:${run.id}` }, update: { ...data, read: false },
      create: { ...data, id: `analysis:${run.id}`, merchantId: run.merchantId, type: "ai_analysis_update", createdAt: now } });
  }

  async status(merchantId: string, now = this.clock()) {
    const schedule = await this.prisma.revenueAnalysisSchedule.findUnique({ where: { merchantId } });
    const run = schedule?.currentRunId ? await this.prisma.revenueAnalysisRun.findFirst({
      where: { id: schedule.currentRunId, merchantId }, select: { id: true, status: true, result: true, reason: true,
        createdAt: true, startedAt: true, completedAt: true, observationId: true, hypothesisId: true, retryAt: true } }) : null;
    return { mode: schedule ? "weekly" : "legacy", enabled: weeklyAnalysisEnabled() && weeklyMerchantAllowed(merchantId),
      queue_available: !!process.env.REDIS_URL && process.env.REDIS_ENABLED !== "false",
      next_eligible_at: schedule?.nextDueAt.toISOString() ?? null, last_successful_at: schedule?.lastSuccessfulAt?.toISOString() ?? null,
      overdue: !!schedule && schedule.nextDueAt < now && run?.status !== "completed", run };
  }
}
