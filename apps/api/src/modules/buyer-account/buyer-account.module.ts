import { Module, forwardRef } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PasswordHasher } from "../auth/domain/services/password-hasher.service.js";
import { RegisterBuyerUseCase } from "./application/use-cases/register-buyer.use-case.js";
import { LoginBuyerUseCase } from "./application/use-cases/login-buyer.use-case.js";
import { LoginBuyerFromSessionUseCase } from "./application/use-cases/login-buyer-from-session.use-case.js";
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
import { BuyerJwtService } from "./domain/services/buyer-jwt.service.js";
import { M2mTokenService } from "./domain/services/m2m-token.service.js";
import { BuyerJwtAuthGuard } from "./presentation/http/buyer-jwt-auth.guard.js";
import { BuyerAccountController } from "./presentation/http/buyer-account.controller.js";
import { BuyerAgentController } from "./presentation/http/buyer-agent.controller.js";
import { BuyerAccountRepositoryModule } from "./buyer-account-repository.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { OTP_STORE } from "./domain/ports/otp-store.port.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "./buyer-account.tokens.js";
import { PrismaOtpStore } from "./infrastructure/prisma-otp-store.js";

@Module({
  imports: [BuyerAccountRepositoryModule, BuyerPurchaseHistoryModule, forwardRef(() => CheckoutModule), IntegrationsModule],
  controllers: [BuyerAccountController, BuyerAgentController],
  providers: [
    RegisterBuyerUseCase,
    LoginBuyerUseCase,
    LoginBuyerFromSessionUseCase,
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
    {
      provide: OTP_STORE,
      useFactory: (prisma: PrismaClient) => new PrismaOtpStore(prisma),
      inject: [BUYER_ACCOUNT_PRISMA_CLIENT],
    },
  ],
  exports: [BuyerJwtService, BuyerJwtAuthGuard, BuyerAccountRepositoryModule],
})
export class BuyerAccountModule {}
