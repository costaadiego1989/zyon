# Parallel Execution

**User instruction**: 2026-11-14 - "por que esta demorando tanto? spawnar subagents".

The user requests more implementation agents to accelerate work. This changes the prior sequential execution guideline; the 71 criteria, 95 tasks, tests, local-only scope and product-preservation requirements remain.

## Ownership

| Agent | Checkout | Responsibility |
| --- | --- | --- |
| service_batch_01 | C:/tmp/zyon-service-business-20261114 | T9, finish Phase 1 and report exact gates; canonical integration root |
| service_company_ui | C:/tmp/zyon-service-company-ui-20261114 | Phase 2 T10–T16: signup choice, policy/mode/About APIs and existing company form |
| service_professional_agenda | C:/tmp/zyon-service-professional-agenda-20261114 | Phase 3 T17–T25: catalog mode guard, professionals and shared availability |
| root | C:/tmp/zyon-service-booking-admission-20261114 | Prepare T26 admission code/tests against the agreed T23 contract; no task completion before integrated Phase 2/3 |

New branches start at ae2cb48e7, after T8. Prepare tests/code in parallel, without claiming dependent tasks complete. Incorporate T9 by fast-forward before the first dependent gate/commit. Before that barrier, avoid changes to shared spec/task/STATE files so the base can advance without overwriting work. Each agent records assumptions/files/success in its own preparation note.

T17's previous dependency on T16 was an ordering convenience; its business dependencies are the schema, policy and authenticated profile through T9. Both phases can proceed after T9. Phase 4 waits for both phases to be integrated and green. Keep tasks sequential within each assigned phase and one atomic commit per task after its gate passes.

## Profile Contract

T9 adds fields to the existing authenticated /merchants/me profile: businessMode, businessModeSelectionState, servicePolicyStatus, policyVersion, servicePolicy (holdEnabled, holdMinutes, paymentMode, admissionsEnabled, or null), bookingBlockReason and capabilities {products, serviceAdministration, serviceBooking, reconcileExisting}. Role and subscription remain separate authorization axes. Confirm the actual mapper after T9 lands.

## Integration and Resources

- Work only in the assigned checkout. No remote actions, shared mutable Prisma/dependency junctions, schema redesign or unrelated source imports.
- Install independent dependencies from the existing offline store; do not download or upgrade packages. Production schema is already present. Coordinate heavy installs, full builds and AppModule/browser suites with root; this 16GB host recently had under 1GB free.
- Fast unit tests and disjoint source work can run in parallel. Heavy builds are serial; no duplicate compilation or runtime is started while an existing owner is active.
- Do not modify the other agents' branches or feature status. Root resolves metadata/integration conflicts and runs affected combined checks. Do not drop, weaken or skip tests.
- Save genuine local UI screenshots for T10/T16 and report their paths promptly. Label local fixtures and avoid claiming Meta/PSP/production acceptance.
- No nested agents. Final proofs, independent verifier and screen review remain root's responsibility after the last task.

Source-review notes: C:/Users/Admin/Desktop/AACP/.audit/service-plan-20261114/execution/source-review-notes.md. Preserve all existing product journeys and the preexisting regression comparison; focused green tests are not a global production-readiness claim.
