import { Global, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createPrismaClient } from "./prisma-client.js";
import { registerTenantMiddleware } from "./tenant.middleware.js";
import { TenantContextService } from "../tenant/tenant-context.service.js";
import { PrismaClient } from "@prisma/client";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

class PrismaLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(public readonly client: PrismaClient) {}

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PrismaLifecycle,
      useFactory: (tenantCtx: TenantContextService): PrismaLifecycle => {
        const client = createPrismaClient();
        const wrapped = registerTenantMiddleware(client, tenantCtx) as unknown as PrismaClient;
        return new PrismaLifecycle(wrapped);
      },
      inject: [TenantContextService],
    },
    {
      provide: PRISMA_CLIENT,
      useFactory: (lifecycle: PrismaLifecycle): PrismaClient => lifecycle.client,
      inject: [PrismaLifecycle],
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PersistenceModule {}
