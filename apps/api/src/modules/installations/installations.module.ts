import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { TenantAccessModule } from "../integrations/tenant-access.module.js";
import {
  CreateInstallationUseCase,
  GetInstallationUseCase,
  ListInstallationsUseCase,
  ReportInstallationHealthUseCase,
  ResolveInstallationForEmbedUseCase,
  UpdateInstallationUseCase,
} from "./application/installation.use-cases.js";
import { INSTALLATION_REPOSITORY } from "./domain/ports/installation-repository.port.js";
import { PrismaInstallationRepository } from "./infrastructure/prisma-installation.repository.js";
import { InstallationsController } from "./presentation/http/installations.controller.js";

@Module({
  imports: [TenantAccessModule],
  controllers: [InstallationsController],
  providers: [
    ListInstallationsUseCase,
    GetInstallationUseCase,
    CreateInstallationUseCase,
    UpdateInstallationUseCase,
    ReportInstallationHealthUseCase,
    ResolveInstallationForEmbedUseCase,
    {
      provide: INSTALLATION_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaInstallationRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
  exports: [GetInstallationUseCase, ResolveInstallationForEmbedUseCase, ListInstallationsUseCase, CreateInstallationUseCase, UpdateInstallationUseCase],
})
export class InstallationsModule {}
