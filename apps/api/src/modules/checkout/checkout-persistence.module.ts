import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CHECKOUT_REPOSITORY } from "./domain/ports/checkout-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY } from "./domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY } from "./domain/ports/offer.repository.port.js";
import { ORDER_REPOSITORY } from "./domain/ports/order.repository.port.js";
import { DASHBOARD_READ_MODEL } from "./domain/ports/dashboard-read-model.port.js";
import { PrismaCheckoutRepository } from "./infrastructure/prisma/prisma-checkout.repository.js";

@Module({
  providers: [
    {
      provide: CHECKOUT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCheckoutRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    { provide: CHECKOUT_SESSION_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: OFFER_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: ORDER_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: DASHBOARD_READ_MODEL, useExisting: CHECKOUT_REPOSITORY }
  ],
  exports: [
    CHECKOUT_REPOSITORY,
    CHECKOUT_SESSION_REPOSITORY,
    OFFER_REPOSITORY,
    ORDER_REPOSITORY,
    DASHBOARD_READ_MODEL
  ]
})
export class CheckoutPersistenceModule {}
