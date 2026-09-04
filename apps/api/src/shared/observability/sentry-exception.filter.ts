import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { toProblemDetails } from "../http/problem-details.filter.js";
import { getSentry, isSentryEnabled } from "./sentry.module.js";

interface SentryScope {
  setTag(key: string, value: string): void;
}

interface SentryLike {
  withScope(cb: (scope: SentryScope) => void): void;
  captureException(err: unknown): void;
}

/**
 * Global exception filter that forwards unhandled exceptions to Sentry while
 * delegating response rendering to `ProblemDetailsFilter.toProblemDetails` so
 * the public error contract is preserved.
 *
 * Sentry capture is wrapped in a try/catch — telemetry must never break
 * request handling.
 */
@Injectable()
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    this.reportToSentry(exception, request);
    this.respond(exception, request, response);
  }

  private reportToSentry(exception: unknown, request: Request): void {
    if (!isSentryEnabled()) return;
    if (!this.shouldCapture(exception)) return;

    try {
      const sentry: SentryLike = getSentry();
      sentry.withScope((scope) => {
        scope.setTag("path", request.path ?? "unknown");
        scope.setTag("method", request.method ?? "UNKNOWN");
        const correlationId = readCorrelationId(request);
        if (correlationId) scope.setTag("correlation_id", correlationId);
        const problem = toProblemDetails(exception, correlationId ?? "unknown");
        scope.setTag("status", String(problem.status));
        scope.setTag("error_code", problem.code);
        sentry.captureException(exception);
      });
    } catch (err) {
      this.logger.warn(
        `Sentry capture failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private respond(
    exception: unknown,
    request: Request,
    response: Response,
  ): void {
    if (response.headersSent) return;
    const correlationId = readCorrelationId(request) ?? "unknown";
    const problem = toProblemDetails(exception, correlationId);

    if (problem.status >= 500) {
      this.logger.error(
        `${problem.code} ${request.method ?? "HTTP"} ${request.originalUrl ?? request.url ?? ""}`.trim(),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.setHeader("x-correlation-id", problem.correlation_id ?? correlationId);
    response
      .status(problem.status)
      .type("application/problem+json")
      .send(problem);
  }

  /**
   * Only forward genuinely unexpected errors to Sentry. 4xx HttpExceptions are
   * part of the public API contract and would generate alert noise.
   */
  private shouldCapture(exception: unknown): boolean {
    if (!(exception instanceof Error)) {
      // Non-Error throws (strings, objects) are still useful in Sentry.
      return true;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return status >= 500;
    }
    return true;
  }
}

function readCorrelationId(request: Request): string | undefined {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const raw = headers["x-correlation-id"] ?? headers["x-request-id"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}