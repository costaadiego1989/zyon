# Agent Rules Module Tasks

- [x] AR-T001 Add Prisma `AgentRule` model and migration with merchant/user/agent identity.
  - Covers: AR-REQ-009.
  - Gate: `pnpm db:migrate`.

- [x] AR-T002 Add shared/domain DTOs for agent identity, capabilities, guardrails, checkout settings, and agent context.
  - Covers: AR-REQ-002 through AR-REQ-006.
  - Gate: `pnpm --filter @aacp/api test`.

- [x] AR-T003 Implement `AgentRulesEntity` defaults and validation.
  - Covers: AR-REQ-003, AR-REQ-004, AR-REQ-008.
  - Tests: domain unit tests.

- [x] AR-T004 Implement repository port plus in-memory and Prisma adapters.
  - Covers: AR-REQ-001, AR-REQ-007, AR-REQ-009.
  - Tests: repository and Prisma integration tests.

- [x] AR-T005 Implement `GetAgentRulesUseCase`, `UpdateAgentRulesUseCase`, and `GetAgentContextUseCase`.
  - Covers: AR-REQ-001, AR-REQ-002, AR-REQ-006, AR-REQ-007.
  - Tests: application tests.

- [x] AR-T006 Implement protected HTTP controller.
  - Covers: API surface and auth requirement.
  - Tests: controller/e2e tests.

- [x] AR-T007 Add protected Prisma e2e flow.
  - Flow: register merchant -> update agent rules -> read context.
  - Gate: `pnpm test:prisma`.

- [x] AR-T008 Wire conversation/checkout consumers to query agent context.
  - Covers: integration points.
  - Tests: use case tests proving context is passed without authorizing offers.

- [x] AR-T009 Run gates.
  - Gate: `pnpm test`, `pnpm test:prisma`, `pnpm typecheck`.
