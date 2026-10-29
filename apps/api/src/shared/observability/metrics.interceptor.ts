import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from "@nestjs/common";
import { Observable, tap, catchError, throwError } from "rxjs";
import { MetricsService } from "./metrics.service.js";

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly metrics: MetricsService | null) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.metrics) {
      return next.handle();
    }

    const startSeconds = process.hrtime.bigint();
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest();
    const res = httpCtx.getResponse();

    return next.handle().pipe(
      tap(() => {
        this.observe(req, res.statusCode, startSeconds);
      }),
      catchError((error: Error) => {
        const statusCode = (error as any).status ?? (error as any).statusCode ?? 500;
        this.observe(req, statusCode, startSeconds);
        return throwError(() => error);
      }),
    );
  }

  private observe(req: any, statusCode: number, startSeconds: bigint): void {
    const elapsed = Number(process.hrtime.bigint() - startSeconds) / 1e9;
    const route = req.route?.path ?? req.baseUrl ?? "unknown";
    const method = req.method ?? "UNKNOWN";

    try {
      this.metrics!.apiRequestDuration.observe(
        { method, route, status: String(statusCode) },
        elapsed,
      );
    } catch {
      // metrics observation failure must not break request pipeline
    }
  }
}
