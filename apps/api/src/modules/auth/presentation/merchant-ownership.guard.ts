import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { currentTenantPrincipal } from "../../../shared/auth/tenant-principal.js";

/**
 * MerchantOwnershipGuard: enforces the tenant boundary on routes that carry a
 * `:merchantId` path parameter.
 *
 * INVARIANT (CLAUDE.md): "merchant_id is the tenant boundary. Every query and
 * command must be scoped by merchant_id."
 *
 * Must run AFTER AuthGuard (which populates the tenant principal). Rejects any
 * request whose path merchantId does not match the authenticated principal's
 * tenantId, closing IDOR access to other tenants' dashboard/funnel/rules data.
 *
 * Query-scope endpoints that pass the token's own tenantId (never the path) do
 * not need this guard; it exists specifically for routes that trust a path id.
 */
@Injectable()
export class MerchantOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const principal = currentTenantPrincipal(request);
    const pathMerchantId: unknown = request.params?.merchantId;

    // Only enforce when the route actually carries a merchantId param.
    if (typeof pathMerchantId !== "string" || pathMerchantId.length === 0) {
      return true;
    }

    if (pathMerchantId !== principal.tenantId) {
      throw new ForbiddenException("cross_tenant_access_denied");
    }
    return true;
  }
}
