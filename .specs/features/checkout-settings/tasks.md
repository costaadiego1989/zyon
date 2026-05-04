# Checkout Settings Module Tasks

- [x] CS-T001 Create spec/design/tasks for the module.
  - Covers: CS-REQ-001 through CS-REQ-008.
  - Gate: documentation review.

- [x] CS-T002 Define shared/domain DTOs for checkout settings, patch, and safe context.
  - Covers: CS-REQ-002, CS-REQ-005.
  - Tests: type-level build and use case fixtures.

- [x] CS-T003 Implement `CheckoutSettingsEntity` defaults and validation.
  - Covers: CS-REQ-002, CS-REQ-003, CS-REQ-004.
  - Tests: domain unit tests.

- [x] CS-T004 Implement repository port and in-memory adapter.
  - Covers: CS-REQ-001.
  - Tests: repository contract tests.

- [x] CS-T005 Implement get/update/reset/context use cases.
  - Covers: CS-REQ-001, CS-REQ-002, CS-REQ-005.
  - Tests: application tests with fake repository.

- [x] CS-T006 Add Prisma model and migration.
  - Covers: CS-REQ-007.
  - Gate: `pnpm db:migrate`.

- [x] CS-T007 Implement Prisma repository.
  - Covers: CS-REQ-001, CS-REQ-007.
  - Tests: Prisma roundtrip, tenant isolation, JSON preservation, unique merchant settings.

- [x] CS-T008 Add protected HTTP controller.
  - Covers: CS-REQ-001.
  - Tests: controller/e2e flow with authenticated merchant.

- [x] CS-T009 Compose `agent-rules` context with checkout-settings.
  - Covers: CS-REQ-005, CS-REQ-006.
  - Tests: agent context includes external operational settings and cannot authorize offers.

- [x] CS-T010 Update checkout trigger/open behavior to read checkout-settings.
  - Covers: CS-REQ-004.
  - Tests: start/track/decision use cases respect mode, trigger list, and minimum score.

- [ ] CS-T011 Deprecate `agent-rules.checkoutSettings` ownership.
  - Covers: CS-REQ-006.
  - Gate: compatibility tests still pass.

- [ ] CS-T012 Run closure gates.
  - Gate: `pnpm test`, `pnpm test:prisma`, `pnpm typecheck`.

- [ ] CS-T013 Enforce cooldown and max interventions using a checkout intervention ledger.
  - Covers: CS-REQ-004.
  - Tests: repeated triggers inside cooldown stay silent; sessions stop triggering after max interventions.
