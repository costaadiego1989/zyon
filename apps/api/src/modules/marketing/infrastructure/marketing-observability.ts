import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { MarketingError } from "../domain/marketing.js";
export const MARKETING_OPERATION_LOGGER = Symbol("MARKETING_OPERATION_LOGGER");
export type MarketingOperation =
  | "inbound"
  | "identity"
  | "projection"
  | "classification"
  | "handoff"
  | "reply"
  | "campaign"
  | "dispatch"
  | "dispatch_scan"
  | "lifecycle_scan"
  | "delivery"
  | "history"
  | "retention"
  | "http";
@Injectable()
export class MarketingObservability {
  private readonly logger: Pick<Logger, "log" | "warn">;
  constructor(
    private readonly metrics: MetricsService,
    @Optional()
    @Inject(MARKETING_OPERATION_LOGGER)
    logger?: Pick<Logger, "log" | "warn">
  ) {
    this.logger = logger ?? new Logger("Marketing");
  }
  dispatchOutcome(outcome: "accepted" | "unknown" | "failed" | "suppressed") {
    this.metrics.marketingMessageDispatches.inc({ outcome });
  }
  async run<T>(
    operation: MarketingOperation,
    work: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    let outcome = "succeeded";
    let reason: string | undefined;
    try {
      return await work();
    } catch (error) {
      outcome = "failed";
      reason =
        error instanceof MarketingError ? error.code : "operation_unavailable";
      throw error;
    } finally {
      const durationMs = Math.round(performance.now() - start);
      this.metrics.marketingOperations.inc({ operation, outcome });
      this.metrics.marketingOperationDuration.observe(
        { operation },
        durationMs / 1000
      );
      const entry = {
        event: "marketing_operation",
        operation,
        outcome,
        reason,
        durationMs,
        correlationId: CorrelationIdStorage.get(),
      };
      if (outcome === "failed") this.logger.warn(entry);
      else this.logger.log(entry);
    }
  }
}
