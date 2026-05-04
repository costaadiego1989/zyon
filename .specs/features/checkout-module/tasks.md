# Checkout Module Closure Tasks

## Status

Planning and TDD documentation started on 2026-05-01. Runtime implementation must begin with the test harness and the first failing tests.

## Task Groups

### Group A: Test Harness

- [x] CHK-T001 Configure API test runner.
  - Requires: current `apps/api/package.json`, TypeScript ESM/NestJS setup.
  - Done when: `pnpm --filter @aacp/api test` runs real tests instead of the placeholder echo.
  - Tests: add one smoke test for the test runner.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-015.

- [x] CHK-T002 Add checkout test fixture builders.
  - Requires: shared DTO contracts from `@aacp/shared-types`.
  - Done when: tests can build merchant ids, carts, sessions, offers, and commands without duplication.
  - Tests: fixture smoke tests or direct use in first domain tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-001, CHK-REQ-014.

### Group B: Domain

- [x] CHK-T010 Harden `CheckoutSessionEntity`.
  - Requires: `checkout-session.entity.spec.ts` failing tests first.
  - Done when: create, rehydrate, score update, trigger threshold, and immutability behavior are covered.
  - Tests: domain unit tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-001, CHK-REQ-002, CHK-REQ-006, CHK-REQ-007.

- [x] CHK-T011 Add checkout identity domain service.
  - Requires: `checkout-identity.service.spec.ts` failing tests first.
  - Done when: customer hint normalization and merchant-scoped identity keys are framework-free.
  - Tests: domain unit tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-003, CHK-REQ-007, CHK-REQ-014.

- [x] CHK-T012 Add checkout abandonment domain service.
  - Requires: score policy compatibility with `@aacp/decision-engine`.
  - Done when: score changes and trigger threshold are deterministic and tested.
  - Tests: domain unit tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-006, CHK-REQ-007.

- [x] CHK-T013 Add checkout domain events.
  - Requires: event contract names from `design.md`.
  - Done when: domain/application can create checkout-owned events without infrastructure imports.
  - Tests: domain event factory tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-004, CHK-REQ-011.

- [x] CHK-T014 Add accepted offer and completed order domain entities.
  - Requires: accepted offer and completed order test specs.
  - Done when: offer acceptance and order completion facts enforce tenant/session identity and idempotency inputs.
  - Tests: domain unit tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-009, CHK-REQ-010.

### Group C: Application

- [x] CHK-T020 Add fake checkout repositories and ports for use case tests.
  - Requires: domain entities from Group B where available.
  - Done when: use cases can be tested without NestJS container or infrastructure adapters.
  - Tests: fake repository contract tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-008.

- [x] CHK-T021 Test and refactor `StartCheckoutUseCase`.
  - Requires: CHK-T001, CHK-T002, CHK-T010, CHK-T011.
  - Done when: session creation, provided id preservation, identity reuse, event record, and outbox-ready event creation are tested.
  - Tests: application use case tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-001, CHK-REQ-002, CHK-REQ-003, CHK-REQ-004.

- [x] CHK-T022 Test and refactor `TrackCheckoutEventUseCase`.
  - Requires: CHK-T012, CHK-T013.
  - Done when: missing session, cross-tenant session, score update, tracked fact, and scored fact are tested.
  - Tests: application use case tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-005, CHK-REQ-006, CHK-REQ-011, CHK-REQ-014.

- [x] CHK-T023 Add `AcceptCheckoutOfferUseCase`.
  - Requires: CHK-T014.
  - Done when: checkout records accepted offer facts after validation and preserves existing apply-offer compatibility.
  - Tests: application use case tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-009, CHK-REQ-015.

- [x] CHK-T024 Add `CompleteOrderUseCase`.
  - Requires: CHK-T014.
  - Done when: order completion is tenant-scoped, idempotent, and emits one `order.completed` fact.
  - Tests: application use case tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-010, CHK-REQ-011.

- [x] CHK-T025 Add `GetCheckoutSessionUseCase`.
  - Requires: repository fake from CHK-T020.
  - Done when: session reads are tenant-scoped and hidden across merchants.
  - Tests: application query tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-014.

### Group D: Ports and In-Memory Compatibility

- [x] CHK-T030 Split checkout repository ports by intention.
  - Requires: use case tests from Group C.
  - Done when: session, event, accepted offer, order, and outbox responsibilities are expressed without generic ORM leakage.
  - Tests: compile and fake port tests.
  - Gate: `pnpm build`, `pnpm typecheck`.
  - Covers: CHK-REQ-008.

- [x] CHK-T031 Update in-memory repository to implement new checkout ports.
  - Requires: CHK-T030.
  - Done when: current MVP endpoints keep working with split ports.
  - Tests: in-memory repository tests and use case tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-003, CHK-REQ-005, CHK-REQ-015.

### Group E: Event Contracts and Outbox-Ready Flow

- [x] CHK-T040 Add checkout event envelope mapper and fixtures.
  - Requires: CHK-T013.
  - Done when: all checkout event fixtures validate envelope fields and payloads.
  - Tests: event contract tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-011.

- [x] CHK-T041 Add checkout outbox port and in-memory implementation.
  - Requires: CHK-T040.
  - Done when: command tests assert state change plus outbox append intent.
  - Tests: use case tests with fake outbox and in-memory outbox tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-011, CHK-REQ-012.

### Group F: Prisma Persistence

- [x] CHK-T050 Add Prisma schema models for checkout-owned state.
  - Requires: project Prisma setup task from modular foundation.
  - Done when: schema includes checkout sessions, checkout events, accepted offers, completed orders, and outbox messages with tenant indexes.
  - Tests: migration validation.
  - Gate: Prisma migration command, `pnpm build`.
  - Covers: CHK-REQ-012, CHK-REQ-014.

- [x] CHK-T051 Implement Prisma checkout repositories.
  - Requires: CHK-T050.
  - Done when: Prisma adapters implement checkout ports without leaking Prisma types inward.
  - Tests: Prisma integration tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-008, CHK-REQ-012.

- [x] CHK-T052 Test transaction and outbox atomicity.
  - Requires: CHK-T051.
  - Done when: rollback tests prove outbox and state writes commit/fail together.
  - Tests: Prisma integration tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-012.

### Group G: Presentation and E2E Compatibility

- [x] CHK-T060 Keep checkout HTTP routes thin and compatible.
  - Requires: application use cases green.
  - Done when: controller only maps HTTP to use cases and returns DTO-compatible responses.
  - Tests: controller or HTTP smoke tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-013, CHK-REQ-015.

- [x] CHK-T061 Add checkout session E2E flow.
  - Requires: CHK-T021, CHK-T022, CHK-T060.
  - Done when: start checkout -> track events -> trigger agent is verified through HTTP.
  - Tests: E2E tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-001 through CHK-REQ-006.

- [x] CHK-T062 Add checkout offer/order E2E flow.
  - Requires: CHK-T023, CHK-T024, CHK-T060.
  - Done when: authorized offer acceptance and order completion are verified through HTTP-compatible flow.
  - Tests: E2E tests.
  - Gate: `pnpm --filter @aacp/api test`.
  - Covers: CHK-REQ-009, CHK-REQ-010, CHK-REQ-015.

## Closure Criteria

- [x] All checkout requirements in `spec.md` have passing tests listed in `test-plan.md`, except Prisma-specific persistence requirements deferred below.
- [x] Checkout domain imports are framework-free.
- [x] All checkout commands and queries are tenant-scoped by `merchant_id`.
- [x] Checkout-owned event contracts have fixtures and tests.
- [x] In-memory MVP compatibility remains green.
- [x] Prisma checkout persistence and outbox atomicity are implemented or explicitly deferred in `STATE.md`.
- [x] `pnpm build` passes.
- [x] `pnpm typecheck` passes.
- [x] `pnpm test` passes.
