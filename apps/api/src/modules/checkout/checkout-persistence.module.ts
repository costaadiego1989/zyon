import { Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT, PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { PrismaCheckoutRepository } from "./infrastructure/prisma/prisma-checkout.repository.js";
import { CHECKOUT_REPOSITORY } from "./domain/ports/checkout-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY } from "./domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY } from "./domain/ports/offer.repository.port.js";
import { ORDER_REPOSITORY } from "./domain/ports/order.repository.port.js";
import { CHECKOUT_EXPERIENCE_CONFIG } from "./domain/checkout-experience.config.js";
import { createCheckoutExperienceConfig } from "./infrastructure/checkout-experience.config.factory.js";

/**
 * Thin persistence module exposing the checkout repository (and its aliases)
 * with only a PrismaClient dependency. It exists to break the catalog↔checkout
 * module cycle: modules that need to READ checkout sessions (e.g. Catalog's
 * AddStorefrontItemUseCase) import THIS neutral module instead of the full
 * CheckoutModule, so no import edge points back from a low-level reader into
 * the checkout application layer. No forwardRef required.
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    {
      provide: CHECKOUT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCheckoutRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    { provide: CHECKOUT_SESSION_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: OFFER_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: ORDER_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: CHECKOUT_EXPERIENCE_CONFIG, useFactory: createCheckoutExperienceConfig },
  ],
  exports: [
    CHECKOUT_REPOSITORY,
    CHECKOUT_SESSION_REPOSITORY,
    OFFER_REPOSITORY,
    ORDER_REPOSITORY,
    CHECKOUT_EXPERIENCE_CONFIG,
  ],
})
export class CheckoutPersistenceModule {}
