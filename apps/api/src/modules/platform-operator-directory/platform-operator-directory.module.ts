import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { ListPlatformOperatorDirectoryUseCase } from "./application/list-platform-operator-directory.use-case.js";
import { ManagePlatformOperatorAccessUseCase } from "./application/manage-platform-operator-access.use-case.js";
import { PLATFORM_OPERATOR_DIRECTORY_REPOSITORY } from "./domain/ports/platform-operator-directory-repository.port.js";
import { PrismaPlatformOperatorDirectoryRepository } from "./infrastructure/prisma-platform-operator-directory.repository.js";
import { PlatformOperatorDirectoryController } from "./presentation/platform-operator-directory.controller.js";

@Module({
  imports: [PlatformControlModule],
  controllers: [PlatformOperatorDirectoryController],
  providers: [
    ListPlatformOperatorDirectoryUseCase,
    ManagePlatformOperatorAccessUseCase,
    {
      provide: PLATFORM_OPERATOR_DIRECTORY_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformOperatorDirectoryRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
})
export class PlatformOperatorDirectoryModule {}
