import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { TenantAccessModule } from "../integrations/tenant-access.module.js";
import {
  ListAuditEventsUseCase,
  RecordAuditEventUseCase,
} from "./application/audit.use-cases.js";
import { AUDIT_REPOSITORY } from "./domain/ports/audit-repository.port.js";
import { AuditMutationInterceptor } from "./infrastructure/audit-mutation.interceptor.js";
import { PrismaAuditRepository } from "./infrastructure/prisma-audit.repository.js";
import { AuditEventsController } from "./presentation/http/audit-events.controller.js";

@Module({
  imports: [TenantAccessModule],
  controllers: [AuditEventsController],
  providers: [
    RecordAuditEventUseCase,
    ListAuditEventsUseCase,
    {
      provide: AUDIT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaAuditRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditMutationInterceptor,
    },
  ],
  exports: [RecordAuditEventUseCase],
})
export class AuditModule {}
