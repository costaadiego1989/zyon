import { Global, Module } from "@nestjs/common";
import { createPrismaClient } from "./prisma-client.js";
import { registerTenantMiddleware } from "./tenant.middleware.js";
import { TenantContextService } from "../tenant/tenant-context.service.js";
import type { PrismaClient } from "@prisma/client";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      useFactory: (tenantCtx: TenantContextService): PrismaClient => {
        const client = createPrismaClient();
        return registerTenantMiddleware(client, tenantCtx) as unknown as PrismaClient;
      },
      inject: [TenantContextService],
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PersistenceModule {}
