import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { ListPlatformMerchantDirectoryUseCase } from "./application/list-platform-merchant-directory.use-case.js";
import { PLATFORM_MERCHANT_DIRECTORY_REPOSITORY } from "./domain/ports/platform-merchant-directory-repository.port.js";
import { PrismaPlatformMerchantDirectoryRepository } from "./infrastructure/prisma-platform-merchant-directory.repository.js";
import { PlatformMerchantDirectoryController } from "./presentation/platform-merchant-directory.controller.js";

@Module({
  imports: [PlatformControlModule],
  controllers: [PlatformMerchantDirectoryController],
  providers: [
    ListPlatformMerchantDirectoryUseCase,
    {
      provide: PLATFORM_MERCHANT_DIRECTORY_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformMerchantDirectoryRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
})
export class PlatformMerchantDirectoryModule {}
