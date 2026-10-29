import { Module } from "@nestjs/common";
import { BuyerAccountModule } from "../buyer-account/buyer-account.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { ShippingModule } from "../shipping/shipping.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { StorefrontModule } from "../storefront/storefront.module.js";
import { NegotiationModule } from "../negotiation/negotiation.module.js";
import { EmbedModule } from "../embed/embed.module.js";
import { MessagingChannelsModule } from "../notifications/messaging-channels.module.js";
import { WhatsAppTemplatesModule } from "../whatsapp-templates/whatsapp-templates.module.js";
import { BillingPlanMeteringService } from "../payment/domain/billing-plan-guard.js";
import { CartPromoResolutionService } from "../checkout/application/services/cart-promo-resolution.service.js";
import { SHOPPING_REPOSITORY } from "./domain/shopping-agent.js";
import { SHOPPING_COMMERCE, ShoppingCommerceService } from "./application/shopping-commerce.service.js";
import { ShoppingAgentService } from "./application/shopping-agent.service.js";
import { ShoppingAgentWorker } from "./application/shopping-agent.worker.js";
import { PrismaShoppingRepository } from "./infrastructure/prisma-shopping.repository.js";
import { SHOPPING_NOTIFIER, ShoppingNotifierService } from "./infrastructure/shopping-notifier.service.js";
import { ShoppingAgentController } from "./presentation/shopping-agent.controller.js";

@Module({
  imports: [BuyerAccountModule, CatalogModule, ShippingModule, MerchantModule, CheckoutModule, StorefrontModule, NegotiationModule, EmbedModule, MessagingChannelsModule, WhatsAppTemplatesModule],
  controllers: [ShoppingAgentController],
  providers: [BillingPlanMeteringService, CartPromoResolutionService, ShoppingAgentService, ShoppingAgentWorker,
    { provide: SHOPPING_REPOSITORY, useClass: PrismaShoppingRepository },
    { provide: SHOPPING_COMMERCE, useClass: ShoppingCommerceService },
    { provide: SHOPPING_NOTIFIER, useClass: ShoppingNotifierService }],
})
export class BuyerShoppingAgentModule {}
