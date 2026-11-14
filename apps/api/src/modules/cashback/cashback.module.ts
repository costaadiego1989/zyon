import { Global, Module } from "@nestjs/common";
import { CashbackRepository } from "./infrastructure/cashback.repository.js";
import { CashbackService } from "./application/cashback.service.js";
import { CashbackQueriesService } from "./application/cashback-queries.service.js";
import { CASHBACK_REPOSITORY } from "./domain/ports/cashback-repository.port.js";
import { CheckoutCommercialBenefitsService } from "./application/checkout-commercial-benefits.service.js";

@Global()
@Module({ providers: [CashbackRepository, { provide: CASHBACK_REPOSITORY, useExisting: CashbackRepository }, CheckoutCommercialBenefitsService, CashbackService, CashbackQueriesService], exports: [CASHBACK_REPOSITORY, CashbackRepository, CheckoutCommercialBenefitsService, CashbackService, CashbackQueriesService] })
export class CashbackCoreModule {}
