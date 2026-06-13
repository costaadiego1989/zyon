import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { TenantContextService } from "./tenant-context.service.js";
import {
  type TenantRequest,
  validateTenantRequest,
} from "./tenant.guard.js";

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantCtx: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const tenant = validateTenantRequest(request);
    if (!tenant) return next.handle();

    return new Observable((subscriber) =>
      this.tenantCtx.run(tenant, () => next.handle().subscribe(subscriber)),
    );
  }
}
