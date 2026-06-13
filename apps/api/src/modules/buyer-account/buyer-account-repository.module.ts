import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BUYER_ACCOUNT_REPOSITORY } from "./domain/ports/buyer-account-repository.port.js";
import { InMemoryBuyerAccountRepository } from "./infrastructure/in-memory-buyer-account.repository.js";
import { PrismaBuyerAccountRepository } from "./infrastructure/prisma-buyer-account.repository.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "./buyer-account.tokens.js";

@Module({
  providers: [
    InMemoryBuyerAccountRepository,
    {
      provide: BUYER_ACCOUNT_PRISMA_CLIENT,
      useExisting: PRISMA_CLIENT,
    },
    {
      provide: BUYER_ACCOUNT_REPOSITORY,
      useFactory: (inMemory: InMemoryBuyerAccountRepository, prisma: PrismaClient) => {
        if (process.env.BUYER_ACCOUNT_REPOSITORY === "prisma" || process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaBuyerAccountRepository(prisma);
        }
        return inMemory;
      },
      inject: [InMemoryBuyerAccountRepository, PRISMA_CLIENT],
    },
  ],
  exports: [BUYER_ACCOUNT_REPOSITORY, BUYER_ACCOUNT_PRISMA_CLIENT],
})
export class BuyerAccountRepositoryModule {}
