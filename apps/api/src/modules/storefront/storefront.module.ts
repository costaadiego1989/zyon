/**
 * Storefront module — wires all components.
 *
 * Imports:
 *   - CatalogModule (product + stock repos)
 *   - CheckoutModule (for cart/checkout integration)
 *   - ShippingModule (for shipping quotes)
 *   - CouponsModule (for coupon validation)
 *   - MerchantModule (for merchant data)
 *
 * Exports:
 *   - All use-cases
 *   - StorefrontConversationPort
 */

import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { ShippingModule } from "../shipping/shipping.module.js";
import { CouponsModule } from "../coupons/coupons.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { StartStoreConversationUseCase } from "./application/use-cases/start-store-conversation.use-case.js";
import { SendStoreMessageUseCase } from "./application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "./application/use-cases/get-conversation-history.use-case.js";
import { StorefrontConversationAdapter, STOREFRONT_CONVERSATION_ADAPTER } from "./infrastructure/adapters/storefront-conversation.adapter.js";
import { STOREFRONT_CONVERSATION_PORT } from "./domain/ports/conversation.port.js";
import { StorefrontController } from "./presentation/http/storefront.controller.js";

@Module({
  imports: [
    CatalogModule,
    CheckoutModule,
    ShippingModule,
    CouponsModule,
    MerchantModule
  ],
  controllers: [StorefrontController],
  providers: [
    StorefrontConversationAdapter,
    {
      provide: STOREFRONT_CONVERSATION_PORT,
      useExisting: StorefrontConversationAdapter
    },
    StartStoreConversationUseCase,
    SendStoreMessageUseCase,
    GetConversationHistoryUseCase
  ],
  exports: [
    StartStoreConversationUseCase,
    SendStoreMessageUseCase,
    GetConversationHistoryUseCase,
    STOREFRONT_CONVERSATION_PORT
  ]
})
export class StorefrontModule {}
