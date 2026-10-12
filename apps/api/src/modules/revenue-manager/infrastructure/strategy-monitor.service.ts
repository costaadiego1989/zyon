import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { ExperimentMeasurementService } from "../../experiments/application/experiment-measurement.service.js";
import { StrategyExecutionLedger } from "./strategy-execution-ledger.js";
import { IncentiveMetricsService } from "../application/incentive-metrics.service.js";

/** Bounded, deterministic collection independent of an open dashboard. It never
 * generates a proposal, extends a test or promotes a winner. */
@Injectable()
export class StrategyMonitorService {
  private readonly logger = new Logger(StrategyMonitorService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly measurement: ExperimentMeasurementService) {}

  async run(now = new Date()) {
    if (process.env.REVENUE_STRATEGY_MONITOR_ENABLED !== "true") return { processed: 0, failed: 0 };
    const limit = Number(process.env.REVENUE_STRATEGY_MONITOR_BATCH_LIMIT ?? "100");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("STRATEGY_MONITOR_LIMIT_INVALID");
    const hour = new Date(now); hour.setUTCMinutes(0, 0, 0);
    const key = `strategy-hour-${now.toISOString().slice(0, 13).replace(/\D/g, "")}`;
    // Oldest uncollected executions first, including stopped tests whose buyers
    // still have time to convert. Finished evidence does not need hourly rereads.
    const rows = await this.prisma.$queryRaw<Array<{ id: string; merchantId: string; strategyId: string; version: number;
      experimentId: string; endsAt: Date; status: string; stoppedAt: Date | null }>>`
      SELECT e.id, e.merchant_id AS "merchantId", e.strategy_id AS "strategyId", e.version,
        e.experiment_id AS "experimentId", e.ends_at AS "endsAt", e.status, e.stopped_at AS "stoppedAt"
      FROM strategy_executions e JOIN experiment_measurement_plans p ON p.experiment_id = e.experiment_id AND p.merchant_id = e.merchant_id
      LEFT JOIN LATERAL (SELECT collected_at, result FROM experiment_measurement_reviews r
        WHERE r.experiment_id = e.experiment_id AND r.merchant_id = e.merchant_id ORDER BY collected_at DESC, id DESC LIMIT 1) last ON true
      LEFT JOIN merchant_notifications n ON n.merchant_id = e.merchant_id AND n.id = 'strategy-result:' || e.id || ':' || (last.result->>'state')
      WHERE e.started_at <= ${now}
        AND (last.collected_at IS NULL OR last.collected_at < ${hour}
          OR last.collected_at < e.stopped_at
          OR (n.id IS NULL AND last.result->>'state' IN ('positive','negative','inconclusive','invalid'))
          OR (e.status IN ('running','paused') AND (e.ends_at <= ${now} OR last.result->>'state' = 'invalid'
            OR COALESCE((last.result->'aiUsage'->'control'->>'overrunTurns')::integer, 0)
              + COALESCE((last.result->'aiUsage'->'treatment'->>'overrunTurns')::integer, 0) > 0)))
        AND (e.status IN ('running','paused') OR last.collected_at IS NULL
          OR last.collected_at < e.ends_at + ((p.plan->>'conversionWindowHours')::integer * INTERVAL '1 hour')
          OR (n.id IS NULL AND last.result->>'state' IN ('positive','negative','inconclusive','invalid')))
      ORDER BY last.collected_at ASC NULLS FIRST, e.started_at, e.id LIMIT ${limit}`;
    let processed = 0, failed = 0;
    const ledger = new StrategyExecutionLedger(this.prisma, async () => now);
    for (const row of rows) {
      try {
        const stop = async (reason: string) => {
          try { await ledger.stop({ merchantId: row.merchantId, executionId: row.id, actorId: "system:strategy-monitor",
            kind: "stopped", requestKey: `monitor:${reason}:${row.id}` }); }
          catch (error) {
            // A merchant or concurrent monitor may have already stopped it.
            if ((await this.prisma.strategyExecution.findFirst({ where: { id: row.id, merchantId: row.merchantId } }))?.status !== "stopped") throw error;
          }
        };
        const atHorizon = row.endsAt <= now;
        if (row.status !== "stopped" && atHorizon) await stop("horizon");
        const alreadyStopped = row.status === "stopped" || row.status === "paused" || atHorizon;
        // A dashboard snapshot in this same hour may precede the stop. Preserve
        // it, and give the post-stop evidence a separate key and later timestamp.
        const stoppedAt = new Date(Math.max(now.getTime(), row.stoppedAt?.getTime() ?? 0) + 1);
        let review = await this.measurement.capture(row.merchantId, row.experimentId,
          alreadyStopped ? `${key}-stopped` : key, alreadyStopped ? stoppedAt : now);
        let result = review.result as Record<string, any>;
        if (row.endsAt > now && row.status !== "stopped"
          && (result.state === "invalid" || (result.aiUsage?.control?.overrunTurns ?? 0) + (result.aiUsage?.treatment?.overrunTurns ?? 0) > 0)) {
          await stop(result.state === "invalid" ? "invalid" : "ai-overrun");
          review = await this.measurement.capture(row.merchantId, row.experimentId, `${key}-stopped`, stoppedAt);
          result = review.result as Record<string, any>;
        }
        const titles: Record<string, string> = {
          positive: "O teste indicou melhora de conversão", negative: "O teste indicou queda de conversão",
          inconclusive: "O teste terminou sem conclusão", invalid: "O teste precisa de revisão",
        };
        if (titles[result.state]) await this.prisma.merchantNotification.createMany({ skipDuplicates: true, data: [{
          id: `strategy-result:${row.id}:${result.state}`, merchantId: row.merchantId, type: "ai_strategy_suggestion",
          title: titles[result.state], body: "Veja os resultados e as limitações antes de decidir os próximos passos.", read: false,
          metadata: { strategyId: row.strategyId, hypothesisId: row.strategyId, executionId: row.id,
            version: row.version, state: result.state, measurementId: review.id },
        }] });
        processed++;
      } catch {
        failed++;
        this.logger.warn("Strategy results collection failed; the next poll will retry");
      }
    }
    try { await new IncentiveMetricsService(this.prisma).monitor(now); }
    catch { this.logger.warn("Incentive results collection failed; the next poll will retry"); }
    return { processed, failed };
  }
}
