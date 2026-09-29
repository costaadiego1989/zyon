import type { PrismaClient } from "@prisma/client";
import type { PinnedChatResult } from "../../checkout/application/services/chat-llm-gateway.service.js";
import { chatMessageTextHash } from "../../checkout/application/services/chat-message-identity.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { StrategyExecutionContract } from "../domain/strategy-execution.js";
import { positiveInteger } from "../domain/weekly-analysis-policy.js";

const cost = (input: number, output: number, inputRate: bigint, outputRate: bigint) =>
  (BigInt(input) * inputRate + BigInt(output) * outputRate + 999_999n) / 1_000_000n;
function denied(reason: string): never { throw new Error(`STRATEGY_AI_${reason}`); }

/** Uses the planner's global budget lock and shared usage ledger. No I/O to a
 * provider occurs here and no unknown charge is released just because time passed. */
export class StrategyAiBudget {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(merchantId: string, turnId: string, systemPrompt: string, userMessage: string) {
    const maxInput = positiveInteger("REVENUE_AI_MAX_INPUT_TOKENS");
    const maxOutputPolicy = positiveInteger("REVENUE_AI_MAX_OUTPUT_TOKENS");
    const daily = BigInt(positiveInteger("REVENUE_AI_DAILY_LIMIT_MICROS"));
    const monthly = BigInt(positiveInteger("REVENUE_AI_MONTHLY_LIMIT_MICROS"));
    const executionLimit = BigInt(positiveInteger("REVENUE_STRATEGY_AI_EXECUTION_LIMIT_MICROS"));
    const sessionCalls = positiveInteger("REVENUE_STRATEGY_AI_SESSION_MAX_CALLS");
    const rpm = positiveInteger("REVENUE_AI_PROVIDER_RPM"), tpm = positiveInteger("REVENUE_AI_PROVIDER_TPM");
    const concurrency = positiveInteger("REVENUE_AI_PROVIDER_CONCURRENCY");
    const revisionPercent = Number(process.env.REVENUE_AI_REVISION_RESERVE_PERCENT);
    const currency = process.env.REVENUE_AI_BUDGET_CURRENCY;
    if (!currency || !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(revisionPercent) || revisionPercent < 0 || revisionPercent > 100) denied("CONFIGURATION_REQUIRED");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(762401)::text`;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const now = clock.now;
      const turn = await tx.strategyTurn.findFirst({ where: { id: turnId, merchantId },
        include: { outcome: true, aiReservation: true, chatRequest: true, assignment: { include: { execution: true } } } });
      if (!turn || turn.outcome || turn.aiReservation) denied("TURN_NOT_AVAILABLE");
      const execution = turn.assignment.execution;
      const contract = execution.contract as unknown as StrategyExecutionContract;
      if (execution.status !== "running" || execution.endsAt <= now || digest(contract) !== execution.contractHash
        || digest(systemPrompt) !== turn.promptHash
        || (turn.chatRequest && chatMessageTextHash(userMessage) !== turn.chatRequest.buyerMessageHash)) denied("CONTEXT_CHANGED");
      const { baseline } = contract;
      const maxOutput = baseline.sampling.max_tokens;
      const body = { model: baseline.provider.model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
        tools: baseline.tools, ...baseline.sampling };
      // A conservative text/tool envelope bound, not a token estimate or a model
      // tokenizer. The upper-bound tariff is explicitly provisioned by operators.
      if (Buffer.byteLength(JSON.stringify(body), "utf8") + 1024 > maxInput || maxOutput > maxOutputPolicy) denied("CONTEXT_LIMIT");
      const price = await tx.aiPriceVersion.findFirst({ where: { provider: baseline.provider.name, model: baseline.provider.model,
        channel: "chat", component: "text_generation", currency, source: "revenue-upper-bound-v1", effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: "desc" } });
      if (!price || price.inputMicrosPerMillion === null || price.outputMicrosPerMillion === null
        || price.inputMicrosPerMillion < 0n || price.outputMicrosPerMillion < 0n) denied("PRICING_REQUIRED");
      const amount = cost(maxInput, maxOutput, price.inputMicrosPerMillion, price.outputMicrosPerMillion);
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const minuteAgo = new Date(now.getTime() - 60_000);
      const [totals] = await tx.$queryRaw<Array<Record<string, bigint>>>`
        SELECT COALESCE(sum(CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros
            WHEN r.created_at >= ${day} THEN COALESCE(u.cost_micros, r.amount_micros) ELSE 0 END), 0)::bigint AS daily,
          COALESCE(sum(CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros
            WHEN r.created_at >= ${month} THEN COALESCE(u.cost_micros, r.amount_micros) ELSE 0 END), 0)::bigint AS monthly,
          COALESCE(sum(CASE WHEN r.work_type <> 'revision' AND (r.created_at >= ${day} OR r.state IN ('dispatched','unknown')) THEN
            CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros ELSE COALESCE(u.cost_micros, r.amount_micros) END ELSE 0 END), 0)::bigint AS scheduled,
          count(*) FILTER (WHERE r.state = 'overrun' OR u.cost_micros > r.amount_micros)::bigint AS overruns
        FROM revenue_ai_budget_reservations r LEFT JOIN ai_usage_events u ON u.idempotency_key = r.usage_key
        WHERE r.currency = ${currency}`;
      if (totals.overruns > 0n) denied("RECONCILIATION_REQUIRED");
      if (totals.daily + amount > daily || totals.monthly + amount > monthly
        || totals.scheduled + amount > daily * BigInt(100 - revisionPercent) / 100n) denied("BUDGET_EXHAUSTED");
      const [local] = await tx.$queryRaw<Array<{ spent: bigint; calls: bigint }>>`
        SELECT COALESCE(sum(CASE WHEN r.state IN ('dispatched','unknown') THEN r.amount_micros
          ELSE COALESCE(u.cost_micros, r.amount_micros) END), 0)::bigint AS spent,
          count(*) FILTER (WHERE a.id = ${turn.assignmentId})::bigint AS calls
        FROM strategy_ai_reservations r JOIN strategy_turns t ON t.id = r.turn_id AND t.merchant_id = r.merchant_id
          JOIN strategy_assignments a ON a.id = t.assignment_id AND a.merchant_id = t.merchant_id
          LEFT JOIN ai_usage_events u ON u.idempotency_key = r.usage_key
        WHERE a.execution_id = ${execution.id} AND r.merchant_id = ${merchantId} AND r.currency = ${currency}`;
      if (local.spent + amount > executionLimit || local.calls >= BigInt(sessionCalls)) denied("EXECUTION_LIMIT");
      const [capacity] = await tx.$queryRaw<Array<Record<string, bigint>>>`
        SELECT count(*) FILTER (WHERE state IN ('dispatched','unknown'))::bigint AS inflight,
          count(*) FILTER (WHERE created_at >= ${minuteAgo})::bigint AS requests,
          COALESCE(sum(max_input_tokens + max_output_tokens) FILTER (WHERE created_at >= ${minuteAgo}), 0)::bigint AS tokens
        FROM revenue_ai_budget_reservations WHERE provider = ${baseline.provider.name} AND model = ${baseline.provider.model}`;
      if (capacity.inflight >= BigInt(concurrency) || capacity.requests >= BigInt(rpm)
        || capacity.tokens + BigInt(maxInput + maxOutput) > BigInt(tpm)) denied("PROVIDER_CAPACITY");
      return tx.strategyAiReservation.create({ data: { turnId, merchantId, provider: baseline.provider.name, model: baseline.provider.model,
        currency: currency!, priceVersion: price.version, inputRate: price.inputMicrosPerMillion, outputRate: price.outputMicrosPerMillion,
        maxInputTokens: maxInput, maxOutputTokens: maxOutput, amountMicros: amount, usageKey: `strategy-chat:${turnId}`,
        payloadHash: digest(body), createdAt: now } });
    });
  }

  async settle(merchantId: string, turnId: string, provider: PinnedChatResult) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(762401)::text`;
      const r = await tx.strategyAiReservation.findUnique({ where: { turnId, merchantId }, include: { turn: { include: { assignment: true } } } });
      // A rejected preflight may never have created a reservation. It sent no request.
      if (!r) return;
      if (["settled", "released", "overrun"].includes(r.state)) return r;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const now = clock.now, released = provider.outcome === "provider_not_dispatched";
      const usage = released ? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } : provider.usage;
      const valid = usage && [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens]
        .every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2_147_483_647)
        && usage.prompt_tokens + usage.completion_tokens === usage.total_tokens;
      const amount = valid ? cost(usage.prompt_tokens, usage.completion_tokens, r.inputRate, r.outputRate) : null;
      const overrun = amount !== null && (amount > r.amountMicros || usage!.prompt_tokens > r.maxInputTokens || usage!.completion_tokens > r.maxOutputTokens);
      const data = { merchantId, source: "checkout_strategy", channel: "chat", component: "text_generation", provider: r.provider, model: r.model,
        executionStatus: released ? "not_dispatched" : provider.outcome === "provider_completed" ? "succeeded" : "unknown",
        promptTokens: valid ? usage.prompt_tokens : null, completionTokens: valid ? usage.completion_tokens : null,
        totalTokens: valid ? usage.total_tokens : null, costMicros: amount, currency: r.currency, pricingVersion: r.priceVersion,
        costStatus: released ? "not_incurred" : valid ? "estimated" : "unpriced", startedAt: r.createdAt, completedAt: now,
        latencyMs: Math.max(0, Math.min(2_147_483_647, now.getTime() - r.createdAt.getTime())),
        correlationId: r.turn.assignment.executionId, providerEventId: provider.providerEventId,
        metadata: { turn_id: turnId, assignment_id: r.turn.assignmentId, tariff_basis: "upper_bound" } };
      await tx.aiUsageEvent.upsert({ where: { idempotencyKey: r.usageKey }, create: { ...data, idempotencyKey: r.usageKey }, update: data });
      return tx.strategyAiReservation.update({ where: { turnId, merchantId }, data: {
        state: released ? "released" : !valid ? "unknown" : overrun ? "overrun" : "settled", settledAt: valid ? now : null } });
    });
  }
}
