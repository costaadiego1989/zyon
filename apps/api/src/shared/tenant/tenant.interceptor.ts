import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import type { AacpHttpRequest } from "../http/http-request.js";
import { TenantContextService } from "./tenant-context.service.js";
import {
  type TenantRequest,
  validateTenantRequest,
} from "./tenant.guard.js";

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantCtx: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<TenantRequest & AacpHttpRequest>();
    const tenant = validateTenantRequest(request);
    if (!tenant) return next.handle();

    const scoped = { ...tenant, correlationId: correlationIdFrom(request) };

    return new Observable((subscriber) =>
      this.tenantCtx.run(scoped, () => next.handle().subscribe(subscriber)),
    );
  }
}

function correlationIdFrom(request: TenantRequest): string {
  if (
    "correlationId" in request &&
    typeof request.correlationId === "string"
  ) {
    return request.correlationId;
  }
  const header = request.headers?.["x-correlation-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.trim().length > 0
    ? value
    : `corr_${randomUUID()}`;
}
