import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  RequestTimeoutException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, throwError, TimeoutError } from "rxjs";
import { catchError, timeout } from "rxjs/operators";
import { SetMetadata } from "@nestjs/common";

/** Default request timeout: 30 seconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Max allowed timeout for LLM/AI routes. */
const AI_TIMEOUT_MS = 60_000;

export const REQUEST_TIMEOUT_KEY = "request_timeout_ms";

/**
 * Decorator to override per-route timeout.
 * @example @RequestTimeout(60_000) // 60s for AI routes
 */
export const RequestTimeout = (ms: number) => SetMetadata(REQUEST_TIMEOUT_KEY, ms);

/**
 * Global interceptor that enforces a per-request timeout.
 * Prevents hung connections from exhausting the server pool.
 */
@Injectable()
export class RequestTimeoutInterceptor {
  private readonly logger = new Logger(RequestTimeoutInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const customTimeout = this.reflector.getAllAndOverride<number | undefined>(
      REQUEST_TIMEOUT_KEY,
      [context.getHandler(), context.getClass()]
    );

    const ms = Math.min(customTimeout ?? DEFAULT_TIMEOUT_MS, AI_TIMEOUT_MS);

    return next.handle().pipe(
      timeout(ms),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          this.logger.warn(
            `Request timed out after ${ms}ms: ${context.switchToHttp().getRequest<{ url?: string }>()?.url}`
          );
          return throwError(() => new RequestTimeoutException(
            `Request timed out after ${ms}ms`
          ));
        }
        return throwError(() => err);
      })
    );
  }
}
