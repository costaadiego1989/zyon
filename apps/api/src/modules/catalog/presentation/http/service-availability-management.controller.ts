import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { assertServiceAdministration } from "../../../../shared/bookings/service-business-access.js";
import { SaveProfessionalAvailabilityUseCase } from "../../application/save-professional-availability.use-case.js";
import { SaveAvailabilityExceptionUseCase, type AvailabilityExceptionInput } from "../../application/save-availability-exception.use-case.js";
import type { RecurringAvailabilityInput } from "../../domain/services/professional-availability-input.js";

function operator(request: TenantPrincipalRequest) {
  const principal = currentTenantPrincipal(request);
  if (principal.kind !== "human") throw new BadRequestException("human_session_required");
  return { merchantId: principal.tenantId, userId: principal.userId, role: principal.role };
}
export function availabilityMutationEnvelope<T>(body: unknown): { expectedVersion: number; input: T } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("invalid_availability_payload");
  const { expectedVersion, ...input } = body as { expectedVersion: number };
  return { expectedVersion, input: input as T };
}

@Controller("merchants/:mid/service-professionals/:professionalId")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
@RequireTenantRoles("owner", "admin")
export class ServiceAvailabilityManagementController {
  constructor(
    private readonly recurring: SaveProfessionalAvailabilityUseCase,
    private readonly exceptions: SaveAvailabilityExceptionUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  @Get("availability")
  async read(@Req() request: TenantPrincipalRequest, @Param("professionalId") professionalId: string, @Query("cursor") cursor?: string) {
    const actor = operator(request);
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 191)) throw new BadRequestException("invalid_availability_page");
    return this.prisma.$transaction(async tx => {
      await assertServiceAdministration(tx, actor);
      const professional = await tx.serviceProfessional.findFirst({ where: { id: professionalId, merchantId: actor.merchantId }, select: { id: true, version: true, timeZone: true } });
      if (!professional) throw new NotFoundException("service_professional_not_found");
      const rows = await tx.professionalAvailability.findMany({ where: { professionalId, merchantId: actor.merchantId, isActive: true }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }], take: 100 });
      const exceptions = await tx.availabilityException.findMany({ where: { professionalId, merchantId: actor.merchantId, isActive: true, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 101 });
      return { professionalId, version: professional.version, timeZone: professional.timeZone, rows, exceptions: exceptions.slice(0,100), nextCursor: exceptions.length > 100 ? exceptions[99]!.id : null };
    }, { isolationLevel: "RepeatableRead" });
  }

  @Put("availability")
  saveRecurring(@Req() request: TenantPrincipalRequest, @Param("professionalId") professionalId: string, @Body() body: RecurringAvailabilityInput & { expectedVersion: number }) {
    const envelope = availabilityMutationEnvelope<RecurringAvailabilityInput>(body);
    return this.recurring.execute(operator(request), professionalId, envelope.expectedVersion, envelope.input);
  }

  @Post("availability-exceptions")
  saveException(@Req() request: TenantPrincipalRequest, @Param("professionalId") professionalId: string, @Body() body: AvailabilityExceptionInput & { expectedVersion: number }) {
    const envelope = availabilityMutationEnvelope<AvailabilityExceptionInput>(body);
    if (Object.hasOwn(envelope.input, "id")) throw new BadRequestException("invalid_availability_exception");
    return this.exceptions.execute(operator(request), professionalId, envelope.expectedVersion, envelope.input);
  }

  @Patch("availability-exceptions/:exceptionId")
  editException(@Req() request: TenantPrincipalRequest, @Param("professionalId") professionalId: string, @Param("exceptionId") exceptionId: string, @Body() body: AvailabilityExceptionInput & { expectedVersion: number }) {
    const envelope = availabilityMutationEnvelope<AvailabilityExceptionInput>(body);
    if (Object.hasOwn(envelope.input, "id")) throw new BadRequestException("invalid_availability_exception");
    return this.exceptions.execute(operator(request), professionalId, envelope.expectedVersion, { ...envelope.input, id: exceptionId });
  }
}
