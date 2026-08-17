/**
 * Custom domains module.
 */

import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { RegisterDomainUseCase } from "./application/use-cases/register-domain.use-case.js";
import { VerifyDomainUseCase } from "./application/use-cases/verify-domain.use-case.js";
import { ListDomainsUseCase } from "./application/use-cases/list-domains.use-case.js";
import { DnsVerificationService } from "./infrastructure/dns-verification.service.js";
import { DomainsController, DomainCheckController } from "./presentation/http/domains.controller.js";

@Module({
  imports: [PersistenceModule],
  controllers: [DomainsController, DomainCheckController],
  providers: [
    DnsVerificationService,
    RegisterDomainUseCase,
    VerifyDomainUseCase,
    ListDomainsUseCase,
  ],
  exports: [
    RegisterDomainUseCase,
    VerifyDomainUseCase,
    ListDomainsUseCase,
  ],
})
export class DomainsModule {}
