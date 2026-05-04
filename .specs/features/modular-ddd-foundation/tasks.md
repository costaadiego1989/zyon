# Modular DDD Foundation Tasks

## Status

Documentation feature tasks are complete when this file, `spec.md`, `design.md`, `ROADMAP.md`, and `STATE.md` reflect the target architecture. Runtime implementation tasks remain planned for later execution.

## Tasks

- [x] T001 Create modular foundation spec with traceable requirements.
  - Depends on: existing `.specs/codebase/*`, `docs/architecture-clean-ddd.md`, `docs/ai-checkout-sales-agent-doc.md`.
  - Done when: `spec.md` defines goals, requirements, module scope, and acceptance criteria.
  - Tests: documentation review against `MDF-REQ-*`.
  - Gate: no runtime files changed.

- [x] T002 Create DDD/CQRS design with ownership and dependency rules.
  - Depends on: T001.
  - Done when: `design.md` defines module ownership, Clean Architecture layout, CQRS command/query rules, and dependency boundaries.
  - Tests: verify every module has clear owner and "does not own" boundaries.
  - Gate: no module can require direct infrastructure imports from another module.

- [x] T003 Document each module with responsibilities, commands, queries, events, invariants, and tests.
  - Depends on: T002.
  - Done when: checkout, merchant, decision, shipping, conversation, commerce, payment, analytics, and recovery are documented.
  - Tests: each module has at least one command/query/event/test area or explicit MVP limitation.
  - Gate: ownership is expressed as facts, not vague shared responsibility.

- [x] T004 Define Prisma persistence target and migration strategy.
  - Depends on: T002.
  - Done when: Prisma model groups, tenant indexing, repository boundary, outbox/inbox persistence, and source-of-truth rules are documented.
  - Tests: every persistent model group is tenant-scoped where applicable.
  - Gate: Prisma types must not leak into domain/application design.

- [x] T005 Define event contracts and envelope standard.
  - Depends on: T002.
  - Done when: event envelope includes `event_id`, `event_type`, `schema_version`, `merchant_id`, `occurred_at`, `correlation_id`, `causation_id`, `producer`, and `payload`.
  - Tests: contract tests can validate required envelope fields and schema version behavior.
  - Gate: routes describe facts, not imperative RPC commands.

- [x] T006 Define RabbitMQ topology, outbox publisher, retry, and dead-letter behavior.
  - Depends on: T005.
  - Done when: exchanges, queues, bindings, retry path, DLQ path, idempotency, and outbox statuses are documented.
  - Tests: worker tests can cover publish success, retry, duplicate event, and DLQ.
  - Gate: no consumer depends on synchronous response over RabbitMQ.

- [x] T007 Plan Prisma repositories per module without ORM leakage.
  - Depends on: T004.
  - Done when: repositories are described as infrastructure adapters implementing domain/application ports.
  - Tests: use case tests use fake repositories; integration tests use Prisma repositories.
  - Gate: repository methods stay intention-revealing and tenant-scoped.

- [x] T008 Plan analytics/dashboard read models.
  - Depends on: T005, T006.
  - Done when: analytics owns dashboard projections and consumes checkout/offer/order/payment/recovery facts.
  - Tests: projection replay is idempotent and tenant-scoped.
  - Gate: dashboard queries do not compute heavy metrics from transactional tables at request time once projections exist.

- [x] T009 Plan TDD test matrix by layer.
  - Depends on: T003.
  - Done when: domain, use case, Prisma integration, event contract, worker, and e2e test expectations are documented.
  - Tests: future implementation starts each task with a failing test or explicit contract fixture.
  - Gate: `pnpm build`, `pnpm typecheck`, and `pnpm test` remain required.

- [x] T010 Update roadmap and persistent state with architectural decisions.
  - Depends on: T001-T009.
  - Done when: project roadmap and state include modular foundation, Prisma, CQRS, RabbitMQ outbox, and TDD decisions.
  - Tests: roadmap/state mention the feature path and implementation defaults.
  - Gate: no contradictory deferred item remains unqualified.

## Future Implementation Task Groups

### Group A: Test Harness

- [ ] Add test runner configuration for API/packages.
- [ ] Add domain unit tests for rules, decision, shipping, and conversation fallback.
- [ ] Add application use case tests with fake repositories and fake ports.

### Group B: Prisma Persistence

- [ ] Add Prisma dependencies and PostgreSQL configuration.
- [ ] Create initial Prisma schema and migration.
- [ ] Implement Prisma repository adapters behind existing checkout ports.
- [ ] Add integration tests for sessions, events, offers, rules, and tenant isolation.

### Group C: Outbox and RabbitMQ

- [ ] Add messaging contracts package or shared module.
- [ ] Implement outbox writer and publisher worker.
- [ ] Implement RabbitMQ topology setup for `aacp.events`, `aacp.retry`, and `aacp.dlx`.
- [ ] Add consumer idempotency through inbox records.
- [ ] Add worker tests for publish, retry, duplicate, and DLQ paths.

### Group D: Module Extraction

- [ ] Split merchant rules from checkout into `merchant` module ports/use cases.
- [ ] Split analytics dashboard projections from checkout into `analytics` module.
- [ ] Split commerce offer application into `commerce` module.
- [ ] Introduce payment and recovery modules as event-first MVP shells.

### Group E: E2E and Gates

- [ ] Add e2e flow: start checkout -> track event -> authorize offer -> apply offer -> publish event -> dashboard projection.
- [ ] Add contract fixtures for all initial domain event types.
- [ ] Keep required gates: `pnpm build`, `pnpm typecheck`, `pnpm test`.
