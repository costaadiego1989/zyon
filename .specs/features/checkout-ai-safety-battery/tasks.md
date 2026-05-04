# Checkout AI Safety Battery Tasks

- [x] AIS-T001 Create spec/design/tasks for the safety battery.
  - Covers: AIS-REQ-001 through AIS-REQ-008.

- [x] AIS-T002 Add conversation-engine safety predicate and unit tests.
  - Covers: AIS-REQ-001 through AIS-REQ-005.
  - Gate: `pnpm --filter @aacp/conversation-engine test`.

- [x] AIS-T003 Add deterministic checkout AI safety e2e scenarios.
  - Covers: AIS-REQ-001 through AIS-REQ-006.
  - Gate: default `pnpm test`.

- [x] AIS-T004 Keep live AI checkout e2e opt-in.
  - Covers: AIS-REQ-007, AIS-REQ-008.
  - Gate: skipped by default; runs with `RUN_REAL_AI_E2E=true`.

- [x] AIS-T005 Run full closure gates.
  - Gate: `pnpm test`, `pnpm test:prisma`, `pnpm typecheck`.
