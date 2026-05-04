# Checkout Module Closure Spec

## Goal

Close the `checkout` bounded context as the source of truth for checkout sessions, checkout lifecycle events, session abandonment state, accepted offers attached to checkout, and order completion facts.

This feature starts with TDD documentation and then implements domain, application, persistence, events, and presentation behavior in small verified slices.

## Scope

### In Scope

- Start checkout sessions with stable public identifiers.
- Resolve `global_user_id` in a tenant-safe way.
- Record checkout lifecycle events.
- Update checkout-owned abandonment state from tracked events.
- Attach accepted offers to a checkout session after deterministic authorization by other modules or pure engines.
- Record order completion facts.
- Emit checkout-owned facts through an outbox-ready event contract.
- Keep HTTP compatibility with the current MVP endpoints.
- Add tests before implementation for every behavior below.

### Out of Scope

- Merchant rules ownership, except reading them through ports while the MVP still keeps rules in checkout.
- Discount or shipping authorization policy. Checkout stores authorized or accepted offer facts but does not decide commercial eligibility.
- LLM copy generation.
- Shopify or external commerce offer application.
- Analytics dashboard projections beyond compatibility until the analytics module owns projections.
- Real RabbitMQ worker implementation unless the outbox task group reaches execution.

## Requirements

- CHK-REQ-001: `StartCheckoutUseCase` must create a checkout session with `merchant_id`, `session_id`, `conversation_id`, `global_user_id`, cart, optional customer hints, optional shipping quote, initial score `0`, and silent agent mode.
- CHK-REQ-002: If the caller provides `session_id`, checkout must preserve it and still scope persistence by `merchant_id`.
- CHK-REQ-003: Identity resolution must reuse `global_user_id` for the same `merchant_id` plus normalized customer hint, and must not reuse it across merchants.
- CHK-REQ-004: Starting a checkout must record `checkout_started` as a checkout lifecycle event.
- CHK-REQ-005: Tracking a checkout event must fail for missing sessions and must never find a session from another merchant.
- CHK-REQ-006: Tracked checkout events must update abandonment score deterministically and set `trigger_agent` only when the score reaches the checkout threshold.
- CHK-REQ-007: Checkout must keep domain behavior framework-free. Domain entities, value objects, domain services, and domain events must not import NestJS, Prisma, HTTP, Shopify, OpenAI, or environment configuration.
- CHK-REQ-008: Checkout must expose intention-revealing repository ports for sessions, events, accepted offers, order completion, and outbox appends.
- CHK-REQ-009: Applying an authorized offer must record an accepted-offer fact only after validating tenant, session, approval status, and expiration.
- CHK-REQ-010: Completing an order must be idempotent for the same merchant/session/order identity and must emit `order.completed`.
- CHK-REQ-011: Checkout events must use the project event envelope with `event_id`, `event_type`, `schema_version`, `merchant_id`, `occurred_at`, `correlation_id`, `causation_id`, `producer`, and `payload`.
- CHK-REQ-012: Checkout writes and outbox messages must be persisted atomically once Prisma persistence is introduced.
- CHK-REQ-013: HTTP controllers must remain thin transport adapters that call application use cases and return DTO-compatible responses.
- CHK-REQ-014: All commands and queries must take `merchant_id` first or derive scope from a tenant-bound request.
- CHK-REQ-015: Existing MVP behavior must remain compatible: start checkout, track event, get decision, chat, evaluate shipping, apply offer, and dashboard overview keep working while ownership is extracted.

## Acceptance Criteria

- A TDD matrix maps every requirement to domain, application, repository, event-contract, and e2e tests.
- Checkout domain and application tests can run without NestJS.
- Repository tests prove tenant isolation and outbox atomicity once Prisma exists.
- Event contract fixtures exist for `checkout.session.started`, `checkout.event.tracked`, `checkout.abandonment.scored`, `checkout.abandoned`, and `order.completed`.
- The module can be considered closed when all tasks in `tasks.md` are complete and `pnpm build`, `pnpm typecheck`, and `pnpm test` pass.
