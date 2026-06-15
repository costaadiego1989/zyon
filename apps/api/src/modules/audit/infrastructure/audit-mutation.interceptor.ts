import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs";
import type { AacpHttpRequest } from "../../../shared/http/http-request.js";
import { RecordAuditEventUseCase } from "../application/audit.use-cases.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  constructor(private readonly recordAudit: RecordAuditEventUseCase) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<AacpHttpRequest>();
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
            .catch(() => undefined);
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
