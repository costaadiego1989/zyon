import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BUYER_USER_REPOSITORY } from "./domain/ports/buyer-user-repository.port.js";
import { BUYER_WALLET_REPOSITORY } from "./domain/ports/buyer-wallet-repository.port.js";
import { BUYER_TEMPLATE_REPOSITORY } from "./domain/ports/buyer-template-repository.port.js";
import { PAYMENT_TOKENIZER } from "./domain/ports/payment-tokenizer.port.js";
import { PrismaBuyerUserRepository } from "./infrastructure/repositories/prisma-buyer-user.repository.js";
import { PrismaBuyerWalletRepository } from "./infrastructure/repositories/prisma-buyer-wallet.repository.js";
import { PrismaBuyerTemplateRepository } from "./infrastructure/repositories/prisma-buyer-template.repository.js";
import { StubPaymentTokenizerAdapter } from "./infrastructure/adapters/stub-payment-tokenizer.adapter.js";
import { RegisterBuyerUserUseCase } from "./application/use-cases/register-buyer-user.use-case.js";
import { AddSavedAddressUseCase } from "./application/use-cases/add-saved-address.use-case.js";
import { RemoveSavedAddressUseCase } from "./application/use-cases/remove-saved-address.use-case.js";
import { AddSavedPaymentMethodUseCase } from "./application/use-cases/add-saved-payment-method.use-case.js";
import { DeleteSavedPaymentMethodUseCase } from "./application/use-cases/delete-saved-payment-method.use-case.js";
import { CreateCheckoutTemplateUseCase } from "./application/use-cases/create-checkout-template.use-case.js";
import { ExecuteCheckoutTemplateUseCase } from "./application/use-cases/execute-checkout-template.use-case.js";
import { ListTemplatesForBuyerUseCase } from "./application/use-cases/list-templates-for-buyer.use-case.js";
import { UpdateConsentUseCase } from "./application/use-cases/update-consent.use-case.js";
import { BuyerMeController } from "./presentation/http/buyer-me.controller.js";

@Module({
  controllers: [BuyerMeController],
  providers: [
    {
      provide: BUYER_USER_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerUserRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: BUYER_WALLET_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerWalletRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: BUYER_TEMPLATE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerTemplateRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    StubPaymentTokenizerAdapter,
    { provide: PAYMENT_TOKENIZER, useExisting: StubPaymentTokenizerAdapter },
    RegisterBuyerUserUseCase,
    AddSavedAddressUseCase,
    RemoveSavedAddressUseCase,
    AddSavedPaymentMethodUseCase,
    DeleteSavedPaymentMethodUseCase,
    CreateCheckoutTemplateUseCase,
    ExecuteCheckoutTemplateUseCase,
    ListTemplatesForBuyerUseCase,
    UpdateConsentUseCase,
  ],
})
export class SelfCheckoutModule {}
