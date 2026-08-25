import { Module, forwardRef, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { PasswordHasher } from "../auth/domain/services/password-hasher.service.js";
import { SMS_PROVIDER } from "./domain/ports/sms.port.js";
import { REDIS_CLIENT_TOKEN } from "../../shared/cache/redis.module.js";
import { SendBuyerEmailCodeUseCase } from "./application/use-cases/send-buyer-email-code.use-case.js";
import { VerifyBuyerEmailCodeUseCase } from "./application/use-cases/verify-buyer-email-code.use-case.js";
import { RegisterBuyerUseCase } from "./application/use-cases/register-buyer.use-case.js";
import { RegisterBuyerWithRateLimitUseCase } from "./application/use-cases/register-buyer-with-rate-limit.use-case.js";
import { BUYER_REGISTRATION_RATE_LIMITER } from "./domain/ports/buyer-registration-rate-limiter.port.js";
import { BuyerRegistrationRateLimiter } from "./domain/services/buyer-registration-rate-limiter.service.js";
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
import { WebAuthnRegisterOptionsUseCase } from "./application/use-cases/webauthn-register-options.use-case.js";
import { WebAuthnRegisterVerifyUseCase } from "./application/use-cases/webauthn-register-verify.use-case.js";
import { WebAuthnLoginOptionsUseCase } from "./application/use-cases/webauthn-login-options.use-case.js";
import { WebAuthnLoginVerifyUseCase } from "./application/use-cases/webauthn-login-verify.use-case.js";
import { BuyerJwtService } from "./domain/services/buyer-jwt.service.js";
import { M2mTokenService } from "./domain/services/m2m-token.service.js";
import { WebAuthnChallengeService } from "./domain/services/webauthn-challenge.service.js";
import { WebAuthnVerifierService } from "./domain/services/webauthn-verifier.service.js";
import { BuyerJwtAuthGuard } from "./presentation/http/buyer-jwt-auth.guard.js";
import { BuyerAccountController } from "./presentation/http/buyer-account.controller.js";
import { BuyerAgentController } from "./presentation/http/buyer-agent.controller.js";
import { BuyerHubController } from "./presentation/http/buyer-hub.controller.js";
import { BuyerWebAuthnController } from "./presentation/http/buyer-webauthn.controller.js";
import { ListBuyerConversationsUseCase } from "./application/use-cases/buyer-conversation.use-cases.js";
import { GetBuyerConversationUseCase } from "./application/use-cases/buyer-conversation.use-cases.js";
import { RateBuyerConversationMessageUseCase } from "./application/use-cases/buyer-conversation.use-cases.js";
import { DeleteBuyerAccountUseCase } from "./application/use-cases/delete-buyer-account.use-case.js";
import { ExportBuyerDataUseCase } from "./application/use-cases/export-buyer-data.use-case.js";
import { BuyerAccountRepositoryModule } from "./buyer-account-repository.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { OTP_STORE } from "./domain/ports/otp-store.port.js";
import { WEBAUTHN_CREDENTIAL_STORE } from "./domain/ports/webauthn-credential.port.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "./buyer-account.tokens.js";
import { PrismaOtpStore } from "./infrastructure/prisma-otp-store.js";
import { RedisOtpStore } from "./infrastructure/redis-otp-store.js";
import { PrismaWebAuthnCredentialRepository } from "./infrastructure/prisma-webauthn-credential.repository.js";

@Module({
  imports: [BuyerAccountRepositoryModule, BuyerPurchaseHistoryModule, forwardRef(() => CheckoutModule), IntegrationsModule],
  controllers: [BuyerAccountController, BuyerAgentController, BuyerHubController, BuyerWebAuthnController],
  providers: [
    RegisterBuyerUseCase,
    RegisterBuyerWithRateLimitUseCase,
    {
      provide: BUYER_REGISTRATION_RATE_LIMITER,
      useFactory: () => new BuyerRegistrationRateLimiter(),
    },
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
    ListBuyerConversationsUseCase,
    GetBuyerConversationUseCase,
    RateBuyerConversationMessageUseCase,
    DeleteBuyerAccountUseCase,
    ExportBuyerDataUseCase,
    SendBuyerPhoneCodeUseCase,
    VerifyBuyerPhoneCodeUseCase,
    SendBuyerEmailCodeUseCase,
    VerifyBuyerEmailCodeUseCase,
    // WhatsApp OTP delivery via BubbleWhats
    {
      provide: SMS_PROVIDER,
      useFactory: () => ({
        async send(phone: string, message: string) {
          const baseUrl = process.env.BUBBLEWHATS_API_URL;
          const token = process.env.BUBBLEWHATS_TOKEN;
          if (!baseUrl || !token) {
            const logger = new Logger("WhatsAppOTP");
            logger.warn(`[OTP] WhatsApp not configured; message for ${phone.slice(-4)}: ${message}`);
            return;
          }
          const cleanDigits = phone.replace(/\D/g, "");
          const number = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
          const jid = `${number}@s.whatsapp.net`;
          await fetch(`${baseUrl}/send-message`, {
            method: "POST",
            headers: { Authorization: token, "Content-Type": "application/json" },
            body: JSON.stringify({ jid, message }),
          });
        },
      }),
    },
    // WebAuthn dependencies
    WebAuthnChallengeService,
    {
      provide: WebAuthnVerifierService,
      useFactory: (config: { rpId: string; origin: string }) => new WebAuthnVerifierService(config),
      inject: ["WebAuthnVerifierConfig"],
    },
    WebAuthnRegisterOptionsUseCase,
    WebAuthnRegisterVerifyUseCase,
    WebAuthnLoginOptionsUseCase,
    WebAuthnLoginVerifyUseCase,
    BuyerJwtService,
    BuyerJwtAuthGuard,
    M2mTokenService,
    PasswordHasher,
    {
      provide: OTP_STORE,
      useFactory: (redis: Redis | null, prisma: PrismaClient) => {
        if (redis) {
          return new RedisOtpStore(redis);
        }
        // Fallback to Prisma if Redis is not available (tests / dev without Redis)
        const logger = new Logger("OtpStoreFactory");
        logger.warn("Redis not available for OTP store; falling back to Prisma");
        return new PrismaOtpStore(prisma);
      },
      inject: [REDIS_CLIENT_TOKEN, BUYER_ACCOUNT_PRISMA_CLIENT],
    },
    {
      provide: WEBAUTHN_CREDENTIAL_STORE,
      useFactory: (prisma: PrismaClient) => new PrismaWebAuthnCredentialRepository(prisma),
      inject: [BUYER_ACCOUNT_PRISMA_CLIENT],
    },
    {
      provide: "WebAuthnRpMetadata",
      useValue: {
        rpId: process.env.WEBAUTHN_RP_ID || "localhost",
        rpName: process.env.WEBAUTHN_RP_NAME || "Zyon",
      },
    },
    {
      provide: "WebAuthnVerifierConfig",
      useValue: {
        rpId: process.env.WEBAUTHN_RP_ID || "localhost",
        origin: process.env.WEBAUTHN_ORIGIN || "http://localhost:3000",
      },
    },
  ],
  exports: [BuyerJwtService, BuyerJwtAuthGuard, BuyerAccountRepositoryModule],
})
export class BuyerAccountModule {}
