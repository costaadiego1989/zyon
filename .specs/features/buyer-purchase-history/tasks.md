# Buyer Purchase History Tasks

- [x] BPH-T001 Create spec/design/tasks for buyer purchase history.
  - Covers: merchant-scoped history, agent context, cost compression, and monetization hooks.

- [x] BPH-T002 Implement domain entity and aggregation tests.
  - Gate: stats, top categories, top SKUs, average order value, and discount sensitivity unit tests.

- [x] BPH-T003 Add repository port and in-memory repository.
  - Gate: idempotent `merchant_id + order_id` upsert tests.

- [x] BPH-T004 Add use cases.
  - `RecordCompletedPurchaseUseCase`
  - `GetBuyerPurchaseContextUseCase`
  - Gate: tenant-safe use case tests.

- [x] BPH-T005 Wire checkout completed order into purchase history.
  - Gate: checkout e2e proves completion updates history.

- [x] BPH-T006 Add Prisma schema and repository.
  - Gate: Prisma integration tests with Docker Compose PostgreSQL.

- [x] BPH-T007 Connect safe purchase context into agent-rules/checkout conversation.
  - Gate: conversation context test proves compact history is present and PII is absent.

- [x] BPH-T008 Add billing/metering event seams.
  - Gate: tests prove history context generation and negotiation enrichment can be counted.

- [x] BPH-T009 Add protected read API for merchant support/dashboard.
  - Gate: authenticated route returns only current merchant buyer history.
