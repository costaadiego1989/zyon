import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, RevenueAiReservation } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { AnalysisDeferred, positiveInteger } from "../domain/weekly-analysis-policy.js";

export type AnalysisGenerationContext = { runId: string; leaseToken: number; revisionId?: string };
export type TokenUsage = { prompt_tokens: number; completion_tokens: number };
const cost = (input: number, output: number, inputRate: bigint, outputRate: bigint) =>
  (BigInt(input) * inputRate + BigInt(output) * outputRate + 999_999n) / 1_000_000n;

@Injectable()
export class RevenueAiBudgetService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async cached(context: AnalysisGenerationContext, merchantId: string) {
    if (context.revisionId) return (await this.revision(this.prisma, context, merchantId, new Date())).generatedJson;
    const run = await this.prisma.revenueAnalysisRun.findFirstOrThrow({ where: { id: context.runId, merchantId,
      leaseToken: context.leaseToken, status: "running", leaseUntil: { gt: new Date() } } });
    return run.generatedJson;
  }

  async cache(context: AnalysisGenerationContext, merchantId: string, response: import("../domain/ports/hypothesis-generator.port.js").HypothesisGenerationResponse) {
    if (context.revisionId) {
      await this.prisma.$transaction(async tx => {
        await this.revision(tx, context, merchantId, new Date());
        const saved = await tx.revenueStrategyRevision.updateMany({ where: { id: context.revisionId, merchantId,
          leaseToken: context.leaseToken, status: "running", leaseUntil: { gt: new Date() } }, data: { generatedJson: response as unknown as Prisma.InputJsonValue } });
        if (saved.count !== 1) throw new AnalysisDeferred("revision_lease_lost");
      });
      return;
    }
    const saved = await this.prisma.revenueAnalysisRun.updateMany({ where: { id: context.runId, merchantId,
      leaseToken: context.leaseToken, status: "running", leaseUntil: { gt: new Date() } }, data: { generatedJson: response as unknown as Prisma.InputJsonValue } });
    if (saved.count !== 1) throw new AnalysisDeferred("analysis_lease_lost");
  }

  async reserve(input: { merchantId: string; context: AnalysisGenerationContext; provider: string; model: string;
    inputBytes: number; workType?: "scheduled" | "revision" | "shared_learning" }, now = new Date()): Promise<RevenueAiReservation> {
    const maxInput = positiveInteger("REVENUE_AI_MAX_INPUT_TOKENS");
    const maxOutput = positiveInteger("REVENUE_AI_MAX_OUTPUT_TOKENS");
    // UTF-8 bytes plus a conservative envelope allowance; bounded plain-text
    // messages only. Operators must provision an upper-bound tariff for this model.
    if (!Number.isSafeInteger(input.inputBytes) || input.inputBytes < 0 || input.inputBytes + 512 > maxInput)
      throw new AnalysisDeferred("context_limit_exceeded");
    const daily = BigInt(positiveInteger("REVENUE_AI_DAILY_LIMIT_MICROS"));
    const monthly = BigInt(positiveInteger("REVENUE_AI_MONTHLY_LIMIT_MICROS"));
    const cycleLimit = BigInt(positiveInteger("REVENUE_AI_CYCLE_LIMIT_MICROS"));
    const maxCalls = positiveInteger("REVENUE_AI_MAX_CALLS_PER_CYCLE");
    const rpm = positiveInteger("REVENUE_AI_PROVIDER_RPM");
    const tpm = positiveInteger("REVENUE_AI_PROVIDER_TPM");
    const concurrency = positiveInteger("REVENUE_AI_PROVIDER_CONCURRENCY");
    const revisionPercent = Number(process.env.REVENUE_AI_REVISION_RESERVE_PERCENT);
    const currency = process.env.REVENUE_AI_BUDGET_CURRENCY;
    if (!currency || !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(revisionPercent) || revisionPercent < 0 || revisionPercent > 100)
      throw new AnalysisDeferred("budget_configuration_required");
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const minuteAgo = new Date(now.getTime() - 60_000);

    return this.prisma.$transaction(async tx => {
      // Serializes admission across API instances. No provider call or wait
      // occurs in this short transaction. Settlement uses the same lock.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(762401)::text`;
      if (input.context.revisionId) await this.revision(tx, input.context, input.merchantId, now);
      const run = await tx.revenueAnalysisRun.findFirst({ where: { id: input.context.runId, merchantId: input.merchantId,
        ...(input.context.revisionId ? { status: "completed" } : { status: "running", leaseToken: input.context.leaseToken, leaseUntil: { gt: now } }) } });
      if (!run) throw new AnalysisDeferred("analysis_lease_lost");
      const workType = input.context.revisionId ? "revision" : input.workType ?? "scheduled";
      const price = await tx.aiPriceVersion.findFirst({ where: { provider: input.provider, model: input.model,
        channel: "chat", component: "text_generation", currency, source: "revenue-upper-bound-v1",
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: "desc" } });
      if (!price || price.inputMicrosPerMillion === null || price.outputMicrosPerMillion === null
        || price.inputMicrosPerMillion < 0n || price.outputMicrosPerMillion < 0n)
        throw new AnalysisDeferred("pricing_required");
      const amount = cost(maxInput, maxOutput, price.inputMicrosPerMillion, price.outputMicrosPerMillion);
      const [totals] = await tx.$queryRaw<Array<Record<string, bigint>>>`
        SELECT
          COALESCE(sum(CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros
            WHEN r.created_at >= ${day} THEN COALESCE(u.cost_micros, r.amount_micros) ELSE 0 END), 0)::bigint AS daily,
          COALESCE(sum(CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros
            WHEN r.created_at >= ${month} THEN COALESCE(u.cost_micros, r.amount_micros) ELSE 0 END), 0)::bigint AS monthly,
          COALESCE(sum(CASE WHEN r.run_id = ${run.id} THEN
            CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros ELSE COALESCE(u.cost_micros, r.amount_micros) END ELSE 0 END), 0)::bigint AS cycle,
          COALESCE(sum(CASE WHEN r.work_type <> 'revision' AND (r.created_at >= ${day} OR r.state IN ('dispatched','unknown')) THEN
            CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros ELSE COALESCE(u.cost_micros, r.amount_micros) END ELSE 0 END), 0)::bigint AS scheduled,
          count(*) FILTER (WHERE r.run_id = ${run.id})::bigint AS calls,
          count(*) FILTER (WHERE r.state = 'overrun' OR u.cost_micros > r.amount_micros)::bigint AS overruns
        FROM revenue_ai_reservations r LEFT JOIN ai_usage_events u ON u.idempotency_key = r.usage_key
        WHERE r.currency = ${currency}`;
      if (totals.overruns > 0n) throw new AnalysisDeferred("cost_reconciliation_required");
      if (totals.calls >= BigInt(maxCalls)) throw new AnalysisDeferred("cycle_call_limit");
      if (totals.daily + amount > daily || totals.monthly + amount > monthly || totals.cycle + amount > cycleLimit
        || (workType !== "revision" && totals.scheduled + amount > daily * BigInt(100 - revisionPercent) / 100n))
        throw new AnalysisDeferred("budget_exhausted");
      const [capacity] = await tx.$queryRaw<Array<Record<string, bigint>>>`
        SELECT count(*) FILTER (WHERE state IN ('dispatched','unknown'))::bigint AS inflight,
          count(*) FILTER (WHERE created_at >= ${minuteAgo})::bigint AS requests,
          COALESCE(sum(max_input_tokens + max_output_tokens) FILTER (WHERE created_at >= ${minuteAgo}), 0)::bigint AS tokens
        FROM revenue_ai_reservations WHERE provider = ${input.provider} AND model = ${input.model}`;
      if (capacity.inflight >= BigInt(concurrency) || capacity.requests >= BigInt(rpm) || capacity.tokens + BigInt(maxInput + maxOutput) > BigInt(tpm))
        throw new AnalysisDeferred("provider_capacity");
      const id = randomUUID();
      return tx.revenueAiReservation.create({ data: { id, merchantId: input.merchantId, runId: run.id,
        workType, provider: input.provider, model: input.model, currency,
        priceVersion: price.version, inputRate: price.inputMicrosPerMillion, outputRate: price.outputMicrosPerMillion,
        maxInputTokens: maxInput, maxOutputTokens: maxOutput, amountMicros: amount, usageKey: `revenue-analysis:${id}`, createdAt: now } });
    });
  }

  private async revision(tx: Prisma.TransactionClient, context: AnalysisGenerationContext, merchantId: string, now: Date) {
    const revision = await tx.revenueStrategyRevision.findFirst({ where: { id: context.revisionId, merchantId,
      status: "running", leaseToken: context.leaseToken, leaseUntil: { gt: now } },
      include: { action: { include: { proposal: { include: { strategy: true } } } } } });
    const strategy = revision?.action.proposal.strategy;
    if (!revision || !strategy || strategy.runId !== context.runId || strategy.status !== "revision_pending"
      || strategy.currentVersion !== revision.action.version || revision.action.proposal.expiresAt <= now) {
      throw new AnalysisDeferred("revision_lease_lost");
    }
    return revision;
  }

  /** Unknown attempts stay reserved across periods until evidence reconciles them. */
  async settle(reservation: RevenueAiReservation, usage?: TokenUsage, providerEventId?: string, now = new Date()): Promise<void> {
    const valid = usage && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0
      && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0;
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(762401)::text`;
      const r = await tx.revenueAiReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      if (r.state === "settled" || r.state === "overrun") return;
      const actual = valid ? cost(usage.prompt_tokens, usage.completion_tokens, r.inputRate, r.outputRate) : null;
      const overrun = actual !== null && (actual > r.amountMicros || usage!.prompt_tokens > r.maxInputTokens || usage!.completion_tokens > r.maxOutputTokens);
      const data = { merchantId: r.merchantId, source: "revenue_manager", channel: "chat", component: "text_generation",
        provider: r.provider, model: r.model, executionStatus: valid ? "succeeded" : "unknown",
        promptTokens: valid ? usage.prompt_tokens : null, completionTokens: valid ? usage.completion_tokens : null,
        totalTokens: valid ? usage.prompt_tokens + usage.completion_tokens : null,
        costMicros: actual, currency: r.currency, pricingVersion: r.priceVersion,
        costStatus: valid ? "estimated" : "unpriced", startedAt: r.createdAt, completedAt: now,
        latencyMs: Math.max(0, Math.min(2_147_483_647, now.getTime() - r.createdAt.getTime())),
        correlationId: r.runId, providerEventId, metadata: { reservation_id: r.id, tariff_basis: "upper_bound" } };
      await tx.aiUsageEvent.upsert({ where: { idempotencyKey: r.usageKey }, create: { ...data, idempotencyKey: r.usageKey }, update: data });
      await tx.revenueAiReservation.update({ where: { id: r.id }, data: {
        state: !valid ? "unknown" : overrun ? "overrun" : "settled", settledAt: valid ? now : null } });
    });
  }
}
