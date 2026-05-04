# Checkout Module Closure Design

## Ownership Boundary

`checkout` owns facts about the buyer's checkout lifecycle:

- Session identity and lifecycle.
- Checkout event history.
- Abandonment state stored on the session.
- Accepted offer attachment to the session.
- Order completion facts.

It does not own:

- Merchant commercial or shipping policy.
- Offer authorization rules.
- Conversation generation.
- External discount or shipping application.
- Analytics projections.

## Target Layout

```text
apps/api/src/modules/checkout/
  domain/
    entities/
      checkout-session.entity.ts
      checkout-event.entity.ts
      accepted-offer.entity.ts
      completed-order.entity.ts
    value-objects/
      checkout-session-id.vo.ts
      checkout-event-name.vo.ts
      global-user-id.vo.ts
      merchant-id.vo.ts
    events/
      checkout-domain-event.ts
      checkout-session-started.event.ts
      checkout-event-tracked.event.ts
      checkout-abandonment-scored.event.ts
      checkout-abandoned.event.ts
      order-completed.event.ts
    services/
      checkout-abandonment.service.ts
      checkout-identity.service.ts
    ports/
      checkout-session.repository.port.ts
      checkout-event.repository.port.ts
      accepted-offer.repository.port.ts
      checkout-outbox.port.ts
  application/
    commands/
    queries/
    use-cases/
  infrastructure/
    repositories/
      in-memory-checkout.repository.ts
    prisma/
      prisma-checkout-session.repository.ts
      prisma-checkout-transaction.ts
    messaging/
      checkout-event-envelope.mapper.ts
  presentation/
    http/
      checkout.controller.ts
  checkout.module.ts
```

The current MVP may keep a consolidated repository temporarily. Closure tasks should split ports only when tests prove the behavior and compatibility remain stable.

## Domain Model

### CheckoutSession

State:

- `merchantId`
- `sessionId`
- `globalUserId`
- `conversationId`
- `cart`
- optional `customer`
- optional `shipping`
- `abandonmentScore`
- `triggerAgent`
- timestamps

Behavior:

- create new session.
- rehydrate existing session.
- apply tracked event score.
- mark abandoned.
- attach accepted offer reference.
- complete order idempotently.

### CheckoutEvent

Represents a lifecycle signal captured by the widget or commerce platform. It is scoped by `merchant_id` and `session_id` and is append-only.

### AcceptedOffer

Represents checkout acceptance of an offer already authorized by deterministic modules. It must keep authorization metadata for audit but cannot authorize the offer itself.

### CompletedOrder

Represents the fact that an external checkout produced an order. Checkout records the fact and emits `order.completed`.

## Application Use Cases

- `StartCheckoutUseCase`
- `TrackCheckoutEventUseCase`
- `GetCheckoutSessionUseCase`
- `MarkCheckoutAbandonedUseCase`
- `AcceptCheckoutOfferUseCase`
- `CompleteOrderUseCase`

Compatibility use cases that currently live in checkout but will later move or delegate:

- `GetDecisionUseCase`: delegates scoring/decision policy to decision module or pure package.
- `SendChatMessageUseCase`: delegates message generation to conversation and offer authorization to deterministic modules.
- `EvaluateShippingUseCase`: should move to shipping module after checkout closure.
- Dashboard rules/overview use cases: should move to merchant and analytics.
- `ApplyOfferUseCase`: should move commerce application to commerce while checkout records offer acceptance.

## Persistence Strategy

MVP persistence remains in-memory until the Prisma task group starts. The target Prisma adapter must support:

- `CheckoutSession` by `(merchant_id, session_id)`.
- `CheckoutEvent` append-only by `(merchant_id, session_id, occurred_at)`.
- `AcceptedOffer` by `(merchant_id, session_id, offer_id)`.
- `CompletedOrder` by `(merchant_id, session_id, external_order_id)`.
- `OutboxMessage` append in the same transaction as state changes.

Every repository method must take `merchant_id` as the first scope parameter unless saving a tenant-scoped aggregate that already contains it.

## Event Contracts

Checkout emits these facts:

- `checkout.session.started`
- `checkout.event.tracked`
- `checkout.abandonment.scored`
- `checkout.abandoned`
- `order.completed`

Payloads are owned by checkout and must not leak ORM models.

### `checkout.session.started`

Payload:

- `session_id`
- `conversation_id`
- `global_user_id`
- `cart_total`
- `currency`
- `has_customer_hint`
- `has_shipping_quote`

### `checkout.event.tracked`

Payload:

- `session_id`
- `event_name`
- `metadata`
- `previous_abandonment_score`
- `next_abandonment_score`
- `trigger_agent`

### `checkout.abandonment.scored`

Payload:

- `session_id`
- `previous_score`
- `next_score`
- `trigger_agent`
- `reason`

### `checkout.abandoned`

Payload:

- `session_id`
- `abandonment_score`
- `last_event_name`

### `order.completed`

Payload:

- `session_id`
- `external_order_id`
- `order_total`
- `currency`
- `accepted_offer_id`

## Compatibility Path

1. Add tests around existing behavior before changing runtime code.
2. Extract domain value objects/entities behind existing DTOs.
3. Split application ports while keeping the current controller routes.
4. Add event envelope fixtures and outbox ports.
5. Add Prisma repositories after the in-memory behavior is fully covered.
6. Move non-checkout responsibilities into later module tasks only after checkout behavior is closed.
