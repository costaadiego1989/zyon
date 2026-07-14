import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Observable } from "rxjs";
import { tap } from "rxjs";
import type { Response } from "express";
import type { AacpHttpRequest } from "../../../shared/http/http-request.js";
import { RecordAuditEventUseCase } from "../application/audit.use-cases.js";
import { AUDIT_RESOURCE_KEY, AUDIT_RESOURCE_ID_KEY } from "./audit-resource.decorator.js";
import { principalToAuditActor } from "../domain/audit-actor.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditMutationInterceptor.name);

  constructor(
    private readonly recordAudit: RecordAuditEventUseCase,
    private readonly reflector: Reflector,
  ) {}

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

    // AUD-H2: Use @AuditResource decorator metadata if present; fall back to URL heuristic.
    const handler = context.getHandler();
    const controllerClass = context.getClass();
    const decoratorResource = this.reflector.getAllAndOverride<string | undefined>(AUDIT_RESOURCE_KEY, [handler, controllerClass]);
    const resourceType = decoratorResource ??
      path
        .split("/")
        .filter(Boolean)
        .find((segment) => segment !== "v1") ?? "unknown";

    // AUD-L1: Use decorator-specified param name or fall back to firstParam.
    const resourceIdParam = this.reflector.getAllAndOverride<string | undefined>(AUDIT_RESOURCE_ID_KEY, [handler, controllerClass]);
    const resourceId = resourceIdParam
      ? (request.params?.[resourceIdParam] as string | undefined)
      : firstParam(request.params);

    // AUD-H4: Convert to AuditActor to decouple from TenantPrincipal.
    const actor = principalToAuditActor(principal);

    return next.handle().pipe(
      tap({
        next: () => {
          // P3 fix: skip audit recording for idempotent replays.
          if (response.getHeader("Idempotency-Replayed")) return;

          // AUD-H1: Log failures; operators detect broken audit trail via alerts.
          void this.recordAudit
            .execute({
              merchantId: principal.tenantId,
              actor,
              action: `http.${request.method.toLowerCase()}`,
              resourceType,
              resourceId,
              correlationId: request.correlationId,
              metadata: truncateMetadata({
                method: request.method.toUpperCase(),
                path,
              }),
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

/**
 * AUD-M3: Limit metadata size to prevent DB bloat.
 * Truncates serialized metadata to 4KB max.
 */
const MAX_METADATA_SIZE = 4096;

function truncateMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(metadata);
  if (serialized.length <= MAX_METADATA_SIZE) return metadata;
  return { _truncated: true, method: metadata.method, path: metadata.path };
}
