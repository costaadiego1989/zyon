import { Module } from "@nestjs/common";
import { ShopifyCommerceAdapter } from "@aacp/commerce-adapters";
import { HttpClientService } from "../../shared/http/http-client.service.js";
import { ValidateCartForPaymentUseCase } from "./application/validate-cart-for-payment.use-case.js";
import { SyncPendingOrderUseCase } from "./application/sync-pending-order.use-case.js";
import { MarkCommerceOrderPaidUseCase } from "./application/mark-commerce-order-paid.use-case.js";
import { COMMERCE_CART_PORT } from "./domain/ports/commerce-cart.port.js";
import { COMMERCE_ORDER_PORT } from "./domain/ports/commerce-order.port.js";
import { COMMERCE_PAID_WEBHOOK_DEDUP } from "./domain/ports/commerce-paid-webhook-dedup.port.js";
import { COMMERCE_PENDING_ORDER_INDEX } from "./domain/ports/pending-commerce-order-index.port.js";
import { DisabledCommerceAdapter } from "./infrastructure/disabled-commerce.adapter.js";
import { InMemoryCommercePaidWebhookDedup } from "./infrastructure/in-memory-commerce-paid-webhook-dedup.js";
import { InMemoryPendingCommerceOrderIndex } from "./infrastructure/in-memory-pending-commerce-order-index.js";

function hasShopifyConfig(): boolean {
  return Boolean(process.env.SHOPIFY_SHOP_DOMAIN?.trim() && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim());
}

@Module({
  providers: [
    DisabledCommerceAdapter,
    InMemoryCommercePaidWebhookDedup,
    InMemoryPendingCommerceOrderIndex,
    {
      provide: COMMERCE_PENDING_ORDER_INDEX,
      useExisting: InMemoryPendingCommerceOrderIndex
    },
    {
      provide: COMMERCE_PAID_WEBHOOK_DEDUP,
      useExisting: InMemoryCommercePaidWebhookDedup
    },
    {
      provide: COMMERCE_CART_PORT,
      useFactory: (disabled: DisabledCommerceAdapter, http: HttpClientService) => {
        if (!hasShopifyConfig()) return disabled;
        return new ShopifyCommerceAdapter(
          {
            shopDomain: process.env.SHOPIFY_SHOP_DOMAIN!,
            adminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
            apiVersion: process.env.SHOPIFY_API_VERSION
          },
          http.toFetch()
        );
      },
      inject: [DisabledCommerceAdapter, HttpClientService]
    },
    {
      provide: COMMERCE_ORDER_PORT,
      useExisting: COMMERCE_CART_PORT
    },
    ValidateCartForPaymentUseCase,
    SyncPendingOrderUseCase,
    MarkCommerceOrderPaidUseCase
  ],
  exports: [
    ValidateCartForPaymentUseCase,
    SyncPendingOrderUseCase,
    MarkCommerceOrderPaidUseCase,
    COMMERCE_PENDING_ORDER_INDEX,
    COMMERCE_PAID_WEBHOOK_DEDUP
  ]
})
export class CommerceModule {}
