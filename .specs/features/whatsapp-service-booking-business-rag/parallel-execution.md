# Parallel Execution

**User instruction**: 2026-11-14 - "por que esta demorando tanto? spawnar subagents".

The user requests more implementation agents to accelerate work. This changes the prior sequential execution guideline; the 71 criteria, 95 tasks, tests, local-only scope and product-preservation requirements remain.

## Ownership

| Agent | Checkout | Responsibility |
| --- | --- | --- |
| service_batch_01 | C:/tmp/zyon-service-booking-admission-20261114 | Phase7 T48–T55 next; preserves and hands off Phase4 drafts to P afterT25; isolated T97 field preparation already returned10/10 |
| service_company_ui | C:/tmp/zyon-service-company-ui-20261114 | Phase2 and T96 complete; T97 green, atomic commit pending. Next whole Phase8 T56–T62 preparation after merging root, with execution gates only after T55. |
| service_professional_agenda | C:/tmp/zyon-service-professional-agenda-20261114 | Phase3 T17–T25, then Phase4 T26–T32 using M's preserved preparation |
| root | C:/tmp/zyon-service-business-20261114 | Canonical integration, resource scheduling and cross-module review |

The initial preparation branches started at ae2cb48e7, after T8. Phase 1 returned clean at 15e6957d019e8d7c9001da7bc11b7c54fc269f24 with all required phase gates green. Phases 2/3 incorporated that base. The booking worker incorporates it before continuing the root's T26 preparation. Prepare tests/code in parallel without claiming dependent tasks complete. Before a dependency barrier, avoid changes to shared spec/task/STATE files so the base can advance without overwriting work. Each agent records assumptions/files/success in its own preparation note.

T17's previous dependency on T16 was an ordering convenience; its business dependencies are the schema, policy and authenticated profile through T9. Both phases can proceed after T9. Phase 4 waits for both phases to be integrated and green. Keep tasks sequential within each assigned phase and one atomic commit per task after its gate passes.

T26 source, unit cases and the native companion were prepared by root in the isolated booking checkout and handed to service_batch_01. They have not been run or committed. Preparing the rest of Phase 4 is allowed while Phases 2/3 finish; admission gates still wait for both integrated phases. Preserve later drafts outside the checked source fingerprint and restore each task before its gate/commit. No earlier task is called complete from preparation alone.

## Profile Contract

T9 adds fields to the existing authenticated /merchants/me profile: businessMode, businessModeSelectionState, servicePolicyStatus, policyVersion, servicePolicy (holdEnabled, holdMinutes, paymentMode, admissionsEnabled, or null), bookingBlockReason and capabilities {products, serviceAdministration, serviceBooking, reconcileExisting}. Role and subscription remain separate authorization axes. Confirm the actual mapper after T9 lands.

## Integration and Resources

- Work only in the assigned checkout. No remote actions, shared mutable Prisma/dependency junctions, schema redesign or unrelated source imports.
- Install independent dependencies from the existing offline store; do not download or upgrade packages. Production schema is already present. Coordinate heavy installs, full builds and AppModule/browser suites with root; this 16GB host recently had under 1GB free.
- Fast unit tests and disjoint source work can run in parallel. Heavy builds are serial; no duplicate compilation or runtime is started while an existing owner is active.
- Resource preflight refinement (2026-11-15): repeated physical-only 1.5GiB refusals launched no worker. A direct read-only Windows GlobalMemoryStatusEx snapshot found716MiB available physical but7069MiB available commitment. One official checked build may start with at least512MiB physical and6144MiB available commitment, with only one team heavy owner. This changes orchestration only: default compiler/typecheck, source coverage and test/transaction deadlines stay intact. Record the snapshot and any real failure. Native execution still gets its own post-build resource check; no OS settings or unrelated processes are changed.
- Do not modify the other agents' branches or feature status. Root resolves metadata/integration conflicts and runs affected combined checks. Do not drop, weaken or skip tests.
- Save genuine local UI screenshots for T10/T16 and report their paths promptly. Label local fixtures and avoid claiming Meta/PSP/production acceptance.
- No nested agents. Final proofs, independent verifier and screen review remain root's responsibility after the last task.

Source-review notes: C:/Users/Admin/Desktop/AACP/.audit/service-plan-20261114/execution/source-review-notes.md. Preserve all existing product journeys and the preexisting regression comparison; focused green tests are not a global production-readiness claim.

## Remaining Technical Fronts

After the green T97 atomic commit, C prepares the whole seven-task Phase8 T56–T62 batch: exact-case close/resume, fixed main-menu human action, scoped queue API/permissions, hook, drawer and Conversations tab. It uses the reviewed existing WhatsApp/support modules and M's Phase7 contracts. Before T55 is integrated, drafts remain outside checked application fingerprints; no dependent gate or completion is claimed. M retains Phase7, P retains Phase3 then Phase4, and root retains Phase9/integration. No extra worker is spawned and the one-heavy-slot rule remains.

Further dependency review confirms that the human binding and delivery front uses the existing WhatsApp/support/session modules and the T4 schema/T9 base; it does not depend on professional availability T25. T48 therefore depends on T9. To keep four fronts advancing, M begins the whole Phase7 T48-T55 batch after incorporating the committed root base. Its original booking drafts are hash-preserved outside fingerprints and will be handed to P for Phase4 afterT25. C retains company forms/list and later UI; Root retains RAG. Booking admission still waits for the original green T16+T25 barrier. All per-task gates, atomic commits, final coexistence proofs and local-only scope remain unchanged. No dependency is waived for a business operation.

While M awaits the original booking barrier, root assigns it only the isolated controlled ServiceNamesField and unit preparation for user-directed T97. Drafts stay outside M's application fingerprint and do not complete T97. C remains the owner of T96/T97 integration, hook/API wiring, browser, screenshots, gates and atomic commits. Booking drafts remain intact. This shares preparation without spawning duplicate workers or weakening task dependencies.

The renewed user instruction, "prossiga de onde parou spawnar subagentes para acelerar", keeps all three workers active. Root begins the independent RAG front T63-T71 in N instead of waiting for Conversations UI T62. T63 depends on integrated company writes T13 and professionals T18. T65 additionally waits T25 so reconciliation covers the completed professional/availability writers. Human handoff T48 depends on the Phase3 base T25, not the unrelated buyer screen T47. These are technical ordering changes; product scope and all95 atomic tasks,71 criteria, real gates and final independent verification remain.

C and P retain their current assignments. M retains booking preparation/gates after integrated green Phases2/3. After P/T25, root may assign Phase7/8 to P. Future Atendimento UI can be prepared by C after Phase2, but its gates wait for its RAG evaluation and actual booking endpoints. Only explicitly dispatched work is active; future assignments here are not completion claims. Root coordinates shared files, integration and the single heavy slot.
