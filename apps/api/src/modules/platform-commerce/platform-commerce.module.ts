import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { ReadPlatformCommerceUseCases } from "./application/read-platform-commerce.use-cases.js";
import { PLATFORM_COMMERCE_REPOSITORY } from "./domain/ports/platform-commerce.repository.port.js";
import { PrismaPlatformCommerceRepository } from "./infrastructure/prisma-platform-commerce.repository.js";
import { PlatformCommerceController } from "./presentation/platform-commerce.controller.js";

@Module({
  imports: [PlatformControlModule],
  controllers: [PlatformCommerceController],
  providers: [
    ReadPlatformCommerceUseCases,
    { provide: PLATFORM_COMMERCE_REPOSITORY, useFactory: (prisma: PrismaClient) => new PrismaPlatformCommerceRepository(prisma), inject: [PRISMA_CLIENT] },
  ],
})
export class PlatformCommerceModule {}
