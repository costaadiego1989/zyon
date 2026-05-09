import { Global, Module } from "@nestjs/common";
import { createPrismaClient } from "./prisma-client.js";
import { registerTenantMiddleware } from "./tenant.middleware.js";
import type { PrismaClient } from "@prisma/client";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      useFactory: (): PrismaClient => {
        const client = createPrismaClient();
        registerTenantMiddleware(client);
        return client;
      },
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PersistenceModule {}
