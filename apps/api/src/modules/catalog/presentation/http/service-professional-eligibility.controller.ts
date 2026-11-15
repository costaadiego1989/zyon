import { BadRequestException, Controller, Get, Inject, NotFoundException, Query, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { assertServiceAdministration } from "../../../../shared/bookings/service-business-access.js";
import { publicProfessionalProfile, resolveProfessionalServiceLink } from "../../domain/services/professional-service-link.js";

@Controller("merchants/:mid/service-professionals/eligible")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
export class ServiceProfessionalEligibilityController {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  @Get()
  @RequireTenantRoles("owner", "admin", "staff")
  async list(@Req() request: TenantPrincipalRequest, @Query() query: Record<string, unknown>) {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human") throw new BadRequestException("human_session_required");
    if (Object.keys(query).some(key => !["productId", "variantId", "limit", "cursor"].includes(key)) || ["productId", "variantId"].some(key => typeof query[key] !== "string" || !(query[key] as string).trim() || (query[key] as string).length > 191)
      || (query.cursor !== undefined && (typeof query.cursor !== "string" || query.cursor.length > 191))) throw new BadRequestException("invalid_professional_eligibility_query");
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("invalid_professional_page");
    const actor = { merchantId: principal.tenantId, userId: principal.userId, role: principal.role };
    return this.prisma.$transaction(async tx => {
      await assertServiceAdministration(tx, actor, false);
      const product = await tx.product.findFirst({ where: { id: query.productId as string, merchantId: actor.merchantId, type: "service", isActive: true, deletedAt: null }, include: { category: true, variants: { where: { id: query.variantId as string, isActive: true }, include: { price: true }, take: 1 } } });
      const variant = product?.variants[0];
      if (!product || !variant || (product.categoryId && (!product.category || !product.category.isActive || product.category.merchantId !== actor.merchantId))) throw new NotFoundException("professional_service_not_found");
      const links = await tx.professionalService.findMany({ where: { merchantId: actor.merchantId, productId: product.id, isActive: true, professional: { isActive: true, isPublished: true }, ...(query.cursor ? { professionalId: { gt: query.cursor as string } } : {}) }, include: { professional: true }, orderBy: { professionalId: "asc" }, take: limit + 1 });
      const items = links.slice(0, limit).map(link => {
        const canonical = resolveProfessionalServiceLink({ merchantId: actor.merchantId, professional: link.professional, link, product, category: product.category, variant });
        return { ...canonical, publicName: link.professional.publicName, publicProfile: publicProfessionalProfile(link.professional.publicProfile) };
      });
      return { items, nextCursor: links.length > limit ? items.at(-1)!.professionalId : null };
    }, { isolationLevel: "RepeatableRead" });
  }
}
