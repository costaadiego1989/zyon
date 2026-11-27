import type { PrismaClient } from "@prisma/client";
import type { CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import type { OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import type { ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";

/** Internal persistence context. No request/provider may supply its members.
 * The Prisma client is a transaction-bound reader; callback code never opens
 * another transaction. Checkout remains the sole owner of its versioned write. */
export interface ShippingCheckoutTransaction {
  prisma: PrismaClient;
  sessions: CheckoutSessionRepository;
  quotes: ShippingQuoteRepository;
  merchantRules: MerchantRulesRepository;
  ownDeliveryConfig: OwnDeliveryConfigRepository;
}

export interface ShippingCheckoutQuoteRepository extends ShippingQuoteRepository {
  withCheckoutTransaction?<T>(scope: { merchantId: string; sessionId: string },
    work: (context: ShippingCheckoutTransaction) => Promise<T>): Promise<T>;
}
