import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { TenantContextService } from "./tenant-context.service.js";

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ tenantContextService?: TenantContextService; user?: { merchantId: string } }>();
    const user = request.user;
    if (!user?.merchantId) throw new UnauthorizedException("missing_tenant_context");
    return user.merchantId;
  }
);
