/**
 * Domains controller.
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  NotFoundException,
  Inject,
  UseGuards,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CurrentTenant } from "../../../../shared/tenant/current-tenant.decorator.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { isBillingFeatureEnabled } from "../../../payment/domain/billing-plans.js";
import { RegisterDomainUseCase } from "../../application/use-cases/register-domain.use-case.js";
import { VerifyDomainUseCase } from "../../application/use-cases/verify-domain.use-case.js";
import { ListDomainsUseCase } from "../../application/use-cases/list-domains.use-case.js";

@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("customDomain")
@Controller("merchants/me/domains")
export class DomainsController {
  constructor(
    private readonly registerDomain: RegisterDomainUseCase,
    private readonly verifyDomain: VerifyDomainUseCase,
    private readonly listDomains: ListDomainsUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  @Get()
  async list(@CurrentTenant() merchantId: string) {
    return this.listDomains.execute(merchantId);
  }

  @Post()
  async register(
    @CurrentTenant() merchantId: string,
    @Body() body: { domain: string },
  ) {
    return this.registerDomain.execute({
      merchant_id: merchantId,
      domain: body.domain,
    });
  }

  @Post(":domainId/verify")
  async verify(
    @CurrentTenant() merchantId: string,
    @Param("domainId") domainId: string,
  ) {
    return this.verifyDomain.execute({
      merchant_id: merchantId,
      domain_id: domainId,
    });
  }

  @Delete(":domainId")
  async remove(
    @CurrentTenant() merchantId: string,
    @Param("domainId") domainId: string,
  ) {
    const record = await this.prisma.merchantDomain.findFirst({
      where: { id: domainId, merchantId },
    });
    if (!record) throw new NotFoundException("domain_not_found");

    await this.prisma.merchantDomain.delete({ where: { id: domainId } });
    return { success: true };
  }
}

/**
 * Caddy On-Demand TLS endpoint.
 * Caddy calls this to decide if it should issue a cert for a given domain.
 * Returns 200 = issue cert. 404 = deny.
 */
@Controller("domains")
export class DomainCheckController {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  @Get("check")
  async check(@Query("domain") domain: string) {
    if (!domain?.trim()) throw new NotFoundException("missing_domain");

    const record = await this.prisma.merchantDomain.findUnique({
      where: { domain: domain.trim().toLowerCase().replace(/\.$/, "") },
    });

    if (!record || !record.verified || !record.ownershipVerifiedAt) {
      throw new NotFoundException("domain_not_verified");
    }
    const subscription = await this.prisma.merchantBillingSubscription.findUnique({
      where: { merchantId: record.merchantId },
      select: { status: true, trialEndsAt: true, stripePriceId: true, planKey: true },
    });
    if (!isBillingFeatureEnabled(subscription, "customDomain")) {
      throw new NotFoundException("domain_plan_unavailable");
    }

    return { ok: true, domain: record.domain, merchantId: record.merchantId };
  }
}
