# Roadmap

**Current Milestone:** Functional AACP Checkout MVP
**Status:** In Progress

---

## Functional AACP Checkout MVP

**Goal:** A merchant can configure rules, embed a secure checkout widget, negotiate with a buyer, charge the buyer through Asaas, sync the order to commerce, and see analytics.
**Target:** Shippable local/pilot MVP.

### Features

**Checkout Session Identity** - IN PROGRESS

- Create `session_id` and `global_user_id`.
- Link external customer identifiers to the global buyer identity.
- Keep all history scoped by `merchant_id`.
- Close the checkout bounded context with TDD tasks documented in `.specs/features/checkout-module/`.
- Cover checkout domain, use cases, repository ports, event contracts, outbox-ready flow, and compatibility e2e tests before moving to the next module.

**Decision and Offer Engine** - IN PROGRESS

- Score abandonment from checkout events.
- Trigger the agent only on meaningful hesitation.
- Authorize discounts and shipping offers using margin rules.

**Conversational Widget** - IN PROGRESS

- Embed as Web Component.
- Capture checkout signals.
- Chat with the buyer and show offer actions.
- Move to a token-only secure embed that does not receive sensitive cart, margin, cost, or customer data.

**Widget Conversation Flow Fixes** - NEXT

- Fix 8 confirmed UI/UX bugs: composer visibility during streaming, coupon quick-reply gate, ShippingSelector render, freight totals, CouponBox layout, transparent card form, support fallback.
- Install Playwright and add E2E coverage for conversation happy path, card form, and support panel.
- Spec: `.specs/features/widget-conversation-fixes/`.

**User Hub Buyer Panel** - NEXT

- Wire `UserPanel` to real buyer API (`/buyer/me/*` endpoints).
- Implement `useBuyerHub` hook replacing merchant-scoped `useAccountHub`.
- Complete Profile, Orders, Agent, and Settings tabs with real data and saves.
- Spec: `.specs/features/user-hub-buyer-panel/`.

**Payment Asaas** - PLANNED

- Create payment intents for checkout sessions.
- Charge buyers through Asaas without storing raw card data or CVV.
- Confirm or fail checkout through idempotent Asaas webhooks.

**Commerce Sync** - PLANNED

- Validate cart server-side through commerce adapters.
- Create pending orders in Shopify/WooCommerce/etc.
- Mark commerce orders as paid only after payment approval.

**Billing Asaas** - PLANNED

- Charge merchants for SaaS usage separately from buyer payments.
- Consume metering events and enforce plan quotas.

**Merchant Dashboard** - IN PROGRESS

- Configure commercial and shipping rules.
- Show conversations, offers, and conversion metrics.

---

## Post-MVP Hardening

**Goal:** Move from dev MVP to merchant pilot.

### Features

**Modular DDD Foundation** - PLANNED

- Document module ownership for checkout, merchant, decision, shipping, conversation, commerce, payment, analytics, and recovery.
- Prepare Prisma/PostgreSQL persistence, CQRS, RabbitMQ outbox, event contracts, and TDD tasks.
- Feature spec: `.specs/features/modular-ddd-foundation/`.

**PostgreSQL Persistence with Prisma** - PLANNED

- Replace in-memory repositories behind existing ports.
- Persist sessions, events, offers, rules, conversations, integrations, outbox, and read models.
- Keep all commands and queries scoped by `merchant_id`.

**RabbitMQ Outbox Eventing** - PLANNED

- Publish domain facts through durable outbox workers.
- Use `aacp.events`, `aacp.retry`, and `aacp.dlx` topology.
- Keep consumers idempotent and responsibility-scoped.

**Shopify OAuth App Install** - PLANNED
**A/B Holdout Analytics** - PLANNED
**Payment Failure Rescue** - PLANNED

---

## Architecture Hardening

**Goal:** Eliminate critical couplings before new features land (cross-sell, buyer wallet, scraping agent, fulfillment).
**Plan doc:** `docs/architecture/refactor-plan.md`
**ADRs:** `docs/architecture/adr/0003` (EventBus), `0004` (Prisma isolation), `0005` (multi-tenant)

Waves ship independently — no big-bang. Each wave leaves the system deployable.

### Wave 0 — CI Hygiene (1 sprint) - PLANNED

- `eslint-plugin-boundaries` blocking cross-layer and cross-context infra imports.
- CI gate: test + lint + typecheck + Prisma integration on every PR.
- Coverage reporting (`--coverage`) published to CI.
- Feature spec: `.specs/features/hardening-wave-0-ci-hygiene/`.

### Wave 1 — PersistenceModule + Prisma Isolation (1–2 sprints) - PLANNED

- Move `prisma-client.ts` from `checkout/` to `shared/persistence/`.
- `PersistenceModule` global — single registered client.
- Tenant middleware filters all `findMany`/`findFirst`/`update`/`delete` by `merchantId`.
- Success: zero cross-module `../checkout/infrastructure/prisma` imports.
- Feature spec: `.specs/features/hardening-wave-1-persistence-module/`.

### Wave 2 — CheckoutRepository Split (2 sprints) - PLANNED

- Explode 17-method God Port into: `CheckoutSessionRepository`, `OfferRepository`, `OrderRepository`, `MerchantRulesRepository`, `BuyerIdentityRepository`, `OutboxRepository`, `DashboardReadModel`.
- Migrate use-case by use-case; each ships as a small PR with tests.
- Success: `CheckoutRepository` deleted; each use-case test mocks only its own port.
- Feature spec: `.specs/features/hardening-wave-2-checkout-repo-split/`.

### Wave 3 — EventBus + OutboxDispatcher (2 sprints) - PLANNED

- `@nestjs/cqrs` in-process EventBus.
- `OutboxDispatcher` (BullMQ + Redis) with idempotency by `event_id`.
- Payment/Negotiation/Embed decoupled from checkout use-case injection.
- Success: `payment` and `negotiation` import nothing from `checkout/application/`.
- Feature spec: `.specs/features/hardening-wave-3-event-bus-outbox/`.

### Wave 4 — TenantContext + RLS (1 sprint) - PLANNED

- `AsyncLocalStorage` loading `{ merchantId, userId, role }` per request.
- `TenantGuard` global + `@CurrentTenant()` decorator.
- Postgres RLS optional via `PRISMA_RLS=true`.
- Success: 1000-request cross-tenant fuzz test returns 403/404 every time.
- Feature spec: `.specs/features/hardening-wave-4-tenant-context/`.

### Wave 5 — Observability + Resilient HttpClient (1 sprint) - PLANNED

- `pino` + `nestjs-pino` structured logs with correlation-id.
- OpenTelemetry SDK + exporter.
- Prometheus metrics: `checkout_started_total`, `order_completed_total`, `payment_approved_total`, `outbox_lag_seconds`, `llm_latency_seconds`.
- `HttpClient` in `shared/http/`: 5 s default timeout, 3× exponential retry, circuit breaker.
- Feature spec: `.specs/features/hardening-wave-5-observability/`.

### Wave 6 — Widget Refactor + Playwright (2 sprints) - PLANNED

- Split 706-line `useCheckoutAgentViewModel` into: `useCheckoutSession`, `useCheckoutChat`, `useCheckoutCart`, `useCheckoutPayment`, `useCheckoutPanels`.
- Zod runtime validation of API responses before render.
- Playwright suite covering 8 critical flows from `docs/testing/test-strategy.md`.
- Feature spec: `.specs/features/hardening-wave-6-widget-refactor/`.

### Wave 7 — New Features (parallel after Wave 3) - PLANNED

- Cross-sell + coupons: `docs/features/cross-sell-and-coupons.md`
- Buyer self-checkout wallet: `docs/features/buyer-self-checkout.md`
- Price scraping agent: `docs/features/price-scraping-agent.md`
- Delivery + fulfillment: `docs/features/delivery-and-fulfillment.md`
- Feature spec: `.specs/features/hardening-wave-7-new-features/`.

---

## Future Considerations

- WhatsApp/email recovery.
- ML-based abandonment scoring.
- Multi-platform adapters.
- Advanced shipping and warehouse optimization.
