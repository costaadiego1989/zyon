# Modular DDD Foundation Design

## Architecture Direction

The system remains a NestJS modular monolith with Clean Architecture and tactical DDD:

```text
presentation -> application -> domain <- infrastructure
```

Each module follows:

```text
apps/api/src/modules/[context]/
  domain/
    entities/
    value-objects/
    events/
    ports/
    services/
  application/
    commands/
    queries/
    handlers/
    use-cases/
  infrastructure/
    prisma/
    messaging/
    adapters/
  presentation/
    http/
  [context].module.ts
```

Packages under `packages/*` stay framework-free. They may hold pure engines and shared contracts, but not NestJS, Prisma clients, RabbitMQ clients, HTTP controllers, or environment access.

## Bounded Contexts and Ownership

| Module | Owns | Does not own |
| --- | --- | --- |
| `checkout` | Session lifecycle, checkout events, session state, order completion fact | Merchant rules, LLM copy, external discount creation |
| `merchant` | Rules, brand voice, integration metadata, feature flags | Runtime checkout session state |
| `decision` | Intervention policy, scoring policy, offer authorization orchestration | External offer application, buyer-facing copy |
| `shipping` | Shipping subsidy decisions, freight margin checks, blocked regions | Carrier quoting in MVP, logistics routing |
| `conversation` | Objection classification, safe phrasing, LLM fallback | Offer authorization, margin, stock, delivery promises |
| `commerce` | Shopify/WooCommerce/custom adapters, discount code application | Business authorization of offers |
| `payment` | Payment events and failure rescue facts | Payment processing or gateway ownership |
| `analytics` | Dashboard/read models, attribution, conversion and margin metrics | Source-of-truth checkout state |
| `recovery` | Abandonment recovery workflow and channel delivery | Checkout scoring policy, offer authorization |

Ownership rule: a module emits events only for facts it owns. Other modules consume those events to update their own state or projections.

## CQRS Rules

- Commands mutate source-of-truth state and may create outbox messages in the same Prisma transaction.
- Queries do not mutate state and must read by `merchant_id` first.
- Application use cases remain the synchronous boundary inside the monolith.
- Read models are owned by `analytics` unless they are local module lookups needed by command validation.
- Synchronous command flow may call ports in the same process when immediate consistency is required, for example checkout requesting merchant rules before authorizing an offer.
- Asynchronous side effects use outbox events, not direct imports between infrastructure adapters.

Command naming examples:

- `StartCheckoutCommand`
- `TrackCheckoutEventCommand`
- `AuthorizeOfferCommand`
- `EvaluateShippingCommand`
- `ApplyOfferCommand`
- `RecordPaymentFailureCommand`
- `RequestRecoveryCommand`

Query naming examples:

- `GetCheckoutSessionQuery`
- `GetMerchantRulesQuery`
- `GetDashboardOverviewQuery`
- `ListRecentConversationsQuery`
- `GetOfferAttributionQuery`

## Prisma Persistence Target

Prisma is the persistence adapter, not a domain model. Domain/application layers depend on repository ports, never Prisma types.

Initial model groups:

- Tenant and merchant config: `Merchant`, `MerchantRules`, `MerchantIntegration`.
- Checkout source of truth: `CheckoutSession`, `CheckoutEvent`, `Conversation`, `ConversationMessage`.
- Offers and commerce: `AuthorizedOffer`, `AppliedOffer`, `CommerceApplicationAttempt`.
- Payment facts: `PaymentEvent`.
- Recovery facts: `RecoveryAttempt`.
- Analytics projections: `MerchantDashboardDaily`, `MerchantDashboardOverview`, `OfferAttribution`.
- Messaging reliability: `OutboxMessage`, `InboxMessage`.

Required persistence invariants:

- Every tenant-owned table includes `merchant_id`.
- Indexes start with `merchant_id` for tenant-scoped access.
- Public identifiers remain stable strings (`session_id`, `conversation_id`, `offer_id`, `global_user_id`).
- `OutboxMessage` is written in the same transaction as the state change that produced the event.
- Consumers write `InboxMessage` or equivalent idempotency records before applying side effects.

## RabbitMQ Topology

RabbitMQ is used for asynchronous facts and reusable infrastructure, not synchronous request/response between modules.

Exchanges:

- `aacp.events`: topic, durable, main domain event exchange.
- `aacp.retry`: topic or direct, durable, delayed retry path.
- `aacp.dlx`: topic, durable, dead-letter exchange.

Queues:

- `analytics.events.q`: binds `checkout.*`, `offer.*`, `order.*`, `payment.*`, `recovery.*`.
- `conversation.events.q`: binds `checkout.abandonment.scored`, `payment.failed`, `recovery.requested`.
- `commerce.events.q`: binds `offer.authorized`, `offer.apply_requested`, `offer.expired`.
- `recovery.events.q`: binds `checkout.abandoned`, `recovery.requested`.

Routing principles:

- Routes are facts in past tense or state-change names, never imperative RPC names.
- Consumers must be idempotent by `event_id`.
- Retry keeps the original `event_id`, increments attempt metadata, and preserves correlation.
- DLQ messages must include failure reason, consumer name, original route, and payload reference.

## Event Envelope

All published messages use one envelope:

```json
{
  "event_id": "evt_...",
  "event_type": "checkout.session.started",
  "schema_version": 1,
  "merchant_id": "mrc_...",
  "occurred_at": "2026-05-01T12:00:00.000Z",
  "correlation_id": "corr_...",
  "causation_id": "cmd_or_evt_...",
  "producer": "checkout",
  "payload": {}
}
```

Initial event types:

- `checkout.session.started`
- `checkout.event.tracked`
- `checkout.abandonment.scored`
- `checkout.abandoned`
- `offer.authorized`
- `offer.apply_requested`
- `offer.applied`
- `offer.expired`
- `order.completed`
- `payment.failed`
- `recovery.requested`
- `analytics.metric.updated`

Compatibility rule: adding optional payload fields is allowed within a schema version. Removing or changing meaning requires a new `schema_version`.

## Outbox Flow

1. A command handler validates input and loads state through repository ports.
2. Domain/application logic mutates state and creates domain events.
3. Prisma transaction persists state plus `OutboxMessage` rows.
4. Outbox publisher worker claims pending rows with locking, publishes to `aacp.events`, then marks them published.
5. RabbitMQ consumers apply projections or integration side effects idempotently.
6. Failed consumers retry through `aacp.retry`; exhausted messages go to `aacp.dlx`.

Outbox status values:

- `pending`
- `publishing`
- `published`
- `failed`
- `dead_lettered`

## Module Documentation Details

### Checkout

Commands:

- `StartCheckoutCommand`
- `TrackCheckoutEventCommand`
- `CompleteOrderCommand`
- `MarkCheckoutAbandonedCommand`

Queries:

- `GetCheckoutSessionQuery`
- `ListCheckoutEventsQuery`

Emits:

- `checkout.session.started`
- `checkout.event.tracked`
- `checkout.abandonment.scored`
- `checkout.abandoned`
- `order.completed`

Tests:

- Starts session with stable `session_id`, `conversation_id`, and `global_user_id`.
- Reuses `global_user_id` only within tenant-safe identity resolution.
- Records events and updates score without crossing `merchant_id`.

### Merchant

Commands:

- `UpdateMerchantRulesCommand`
- `ConfigureMerchantIntegrationCommand`
- `UpdateBrandVoiceCommand`

Queries:

- `GetMerchantRulesQuery`
- `GetMerchantIntegrationQuery`

Emits:

- `merchant.rules.updated`
- `merchant.integration.configured`

Tests:

- Rules update is partial and tenant-scoped.
- Invalid policy limits are rejected before persistence.
- Brand voice changes are visible to conversation only through application ports/events.

### Decision

Commands:

- `EvaluateDecisionCommand`
- `AuthorizeOfferCommand`

Queries:

- `GetDecisionAuditQuery`

Emits:

- `offer.authorized`
- `decision.evaluated`

Tests:

- LLM output never authorizes an offer.
- Margin violations block offers.
- Score thresholds trigger only intended interventions.

### Shipping

Commands:

- `EvaluateShippingCommand`

Queries:

- `GetShippingDecisionAuditQuery`

Emits:

- `shipping.evaluated`
- `offer.authorized` when a shipping offer is approved by policy.

Tests:

- Missing shipping quote blocks shipping offer.
- Blocked regions block subsidy.
- Free shipping and partial shipping respect minimum margin and subsidy limits.

### Conversation

Commands:

- `SendChatMessageCommand`
- `GenerateRecoveryMessageCommand`

Queries:

- `GetConversationQuery`
- `ListConversationMessagesQuery`

Emits:

- `conversation.message.received`
- `conversation.message.generated`

Tests:

- Fallback message is safe without OpenAI credentials.
- Authorized offer is mentioned only when present and approved.
- Trust/payment/shipping objections are classified deterministically when possible.

### Commerce

Commands:

- `ApplyOfferCommand`
- `ExpireOfferCommand`

Queries:

- `GetCommerceApplicationAttemptQuery`

Emits:

- `offer.apply_requested`
- `offer.applied`
- `offer.application_failed`

Tests:

- Shopify credential-less fallback is deterministic.
- Shopify errors are captured without losing offer audit.
- Application cannot proceed for unapproved or expired offers.

### Payment

Commands:

- `RecordPaymentFailureCommand`
- `RecordPaymentMethodSelectedCommand`

Queries:

- `GetPaymentEventsQuery`

Emits:

- `payment.failed`
- `payment.method_selected`

Tests:

- Payment failures are tenant-scoped and tied to a checkout session.
- Payment module records facts but does not process payment.
- Payment failure can trigger conversation/recovery consumers.

### Analytics

Commands:

- `ProjectCheckoutEventCommand`
- `ProjectOfferEventCommand`
- `RecalculateMerchantOverviewCommand`

Queries:

- `GetDashboardOverviewQuery`
- `ListRecentOffersQuery`
- `ListRecentSessionsQuery`

Emits:

- `analytics.metric.updated`

Tests:

- Dashboard projections are scoped by `merchant_id`.
- Offer acceptance, order completion, and revenue metrics update from events.
- Replaying the same event is idempotent.

### Recovery

Commands:

- `RequestRecoveryCommand`
- `SendRecoveryMessageCommand`
- `ExpireRecoveryOfferCommand`

Queries:

- `GetRecoveryAttemptQuery`

Emits:

- `recovery.requested`
- `recovery.message_sent`
- `recovery.failed`

Tests:

- Recovery requires consent and eligible channel.
- Recovery respects offer expiration and anti-spam cooldown.
- Recovery attribution links back to checkout/session/offer.
