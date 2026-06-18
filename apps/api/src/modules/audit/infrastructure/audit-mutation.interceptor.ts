import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs";
import type { Response } from "express";
import type { AacpHttpRequest } from "../../../shared/http/http-request.js";
import { RecordAuditEventUseCase } from "../application/audit.use-cases.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditMutationInterceptor.name);

  constructor(private readonly recordAudit: RecordAuditEventUseCase) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<AacpHttpRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const principal = request.tenantPrincipal;
    if (!principal || !MUTATION_METHODS.has(request.method.toUpperCase())) {
      return next.handle();
    }

    const path = request.route?.path
      ? `${request.baseUrl ?? ""}${String(request.route.path)}`
      : request.path;
    const resourceType =
      path
        .split("/")
        .filter(Boolean)
        .find((segment) => segment !== "v1") ?? "unknown";
    const resourceId = firstParam(request.params);

    return next.handle().pipe(
      tap({
        next: () => {
          // P3 fix: skip audit recording for idempotent replays — the
          // IdempotencyInterceptor sets `Idempotency-Replayed: true` on the
          // response when it short-circuits with the cached body.
          if (response.getHeader("Idempotency-Replayed")) return;

          // P2 fix: log failures rather than silently swallowing them so
          // operators can detect a broken audit trail via log/metric alerts.
          void this.recordAudit
            .execute({
              principal,
              action: `http.${request.method.toLowerCase()}`,
              resourceType,
              resourceId,
              correlationId: request.correlationId,
              metadata: {
                method: request.method.toUpperCase(),
                path,
              },
            })
            .catch((error: unknown) => {
              this.logger.error(
                `Audit record failed for ${request.method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error.stack : undefined,
              );
            });
        },
      }),
    );
  }
}

function firstParam(
  params: Record<string, string | string[]> | undefined,
): string | undefined {
  if (!params) return undefined;
  for (const value of Object.values(params)) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}
