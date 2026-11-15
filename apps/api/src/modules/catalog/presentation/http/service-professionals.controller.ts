import { BadRequestException, Body, Controller, Get, Inject, Optional, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { PrismaServiceProfessionalRepository } from "../../infrastructure/repositories/prisma-service-professional.repository.js";
import type { ServiceProfessionalInput } from "../../domain/services/service-professional-input.js";
import type { ServiceActor } from "../../../../shared/bookings/service-business-access.js";

function actor(request: TenantPrincipalRequest): ServiceActor {
  const principal = currentTenantPrincipal(request);
  if (principal.kind !== "human") throw new BadRequestException("human_session_required");
  return { merchantId: principal.tenantId, userId: principal.userId, role: principal.role };
}

@Controller("merchants/:mid/service-professionals")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
export class ServiceProfessionalsController {
  constructor(
    private readonly professionals: PrismaServiceProfessionalRepository,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly events?: DomainEventBus,
  ) {}

  @Get()
  @RequireTenantRoles("owner", "admin", "staff")
  list(@Req() request: TenantPrincipalRequest, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.professionals.list(actor(request), { ...(limit === undefined ? {} : { limit: Number(limit) }), cursor });
  }

  @Post()
  @RequireTenantRoles("owner", "admin")
  async create(@Req() request: TenantPrincipalRequest, @Body() body: ServiceProfessionalInput) {
    return this.publish(actor(request), await this.professionals.create(actor(request), body));
  }

  @Patch(":professionalId")
  @RequireTenantRoles("owner", "admin")
  async update(@Req() request: TenantPrincipalRequest, @Param("professionalId") id: string, @Body() body: Partial<ServiceProfessionalInput> & { expectedVersion: number }) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("invalid_professional");
    const { expectedVersion, ...changes } = body;
    return this.publish(actor(request), await this.professionals.update(actor(request), id, expectedVersion, changes));
  }

  @Post(":professionalId/deactivate")
  @RequireTenantRoles("owner", "admin")
  async deactivate(@Req() request: TenantPrincipalRequest, @Param("professionalId") id: string, @Body() body: { expectedVersion: number }) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "expectedVersion")) throw new BadRequestException("invalid_professional");
    return this.publish(actor(request), await this.professionals.deactivate(actor(request), id, body.expectedVersion));
  }

  private async publish<T extends { id: string; version: number; isActive: boolean; isPublished: boolean }>(operator: ServiceActor, professional: T): Promise<T> {
    await this.events?.publish({ eventType: "service.professional.changed", schemaVersion: 1, merchantId: operator.merchantId,
      payload: { professionalId: professional.id, version: professional.version, publicationState: professional.isActive && professional.isPublished ? "published" : "withdrawn" } });
    return professional;
  }
}
