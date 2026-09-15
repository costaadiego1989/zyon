import { Global, Module, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { createPrismaClient } from "./prisma-client.js";
import { registerTenantMiddleware } from "./tenant.middleware.js";
import { TenantContextService } from "../tenant/tenant-context.service.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { PrismaClient } from "@prisma/client";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
// Privileged marketplace repositories enforce host/seller and partner boundaries themselves.
// Reuse the lifecycle-managed pool without implicitly replacing a seller with the caller.
export const PRISMA_CROSS_MERCHANT_CLIENT = Symbol("PRISMA_CROSS_MERCHANT_CLIENT");

export class PrismaLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(public readonly client: PrismaClient, public readonly crossMerchantClient: PrismaClient = client) {}

  async onModuleInit() {
    await this.client.$connect();
  }

  async onApplicationShutdown() {
    await this.client.$disconnect();
  }
}

@Global()
@Module({
  imports: [TenantModule],
  providers: [
    {
      provide: PrismaLifecycle,
      useFactory: (tenantCtx: TenantContextService): PrismaLifecycle => {
        const client = createPrismaClient();
        const wrapped = registerTenantMiddleware(client, tenantCtx) as unknown as PrismaClient;
        return new PrismaLifecycle(wrapped, client);
      },
      inject: [TenantContextService],
    },
    {
      provide: PRISMA_CROSS_MERCHANT_CLIENT,
      useFactory: (lifecycle: PrismaLifecycle): PrismaClient => lifecycle.crossMerchantClient,
      inject: [PrismaLifecycle],
    },
    {
      provide: PRISMA_CLIENT,
      useFactory: (lifecycle: PrismaLifecycle): PrismaClient => lifecycle.client,
      inject: [PrismaLifecycle],
    },
  ],
  exports: [PRISMA_CLIENT, PRISMA_CROSS_MERCHANT_CLIENT],
})
export class PersistenceModule {}
