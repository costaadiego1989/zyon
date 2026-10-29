import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, defer, tap } from "rxjs";
import { performance } from "node:perf_hooks";
import { ignoreLogFailure, logContext, safeErrorMetadata } from "../logger/log-context.js";
import { MetricsService } from "./metrics.service.js";

@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger("Observability");

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const className = context.getClass().name;
    const handler = context.getHandler().name;
    const operation = `${className}.${handler}`;
    const start = performance.now();
    let recorded = false;
    const record = (result: "success" | "error", error?: unknown) => {
      if (recorded) return;
      recorded = true;
      const duration_ms = Math.max(0, performance.now() - start);
      ignoreLogFailure(() => this.logger[result === "success" ? "debug" : "warn"]({
        event: "http.operation", operation, ...logContext(), result, duration_ms,
        ...(result === "error" ? { error: safeErrorMetadata(error) } : {}),
      }));
      this.recordMetric(operation, result, duration_ms);
    };

    return defer(() => next.handle()).pipe(tap({ complete: () => record("success"), error: error => record("error", error) }));
  }

  private recordMetric(operation: string, result: string, duration_ms: number): void {
    try {
      this.metrics.apiOperationTotal.inc({ operation, result });
      this.metrics.apiOperationDuration.observe({ operation, result }, duration_ms);
    } catch {
      // metrics not registered yet — safe to ignore
    }
  }
}
