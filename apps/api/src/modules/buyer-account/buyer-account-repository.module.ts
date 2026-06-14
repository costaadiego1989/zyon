import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BUYER_ACCOUNT_REPOSITORY } from "./domain/ports/buyer-account-repository.port.js";
import { PrismaBuyerAccountRepository } from "./infrastructure/prisma-buyer-account.repository.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "./buyer-account.tokens.js";

@Module({
  providers: [
    {
      provide: BUYER_ACCOUNT_PRISMA_CLIENT,
      useExisting: PRISMA_CLIENT,
    },
    {
      provide: BUYER_ACCOUNT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerAccountRepository(prisma),
      inject: [BUYER_ACCOUNT_PRISMA_CLIENT],
    },
  ],
  exports: [BUYER_ACCOUNT_REPOSITORY, BUYER_ACCOUNT_PRISMA_CLIENT],
})
export class BuyerAccountRepositoryModule {}
