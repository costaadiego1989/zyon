import { Global, Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { RedisModule } from "../../shared/cache/redis.module.js";
import { TenantModule } from "../../shared/tenant/tenant.module.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { AiMeteringService } from "./ai-metering.service.js";
import { AiCostsController } from "./ai-costs.controller.js";
import { AiCostsReader } from "./ai-costs.reader.js";
import { MerchantAiUsageReader } from "./merchant-ai-usage.reader.js";
import { MerchantAiUsageController } from "./merchant-ai-usage.controller.js";
@Global()
@Module({ imports: [PersistenceModule, RedisModule, TenantModule, PlatformControlModule], providers: [AiMeteringService, AiCostsReader, MerchantAiUsageReader], controllers: [AiCostsController, MerchantAiUsageController], exports: [AiMeteringService] })
export class AiMeteringModule {}
