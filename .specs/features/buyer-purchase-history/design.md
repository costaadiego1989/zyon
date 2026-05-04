# Buyer Purchase History Design

## Module Boundary

```text
apps/api/src/modules/buyer-purchase-history/
  domain/
    entities/
      buyer-purchase-history.entity.ts
    ports/
      buyer-purchase-history-repository.port.ts
  application/
    record-completed-purchase.use-case.ts
    get-buyer-purchase-context.use-case.ts
  infrastructure/
    in-memory-buyer-purchase-history.repository.ts
    prisma-buyer-purchase-history.repository.ts
  presentation/
    http/
      buyer-purchase-history.controller.ts
```

## Domain Model

`PurchaseRecord`

- `merchantId`
- `orderId`
- `globalUserId?`
- `merchantCustomerId?`
- `currency`
- `totalAmount`
- `discountAmount`
- `completedAt`
- `items`

`PurchaseItem`

- `sku`
- `title`
- `categoryId?`
- `quantity`
- `unitPrice`
- `discountAmount`

`BuyerMerchantStats`

- `merchantId`
- `globalUserId?`
- `merchantCustomerId?`
- `ordersCount`
- `lifetimeValue`
- `averageOrderValue`
- `lastOrderAt`
- `topCategories`
- `topSkus`
- `discountSensitivity`

## Data Flow

1. Checkout completes an order.
2. Checkout emits or calls a purchase-history application port with the completed order fact.
3. Purchase history upserts the order by `merchant_id + order_id`.
4. Purchase history recomputes or incrementally updates buyer-merchant stats.
5. Agent Rules/Checkout asks for safe context by `merchant_id + global_user_id`.
6. Conversation receives only compact context.

## Tenant Safety

Every read and write is scoped by `merchant_id`.

`global_user_id` is an identity key, not permission to query all merchants. Merchant-facing APIs must never return another merchant's buyer facts.

## Context Compression

The module should not pass full history to the LLM by default. It exposes:

- Returning customer boolean.
- Counts and value totals.
- Recency.
- Top category/SKU hints.
- Discount sensitivity bucket: `unknown | low | medium | high`.
- Safe copy hints.

## Discount Sensitivity

Initial deterministic rule:

- `unknown`: fewer than 2 completed orders.
- `low`: discount used in less than 25% of orders.
- `medium`: discount used in 25% to 60% of orders.
- `high`: discount used in more than 60% of orders.

This informs negotiation strategy, but never authorizes discounts.

## Billing Hook

The use case should emit metering facts later:

- Context generated.
- History-enriched negotiation evaluated.
- Imported order count.

Metering belongs to a billing module later; this module only exposes clear event points.
