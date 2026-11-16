import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { RedisModule } from "../../shared/cache/redis.module.js";
import { SUPPORT_REPOSITORY } from "./domain/platform-support.js";
import { PlatformSupportService } from "./application/platform-support.service.js";
import { PlatformSupportRateLimiter } from "./infrastructure/platform-support-rate-limiter.js";
import { PrismaPlatformSupportRepository } from "./infrastructure/prisma-platform-support.repository.js";
import { PlatformSupportRelay } from "./infrastructure/platform-support-relay.js";
import { MerchantPlatformSupportController, OperatorPlatformSupportController, PlatformSupportErrorFilter } from "./presentation/platform-support.controller.js";
import { PlatformSupportGateway } from "./presentation/platform-support.gateway.js";

@Module({
  imports: [AuthModule, PlatformControlModule, RedisModule],
  controllers: [MerchantPlatformSupportController, OperatorPlatformSupportController],
  providers: [PlatformSupportService, PlatformSupportRateLimiter, PlatformSupportRelay, PlatformSupportGateway, PlatformSupportErrorFilter, { provide: SUPPORT_REPOSITORY, useClass: PrismaPlatformSupportRepository }],
})
export class PlatformSupportModule {}
