# Agent Context Bootstrap

Use this file whenever an agent loses conversation context or starts a new session for this project.

## First Read Order

Read these files before planning or implementing significant work:

1. `.cursor/skills/tlc-spec-driven/SKILL.md`
2. `.specs/project/PROJECT.md`
3. `.specs/project/ROADMAP.md`
4. `.specs/project/STATE.md`
5. `.specs/codebase/ARCHITECTURE.md`
6. `.specs/codebase/CONVENTIONS.md`
7. `.specs/codebase/STRUCTURE.md`
8. `.specs/codebase/TESTING.md`
9. `.specs/features/modular-ddd-foundation/spec.md`
10. `.specs/features/modular-ddd-foundation/design.md`
11. `.specs/features/modular-ddd-foundation/tasks.md`
12. `docs/architecture-clean-ddd.md`
13. `docs/ai-checkout-sales-agent-doc.md`

Load only the extra feature docs needed for the current task after this base context.

## Project Identity

The project is AI Checkout Sales Agent: an embeddable conversational checkout closer for ecommerce. It negotiates price, shipping, and payment friction while protecting merchant margin.

The current implementation is a TypeScript monorepo with:

- NestJS API.
- React/Vite widget.
- React/Vite dashboard.
- Pure packages for shared types, decision, rules, shipping, conversation, and commerce adapters.

The architecture target is a Clean Architecture modular monolith with tactical DDD.

## Non-Negotiable Architecture Rules

- Business policy points inward: `presentation -> application -> domain <- infrastructure`.
- `domain` cannot import NestJS, Prisma, HTTP, OpenAI, RabbitMQ, environment variables, or framework types.
- `application` owns use cases, command/query orchestration, transaction boundaries, and ports.
- `infrastructure` implements ports for Prisma, RabbitMQ, commerce platform APIs (WooCommerce, Magento, VTEX), OpenAI, Redis, PostgreSQL, and other vendors.
- `presentation` owns HTTP controllers, request/response transport, and framework validation.
- Packages under `packages/*` must remain framework-free.
- Repositories expose intention-revealing methods, not generic ORM leakage.
- Use cases are named with verbs, for example `StartCheckoutUseCase`, `TrackCheckoutEventUseCase`, `ApplyOfferUseCase`.

## Tenant and Identity Rules

- `merchant_id` is the tenant boundary for all commands, queries, events, projections, and integrations.
- `global_user_id` is a stable platform buyer identity, but buyer history is always filtered by `merchant_id`.
- No query may use `global_user_id` to mix data across merchants.
- Every persistent tenant-owned table must include and index by `merchant_id`.

## AI and Decision Rules

- LLM conversa, regra decide.
- The LLM can classify, summarize, personalize tone, and phrase responses.
- The LLM never authorizes discounts, shipping subsidies, stock, delivery dates, payment status, or margin decisions.
- Deterministic engines authorize all offers.
- Discounts, shipping subsidies, delivery claims, and margin decisions must be deterministic and auditable.
- No discount or free shipping may bypass merchant rules and minimum-margin protection.

## Modular Ownership

Use these bounded contexts for planning and implementation:

- `checkout`: sessions, checkout events, session state, accepted offers attached to checkout, and order completion facts.
- `merchant`: merchant rules, shipping rules, brand voice, integrations metadata, feature flags, and policy limits.
- `decision`: intervention policy, scoring, deterministic offer authorization, and commercial safety gates.
- `shipping`: shipping subsidy decisions, freight margin checks, blocked regions, free/partial shipping evaluation.
- `conversation`: objection classification, safe message generation, LLM orchestration, and fallback copy.
- `commerce`: WooCommerce/Magento/VTEX commerce adapters for headless checkout and order sync.
- `payment`: buyer payment intents, attempts, provider webhooks, selected methods, failures, approvals, and rescue opportunities. Payment is processed by provider adapters such as Asaas, not by commerce adapters.
- `billing`: merchant SaaS billing, plans, subscriptions, usage metering, quotas, and billing-provider webhooks.
- `analytics`: dashboard/read models, attribution, conversion, offer, margin, and revenue metrics.
- `recovery`: post-abandonment recovery workflow and channel delivery. This is post-MVP unless explicitly requested.

Ownership rule: a module emits events only for facts it owns. Other modules consume those events to update their own state or projections.

## CQRS Rules

- Commands mutate source-of-truth state and may create outbox messages in the same Prisma transaction.
- Queries do not mutate state and must read by `merchant_id` first.
- Application use cases remain the synchronous boundary inside the monolith.
- Read models are owned by `analytics` unless they are local module lookups needed by command validation.
- Synchronous command flow may call local ports when immediate consistency is required.
- Asynchronous side effects use outbox events instead of direct infrastructure coupling.

## Prisma Rules

Prisma/PostgreSQL is the target persistence layer. In-memory repositories are development-only.

Prisma is an infrastructure adapter, not a domain model. Domain/application layers depend on repository ports, never Prisma types.

Initial Prisma model groups:

- `Merchant`, `MerchantRules`, `MerchantIntegration`.
- `CheckoutSession`, `CheckoutEvent`, `Conversation`, `ConversationMessage`.
- `AuthorizedOffer`, `AppliedOffer`, `CommerceApplicationAttempt`.
- `PaymentIntent`, `PaymentAttempt`, `PaymentProviderEvent`, `PaymentEvent`.
- `BillingPlan`, `MerchantSubscription`, `UsageEvent`, `BillingProviderEvent`.
- `RecoveryAttempt`.
- `MerchantDashboardDaily`, `MerchantDashboardOverview`, `OfferAttribution`.
- `OutboxMessage`, `InboxMessage`.

Outbox messages must be written in the same transaction as the state change that produced the event.

## RabbitMQ and Event Rules

RabbitMQ is used for asynchronous domain facts, not synchronous request/response between modules.

Exchanges:

- `aacp.events`: topic, durable, main domain event exchange.
- `aacp.retry`: durable retry path.
- `aacp.dlx`: durable dead-letter exchange.

Queues:

- `analytics.events.q`: consumes `checkout.*`, `offer.*`, `order.*`, `payment.*`, `recovery.*`.
- `conversation.events.q`: consumes `checkout.abandonment.scored`, `payment.failed`, `recovery.requested`.
- `commerce.events.q`: consumes `offer.authorized`, `offer.apply_requested`, `offer.expired`.
- `recovery.events.q`: consumes `checkout.abandoned`, `recovery.requested`.

Event routes describe facts, not imperative RPC commands.

Required event envelope:

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

Consumers must be idempotent by `event_id`.

## Testing Rules

Default implementation style is TDD.

Plan and implement tests by layer:

- Domain unit tests for rules, score, margin, shipping, and offer authorization.
- Application use case tests with fake repositories and fake ports.
- Prisma integration tests for repositories, transactions, tenant isolation, and outbox writes.
- Event contract tests for payload shape, envelope fields, and schema version behavior.
- Worker tests for publish success, retry, duplicate events, idempotency, and DLQ.
- E2E tests for start checkout -> track event -> authorize offer -> apply offer -> publish event -> dashboard projection.

Required gates:

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`

## Current Feature Specs

- MVP feature: `.specs/features/ai-checkout-mvp/`
- Modular foundation: `.specs/features/modular-ddd-foundation/`

When implementing future work, create or update a feature folder under `.specs/features/[feature]/` with:

- `spec.md`
- `design.md` for large or cross-context changes
- `tasks.md` with atomic tasks and verification criteria

## Current Known Concerns

- In-memory persistence is only for MVP development and resets on restart.
- Prisma schema and migrations exist for implemented modules; new payment/commerce/billing modules still need schema work.
- No RabbitMQ topology or outbox publisher exists yet.
- Commerce credential-less fallback proves offer flow but does not create real commerce orders.
- Real commerce sync requires provider credentials and OAuth/install flows.
- Buyer payment processing requires Asaas credentials and webhook configuration.
- Merchant billing requires Asaas billing credentials and webhook configuration.
- Real LLM responses require `OPENAI_API_KEY`.
- No OAuth install flow exists yet.
- Recovery channels are deferred.
- A/B testing and holdout attribution are deferred.

## How To Proceed After Loading This File

1. Inspect the current repo state before making assumptions.
2. Read the relevant spec/design/tasks for the requested work.
3. Preserve Clean Architecture boundaries.
4. Keep changes scoped and tenant-safe.
5. Add or update tests first when implementing behavior.
6. Update `.specs/project/STATE.md` when a decision, blocker, verification result, or deferred idea changes.
