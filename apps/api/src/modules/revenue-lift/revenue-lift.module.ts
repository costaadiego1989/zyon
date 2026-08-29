import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { HoldoutGroupService } from "./domain/services/holdout-group.service.js";
import { AttributionTaggerService } from "./domain/services/attribution-tagger.service.js";
import { RevenueLiftCalculatorService } from "./domain/services/revenue-lift-calculator.service.js";
import { RevenueLiftRepository } from "./infrastructure/revenue-lift.repository.js";
import { GetRevenueLiftUseCase, GetRevenueLiftTrendUseCase } from "./application/use-cases/get-revenue-lift.use-case.js";
import { RevenueLiftController } from "./presentation/http/revenue-lift.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

@Module({
  imports: [PersistenceModule],
  controllers: [RevenueLiftController],
  providers: [
    HoldoutGroupService,
    AttributionTaggerService,
    RevenueLiftCalculatorService,
    RevenueLiftRepository,
    GetRevenueLiftUseCase,
    GetRevenueLiftTrendUseCase,
    BillingPlanMeteringService,
    PlanLimitGuard,
  ],
  exports: [
    HoldoutGroupService,
    AttributionTaggerService,
    RevenueLiftCalculatorService,
  ]
})
export class RevenueLiftModule {}
