import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { HoldoutGroupService } from "./domain/services/holdout-group.service.js";
import { AttributionTaggerService } from "./domain/services/attribution-tagger.service.js";
import { RevenueLiftCalculatorService } from "./domain/services/revenue-lift-calculator.service.js";
import { RevenueLiftController } from "./presentation/http/revenue-lift.controller.js";

@Module({
  imports: [PersistenceModule],
  controllers: [RevenueLiftController],
  providers: [
    HoldoutGroupService,
    AttributionTaggerService,
    RevenueLiftCalculatorService
  ],
  exports: [
    HoldoutGroupService,
    AttributionTaggerService,
    RevenueLiftCalculatorService
  ]
})
export class RevenueLiftModule {}
