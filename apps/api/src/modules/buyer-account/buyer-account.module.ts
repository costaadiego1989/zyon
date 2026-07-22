import { Module } from "@nestjs/common";
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
import { ListBuyerAddressesUseCase, AddBuyerAddressUseCase, UpdateBuyerAddressUseCase, DeleteBuyerAddressUseCase } from "./application/use-cases/list-buyer-addresses.use-case.js";
import { ListBuyerConversationsUseCase, GetBuyerConversationUseCase, RateBuyerConversationMessageUseCase } from "./application/use-cases/buyer-conversation.use-cases.js";
import { DeleteBuyerAccountUseCase } from "./application/use-cases/delete-buyer-account.use-case.js";
import { ExportBuyerDataUseCase } from "./application/use-cases/export-buyer-data.use-case.js";
import { WebAuthnRegisterOptionsUseCase } from "./application/use-cases/webauthn-register-options.use-case.js";
import { WebAuthnRegisterVerifyUseCase } from "./application/use-cases/webauthn-register-verify.use-case.js";
import { WebAuthnLoginOptionsUseCase } from "./application/use-cases/webauthn-login-options.use-case.js";
import { WebAuthnLoginVerifyUseCase } from "./application/use-cases/webauthn-login-verify.use-case.js";
import { WebAuthnChallengeService } from "./domain/services/webauthn-challenge.service.js";
import { WebAuthnVerifierService } from "./domain/services/webauthn-verifier.service.js";
import { WEBAUTHN_CREDENTIAL_STORE } from "./domain/ports/webauthn-credential.port.js";
import { BUYER_ACCOUNT_REPOSITORY } from "./domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "./buyer-account.tokens.js";
import { PrismaWebAuthnCredentialRepository } from "./infrastructure/prisma-webauthn-credential.repository.js";
import type { PrismaClient } from "@prisma/client";
import { BuyerJwtService } from "./domain/services/buyer-jwt.service.js";
import { M2mTokenService } from "./domain/services/m2m-token.service.js";
import { BuyerJwtAuthGuard } from "./presentation/http/buyer-jwt-auth.guard.js";
import { BuyerAccountController } from "./presentation/http/buyer-account.controller.js";
import { BuyerAgentController } from "./presentation/http/buyer-agent.controller.js";
import { BuyerAddressesController } from "./presentation/http/buyer-addresses.controller.js";
import { BuyerHubController } from "./presentation/http/buyer-hub.controller.js";
import { BuyerWebAuthnController } from "./presentation/http/buyer-webauthn.controller.js";
import { BuyerAccountRepositoryModule } from "./buyer-account-repository.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { OTP_STORE } from "./domain/ports/otp-store.port.js";
import { InMemoryOtpStore } from "./infrastructure/in-memory-otp-store.js";

@Module({
  imports: [BuyerAccountRepositoryModule, BuyerPurchaseHistoryModule, CheckoutModule, IntegrationsModule],
  controllers: [BuyerAccountController, BuyerAgentController, BuyerAddressesController, BuyerHubController, BuyerWebAuthnController],
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
    ListBuyerAddressesUseCase,
    AddBuyerAddressUseCase,
    UpdateBuyerAddressUseCase,
    DeleteBuyerAddressUseCase,
    ListBuyerConversationsUseCase,
    GetBuyerConversationUseCase,
    RateBuyerConversationMessageUseCase,
    DeleteBuyerAccountUseCase,
    ExportBuyerDataUseCase,
    // --- WebAuthn biometric login ---
    WebAuthnChallengeService,
    {
      provide: WebAuthnVerifierService,
      useFactory: () => new WebAuthnVerifierService({
        rpId: process.env.WEBAUTHN_RP_ID ?? "localhost",
        origin: process.env.WEBAUTHN_ORIGIN ?? "https://localhost",
      }),
    },
    {
      provide: WEBAUTHN_CREDENTIAL_STORE,
      useFactory: (prisma: PrismaClient) => new PrismaWebAuthnCredentialRepository(prisma),
      inject: [BUYER_ACCOUNT_PRISMA_CLIENT],
    },
    {
      provide: WebAuthnRegisterOptionsUseCase,
      useFactory: (challenges: WebAuthnChallengeService, buyerRepo: any) =>
        new WebAuthnRegisterOptionsUseCase(
          challenges,
          { rpId: process.env.WEBAUTHN_RP_ID ?? "localhost", rpName: process.env.WEBAUTHN_RP_NAME ?? "Zyon" },
          buyerRepo,
        ),
      inject: [WebAuthnChallengeService, BUYER_ACCOUNT_REPOSITORY],
    },
    {
      provide: WebAuthnRegisterVerifyUseCase,
      useFactory: (verifier: WebAuthnVerifierService, challenges: WebAuthnChallengeService, credStore: any, buyerRepo: any) =>
        new WebAuthnRegisterVerifyUseCase({ verifier, challengeService: challenges, credentialStore: credStore, buyerRepo }),
      inject: [WebAuthnVerifierService, WebAuthnChallengeService, WEBAUTHN_CREDENTIAL_STORE, BUYER_ACCOUNT_REPOSITORY],
    },
    {
      provide: WebAuthnLoginOptionsUseCase,
      useFactory: (challenges: WebAuthnChallengeService, credStore: any, buyerRepo: any) =>
        new WebAuthnLoginOptionsUseCase({
          challengeService: challenges,
          credentialStore: credStore,
          rpId: process.env.WEBAUTHN_RP_ID ?? "localhost",
          buyerRepo,
        }),
      inject: [WebAuthnChallengeService, WEBAUTHN_CREDENTIAL_STORE, BUYER_ACCOUNT_REPOSITORY],
    },
    {
      provide: WebAuthnLoginVerifyUseCase,
      useFactory: (verifier: WebAuthnVerifierService, challenges: WebAuthnChallengeService, credStore: any, buyerRepo: any, jwt: any) =>
        new WebAuthnLoginVerifyUseCase({ verifier, challengeService: challenges, credentialStore: credStore, buyerRepo, jwt }),
      inject: [WebAuthnVerifierService, WebAuthnChallengeService, WEBAUTHN_CREDENTIAL_STORE, BUYER_ACCOUNT_REPOSITORY, BuyerJwtService],
    },
    // --- end WebAuthn ---
    BuyerJwtService,
    BuyerJwtAuthGuard,
    M2mTokenService,
    PasswordHasher,
    // B3 (P1): OTP store bound to the port token.
    // TODO: swap for PrismaOtpStore (backed by buyer_phone_otps table) in
    // the Prisma repository module once a Prisma client is available here.
    { provide: OTP_STORE, useClass: InMemoryOtpStore },
  ],
  exports: [BuyerJwtService, BuyerJwtAuthGuard, BuyerAccountRepositoryModule],
})
export class BuyerAccountModule {}
