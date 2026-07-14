import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BUYER_ACCOUNT_REPOSITORY } from "./domain/ports/buyer-account-repository.port.js";
import { BUYER_ADDRESS_REPOSITORY } from "./domain/ports/buyer-address.port.js";
import { BUYER_CONVERSATION_REPOSITORY } from "./domain/ports/buyer-conversation.port.js";
import { PrismaBuyerAccountRepository } from "./infrastructure/prisma-buyer-account.repository.js";
import { PrismaBuyerAddressRepository } from "./infrastructure/prisma-buyer-address.repository.js";
import { PrismaBuyerConversationRepository } from "./infrastructure/prisma-buyer-conversation.repository.js";
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
    {
      provide: BUYER_ADDRESS_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerAddressRepository(prisma),
      inject: [BUYER_ACCOUNT_PRISMA_CLIENT],
    },
    {
      provide: BUYER_CONVERSATION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerConversationRepository(prisma),
      inject: [BUYER_ACCOUNT_PRISMA_CLIENT],
    },
  ],
  exports: [
    BUYER_ACCOUNT_REPOSITORY,
    BUYER_ADDRESS_REPOSITORY,
    BUYER_CONVERSATION_REPOSITORY,
    BUYER_ACCOUNT_PRISMA_CLIENT,
  ],
})
export class BuyerAccountRepositoryModule {}
