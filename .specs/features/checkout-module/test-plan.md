# Checkout Module TDD Matrix

## Test Strategy

Every checkout behavior starts with a failing test or a contract fixture before implementation. The target order is:

1. Domain unit tests.
2. Application use case tests with fakes.
3. In-memory repository tests for MVP compatibility.
4. Event contract tests.
5. Prisma integration tests when persistence begins.
6. E2E flow tests after the main slices are green.

## Requirement Traceability

| Requirement | Domain Tests | Application Tests | Repository Tests | Contract/E2E Tests |
| --- | --- | --- | --- | --- |
| CHK-REQ-001 | `CheckoutSessionEntity.create initializes required state` | `StartCheckoutUseCase returns identifiers and silent mode` | `saveSession persists by tenant/session` | E2E start checkout response shape |
| CHK-REQ-002 | `CheckoutSessionId accepts provided public id` | `StartCheckoutUseCase preserves provided session_id` | `getSession requires same merchant_id` | E2E start with provided id |
| CHK-REQ-003 | `CheckoutIdentityService normalizes hints` | `StartCheckoutUseCase reuses tenant identity` | `resolveGlobalUserId isolates merchant indexes` | E2E same email across merchants returns different ids |
| CHK-REQ-004 | `CheckoutEvent validates checkout_started` | `StartCheckoutUseCase records checkout_started` | `recordEvent appends event` | `checkout.session.started` fixture |
| CHK-REQ-005 | none | `TrackCheckoutEventUseCase rejects missing or cross-tenant session` | `getSession cannot cross tenants` | E2E track unknown session returns not found |
| CHK-REQ-006 | `CheckoutAbandonmentService updates score and trigger flag` | `TrackCheckoutEventUseCase returns next score` | `recordEvent updates session score` | `checkout.abandonment.scored` fixture |
| CHK-REQ-007 | import-boundary test for domain | none | none | build/typecheck gate |
| CHK-REQ-008 | none | use case fake repository contract tests | repository port conformance tests | architecture review |
| CHK-REQ-009 | `AcceptedOffer rejects unapproved or expired offers` | `AcceptCheckoutOfferUseCase records accepted offer after validation` | `saveAcceptedOffer scopes by merchant/session` | E2E accept authorized offer |
| CHK-REQ-010 | `CompletedOrder idempotency key is stable` | `CompleteOrderUseCase is idempotent` | `saveCompletedOrder uses unique tenant/session/order` | `order.completed` fixture |
| CHK-REQ-011 | domain event factory tests | use case emits events with causation/correlation | outbox port appends envelopes | event contract tests |
| CHK-REQ-012 | none | transaction boundary test with fake unit of work | Prisma integration transaction rollback test | outbox integration test |
| CHK-REQ-013 | none | controller smoke through use case mocks | none | HTTP E2E route compatibility |
| CHK-REQ-014 | value object rejects empty merchant id | every command fixture includes merchant_id | tenant index tests | static review |
| CHK-REQ-015 | regression tests for current endpoints | current use case compatibility tests | current in-memory repo compatibility | MVP e2e flow |

## Domain Unit Test Inventory

- `checkout-session.entity.spec.ts`
  - creates a session with score `0`, `triggerAgent=false`, timestamps, cart, customer, and shipping snapshots.
  - preserves provided `sessionId`.
  - rehydrates without mutating snapshot data.
  - updates score and trigger flag when the score reaches threshold.
  - does not mutate previous entity snapshots.

- `checkout-identity.service.spec.ts`
  - normalizes email and phone hints.
  - prioritizes external customer id over email and phone.
  - returns no deterministic key when hints are absent.
  - includes `merchant_id` in identity scope.

- `checkout-abandonment.service.spec.ts`
  - maps checkout events to deterministic score changes.
  - clamps score to valid range.
  - returns threshold crossing information.
  - emits scored fact only when score changes.

- `accepted-offer.entity.spec.ts`
  - accepts only approved offers.
  - rejects expired offers.
  - keeps merchant/session/offer identity immutable.
  - stores value, type, margin, and expiration for audit.

- `completed-order.entity.spec.ts`
  - records external order id and total.
  - generates stable idempotency identity by merchant/session/order.
  - links accepted offer when present.

## Application Use Case Test Inventory

- `start-checkout.use-case.spec.ts`
  - creates session, event, and outbox fact.
  - reuses `global_user_id` for same merchant/customer hint.
  - does not reuse `global_user_id` across merchants.
  - preserves provided `session_id`.

- `track-checkout-event.use-case.spec.ts`
  - rejects missing session.
  - rejects cross-merchant access.
  - records event and returns updated score.
  - emits tracked and scored facts.

- `accept-checkout-offer.use-case.spec.ts`
  - rejects missing session.
  - rejects missing, unapproved, expired, or cross-tenant offer.
  - records accepted offer and `offer_accepted` compatibility event.
  - emits accepted offer attachment fact if checkout owns the attachment event.

- `complete-order.use-case.spec.ts`
  - rejects missing session.
  - records `order_completed`.
  - is idempotent for the same external order.
  - emits `order.completed` once.

- `get-checkout-session.use-case.spec.ts`
  - returns session by tenant/session.
  - hides another merchant's session.

## Repository Test Inventory

- `in-memory-checkout.repository.spec.ts`
  - tenant-scoped session storage.
  - tenant-scoped identity index.
  - append-only events.
  - score update compatibility.
  - tenant-scoped offer lookup.

- `prisma-checkout.repository.int-spec.ts`
  - saves and loads session by `(merchant_id, session_id)`.
  - records events append-only.
  - persists accepted offer and completed order.
  - rolls back outbox when state write fails.
  - enforces tenant indexes and unique constraints.

## Event Contract Test Inventory

- `checkout-event-envelope.contract.spec.ts`
  - requires all envelope fields.
  - requires `producer=checkout`.
  - requires `schema_version=1`.
  - rejects missing `merchant_id`.
  - keeps payloads serializable.

- Fixtures:
  - `checkout.session.started.v1.json`
  - `checkout.event.tracked.v1.json`
  - `checkout.abandonment.scored.v1.json`
  - `checkout.abandoned.v1.json`
  - `order.completed.v1.json`

## E2E Test Inventory

- `checkout-session.e2e-spec.ts`
  - start checkout -> track idle/coupon/shipping event -> trigger agent.
  - start checkout with same email for two merchants -> different global users.
  - track event for another merchant's session -> not found.

- `checkout-offer-order.e2e-spec.ts`
  - start checkout -> authorize offer through existing deterministic path -> accept/apply offer -> complete order.
  - completed order updates compatibility overview until analytics owns projection.

## Gates

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`

The current `@aacp/api` test script is a placeholder. The first implementation task must install or configure the test runner before any checkout behavior is changed.
