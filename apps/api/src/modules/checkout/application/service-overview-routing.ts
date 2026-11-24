import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { currentTenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { resolveServiceBusinessPolicy, ServiceBusinessPolicyError } from "../../merchant/domain/service-business-policy.js";

/** Additional business-basis restriction, not an authorization replacement.
 * Existing auth/ownership/role/plan/API-key-scope guards must precede this one.
 * Legacy commerce totals and series are never re-labelled as service metrics. */
@Injectable()
export class ProductAnalyticsGuard implements CanActivate {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const principal = currentTenantPrincipal(request);
    const merchantId = principal.tenantId;
    if (typeof merchantId !== "string" || !merchantId || merchantId.trim() !== merchantId || merchantId.length > 191
      || /[\u0000-\u001f\u007f]/.test(merchantId) || !["human", "service"].includes(principal.kind))
      throw new UnauthorizedException("invalid_tenant_principal");
    if (principal.kind === "human" && (!principal.userId || !["owner", "admin", "staff"].includes(principal.role)))
      throw new ForbiddenException("tenant_role_required");
    const principalIdentity = JSON.stringify(principal);
    const pathMerchant = request.params?.merchantId ?? request.params?.mid;
    // Checkout/storefront ownership guards already enforce their path boundary.
    // AnalyticsController historically checks access_denied inside the method;
    // keep that denial before any new classification read as well.
    if (pathMerchant !== undefined && pathMerchant !== merchantId) throw new ForbiddenException("access_denied");
    await this.prisma.$transaction(async tx => {
      const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: {
        businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
      } });
      if (!merchant) throw new NotFoundException("merchant_not_found");
      const hasLegacyServiceData = !merchant.businessModeSelectedAt && (await tx.product.count({ where: { merchantId, type: "service" } }) > 0
        || await tx.serviceReservation.count({ where: { merchantId } }) > 0);
      let business: ReturnType<typeof resolveServiceBusinessPolicy>;
      try { business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData, policy: null }); }
      catch (error) {
        if (error instanceof ServiceBusinessPolicyError) throw new ConflictException("business_mode_classification_required");
        throw error;
      }
      if (business.selectionState === "review_required") throw new ConflictException("business_mode_classification_required");
      if (business.businessMode === "services") throw new ConflictException({ code: "service_metrics_endpoint_required",
        message: `Esta consulta usa indicadores de produtos. Para serviços, use GET /v1/merchants/${encodeURIComponent(merchantId)}/service-metrics com fromDate e toDate: até 31 dias, no horário de Brasília. O endpoint exige suas próprias permissões de acesso.` });
    }, { isolationLevel: "RepeatableRead" });
    // Request identity/path must still match the scope actually inspected.
    if (currentTenantPrincipal(request) !== principal || JSON.stringify(principal) !== principalIdentity || principal.tenantId !== merchantId
      || (request.params?.merchantId ?? request.params?.mid) !== pathMerchant) throw new ForbiddenException("access_denied");
    return true;
  }
}
