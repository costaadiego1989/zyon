import { Module } from "@nestjs/common";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import { PasswordHasher } from "../auth/domain/services/password-hasher.service.js";
import { RegisterBuyerUseCase } from "./application/use-cases/register-buyer.use-case.js";
import { LoginBuyerUseCase } from "./application/use-cases/login-buyer.use-case.js";
import { GetBuyerProfileUseCase } from "./application/use-cases/get-buyer-profile.use-case.js";
import { UpdateBuyerProfileUseCase } from "./application/use-cases/update-buyer-profile.use-case.js";
import { ChangeBuyerPasswordUseCase } from "./application/use-cases/change-buyer-password.use-case.js";
import { GetBuyerPurchasesUseCase } from "./application/use-cases/get-buyer-purchases.use-case.js";
import { UpsertBuyerAgentUseCase } from "./application/use-cases/upsert-buyer-agent.use-case.js";
import { EnableM2mAgentUseCase } from "./application/use-cases/enable-m2m-agent.use-case.js";
import { RevokeM2mAgentUseCase } from "./application/use-cases/revoke-m2m-agent.use-case.js";
import { GetBuyerSummaryUseCase } from "./application/use-cases/get-buyer-summary.use-case.js";
import { SendBuyerPhoneCodeUseCase } from "./application/use-cases/send-buyer-phone-code.use-case.js";
import { VerifyBuyerPhoneCodeUseCase } from "./application/use-cases/verify-buyer-phone-code.use-case.js";
import { BUYER_ACCOUNT_REPOSITORY } from "./domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "./domain/services/buyer-jwt.service.js";
import { M2mTokenService } from "./domain/services/m2m-token.service.js";
import { InMemoryBuyerAccountRepository } from "./infrastructure/in-memory-buyer-account.repository.js";
import { PrismaBuyerAccountRepository } from "./infrastructure/prisma-buyer-account.repository.js";
import { BuyerJwtAuthGuard } from "./presentation/http/buyer-jwt-auth.guard.js";
import { BuyerAccountController } from "./presentation/http/buyer-account.controller.js";
import { BuyerAgentController } from "./presentation/http/buyer-agent.controller.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "./buyer-account.tokens.js";

@Module({
  controllers: [BuyerAccountController, BuyerAgentController],
  providers: [
    RegisterBuyerUseCase,
    LoginBuyerUseCase,
    GetBuyerProfileUseCase,
    UpdateBuyerProfileUseCase,
    ChangeBuyerPasswordUseCase,
    GetBuyerPurchasesUseCase,
    UpsertBuyerAgentUseCase,
    EnableM2mAgentUseCase,
    RevokeM2mAgentUseCase,
    GetBuyerSummaryUseCase,
    SendBuyerPhoneCodeUseCase,
    VerifyBuyerPhoneCodeUseCase,
    BuyerJwtService,
    BuyerJwtAuthGuard,
    M2mTokenService,
    PasswordHasher,
    InMemoryBuyerAccountRepository,
    {
      provide: BUYER_ACCOUNT_PRISMA_CLIENT,
      useFactory: () => createPrismaClient(),
    },
    {
      provide: BUYER_ACCOUNT_REPOSITORY,
      useFactory: (inMemory: InMemoryBuyerAccountRepository) => {
        if (process.env.BUYER_ACCOUNT_REPOSITORY === "prisma" || process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaBuyerAccountRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemoryBuyerAccountRepository],
    },
  ],
  exports: [BuyerJwtService, BuyerJwtAuthGuard, BUYER_ACCOUNT_REPOSITORY],
})
export class BuyerAccountModule {}
