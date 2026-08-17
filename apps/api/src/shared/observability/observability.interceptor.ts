import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap, catchError, throwError } from "rxjs";
import { CorrelationIdStorage } from "../logger/correlation-id.storage.js";
import { MetricsService } from "./metrics.service.js";

@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger("Observability");
  private readonly operationDuration: Map<string, { count: number; errorCount: number }> = new Map();

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const className = context.getClass().name;
    const handler = context.getHandler().name;
    const operation = `${className}.${handler}`;
    const correlationId = CorrelationIdStorage.get();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration_ms = Date.now() - start;
        this.logger.debug(operation, { correlationId, result: "success", duration_ms });
        this.recordMetric(operation, "success", duration_ms);
      }),
      catchError((error: Error) => {
        const duration_ms = Date.now() - start;
        this.logger.warn(operation, {
          correlationId,
          result: "error",
          errorCode: (error as any).code || error.constructor.name,
          message: error.message,
          duration_ms,
        });
        this.recordMetric(operation, "error", duration_ms);
        return throwError(() => error);
      }),
    );
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
