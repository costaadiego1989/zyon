import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { assertServiceAdministration } from "../../../../shared/bookings/service-business-access.js";
import { getProfessionalAvailability } from "../../application/get-professional-availability.js";
import { validateAvailabilityWindow } from "../../domain/services/professional-availability.js";

export function parseProfessionalAvailabilityQuery(query: Record<string, unknown>, kind: "dates" | "slots", now = new Date()) {
  const allowed = ["productId", "variantId", "professionalId", "expectedVersion", ...(kind === "dates" ? ["fromDate", "toDate"] : ["date"])];
  if (Object.keys(query).some(key => !allowed.includes(key))) throw new BadRequestException("invalid_availability_query");
  for (const key of ["productId", "variantId", "professionalId"]) if (typeof query[key] !== "string" || !(query[key] as string).trim() || (query[key] as string).length > 191) throw new BadRequestException("invalid_availability_resource");
  const fromDate = (kind === "slots" ? query.date : query.fromDate) as string, toDate = (kind === "slots" ? query.date : query.toDate) as string;
  const expectedVersion = query.expectedVersion === undefined ? undefined : typeof query.expectedVersion === "string" && /^\d+$/.test(query.expectedVersion) ? Number(query.expectedVersion) : NaN;
  const result = { productId: query.productId as string, variantId: query.variantId as string, professionalId: query.professionalId as string, fromDate, toDate, now, ...(expectedVersion === undefined ? {} : { expectedVersion }) };
  validateAvailabilityWindow(result);
  return result;
}

@Controller("merchants/:mid/service-availability")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
export class ServiceAvailabilityController {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  @Get("dates")
  @RequireTenantRoles("owner", "admin", "staff")
  async dates(@Req() request: TenantPrincipalRequest, @Query() query: Record<string, unknown>) {
    const { slots: _slots, ...result } = await this.read(request, parseProfessionalAvailabilityQuery(query, "dates"));
    return result;
  }

  @Get("slots")
  @RequireTenantRoles("owner", "admin", "staff")
  slots(@Req() request: TenantPrincipalRequest, @Query() query: Record<string, unknown>) {
    return this.read(request, parseProfessionalAvailabilityQuery(query, "slots"));
  }

  private read(request: TenantPrincipalRequest, input: ReturnType<typeof parseProfessionalAvailabilityQuery>) {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human") throw new BadRequestException("human_session_required");
    const actor = { merchantId: principal.tenantId, userId: principal.userId, role: principal.role };
    return this.prisma.$transaction(async tx => {
      await assertServiceAdministration(tx, actor, false);
      return getProfessionalAvailability(tx, { ...input, merchantId: actor.merchantId });
    }, { isolationLevel: "RepeatableRead" });
  }
}
