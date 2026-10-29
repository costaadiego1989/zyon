import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthenticateMerchantApiKeyService } from "./application/authenticate-merchant-api-key.service.js";
import { ApiKeyAccessPolicy } from "./domain/api-key-access-policy.js";
import { ApiKeyService } from "./domain/api-key.service.js";
import { INTEGRATIONS_REPOSITORY } from "./domain/ports/integrations.repository.port.js";
import { PrismaIntegrationsRepository } from "./infrastructure/prisma-integrations.repository.js";
import { TenantAccessGuard } from "./presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "./presentation/http/tenant-credential.guard.js";
import { BillingPlanMeteringService } from "../payment/domain/billing-plan-guard.js";

@Module({
  imports: [AuthModule],
  providers: [
    ApiKeyService,
    ApiKeyAccessPolicy,
    AuthenticateMerchantApiKeyService,
    BillingPlanMeteringService,
    TenantCredentialGuard,
    TenantAccessGuard,
    {
      provide: INTEGRATIONS_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaIntegrationsRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
  exports: [
    AuthModule,
    INTEGRATIONS_REPOSITORY,
    ApiKeyService,
    ApiKeyAccessPolicy,
    AuthenticateMerchantApiKeyService,
    TenantCredentialGuard,
    TenantAccessGuard,
  ],
})
export class TenantAccessModule {}
