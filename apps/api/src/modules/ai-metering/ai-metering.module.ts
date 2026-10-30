import { Global, Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { RedisModule } from "../../shared/cache/redis.module.js";
import { TenantModule } from "../../shared/tenant/tenant.module.js";
import { TenantAccessModule } from "../integrations/tenant-access.module.js";
import { AiGovernanceService } from "../ai-governance/ai-governance.service.js";
import { MerchantAiGovernanceController, PlatformAiGovernanceController, AiToolAuthorizationController } from "../ai-governance/ai-governance.controller.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { AiMeteringService } from "./ai-metering.service.js";
import { AiCostsController } from "./ai-costs.controller.js";
import { AiCostsReader } from "./ai-costs.reader.js";
import { MerchantAiUsageReader } from "./merchant-ai-usage.reader.js";
import { MerchantAiUsageController } from "./merchant-ai-usage.controller.js";
@Global()
@Module({ imports: [PersistenceModule, RedisModule, TenantModule, PlatformControlModule, TenantAccessModule],
  providers: [AiMeteringService, AiCostsReader, MerchantAiUsageReader, AiGovernanceService],
  controllers: [AiCostsController, MerchantAiUsageController, MerchantAiGovernanceController, PlatformAiGovernanceController, AiToolAuthorizationController],
  exports: [AiMeteringService, AiGovernanceService] })
export class AiMeteringModule {}
