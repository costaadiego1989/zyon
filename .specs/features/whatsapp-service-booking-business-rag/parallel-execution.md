# Parallel Execution

**User instruction**: 2026-11-14 - "por que esta demorando tanto? spawnar subagents".

The user requests more implementation agents to accelerate work. This changes the prior sequential execution guideline; the 71 criteria, 95 tasks, tests, local-only scope and product-preservation requirements remain.

## Ownership

Current checkpoint2026-11-16:43/103 tasks locally complete. C owns T98 source/gates and the sole execution window; P prepares T30-T32 source from committed29; M prepares T54-T55 source from committed53; Root retains dirty69 and its pending combined checked/native proof. No other worker starts a runner/build/container while C holds the window. Later direct additions T99-T103 and the T57 semantic clarification are recorded, not dispatched as completed work. Final95 moved after the added phases so acceptance cannot omit them. Channel is confirmed WhatsApp plus authenticated Conversations link; no SMS or production send is authorized.

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
- Resource preflight refinement (2026-11-15): physical-only guards repeatedly refused before any worker/test. The Windows GlobalMemoryStatusEx read-only kernel measurement and actual green P23/M50 runs informed the orchestration: one exclusive checked build requires available commitment of the measured default V8 heap plus1024MiB (4144+1024=5168MiB here). Physical availability is recorded informationally; Windows manages working sets and paging. A fresh native preflight remains separate from its build. The model-disabled AppModule/PG/Redis family requires2GiB available commitment, not reservation of its unused maximum V8 heap; no model or browser is loaded in that family. This changes only our ignored launcher coordination, not compiler coverage, heap flags, source checks, application/transaction/test deadlines, ownership or cleanup contracts. Preserve old refusals and any actual failures. Do not change OS settings or unrelated processes.

- Do not modify the other agents' branches or feature status. Root resolves metadata/integration conflicts and runs affected combined checks. Do not drop, weaken or skip tests.
- Save genuine local UI screenshots for T10/T16 and report their paths promptly. Label local fixtures and avoid claiming Meta/PSP/production acceptance.
- No nested agents. Final proofs, independent verifier and screen review remain root's responsibility after the last task.

Source-review notes: C:/Users/Admin/Desktop/AACP/.audit/service-plan-20261114/execution/source-review-notes.md. Preserve all existing product journeys and the preexisting regression comparison; focused green tests are not a global production-readiness claim.

## Remaining Technical Fronts

C also performs a read-only incremental review of M's T51 input/context and mutation/dispatch seams while its Phase8 execution waits55. It returns findings and concrete paths only, without editing M source or running heavy gates. This helps preserve the two valid T49 zero-binding negative assertions and is not the final independent Verifier.

After the green T97 atomic commit, C prepares the whole seven-task Phase8 T56–T62 batch: exact-case close/resume, fixed main-menu human action, scoped queue API/permissions, hook, drawer and Conversations tab. It uses the reviewed existing WhatsApp/support modules and M's Phase7 contracts. Before T55 is integrated, drafts remain outside checked application fingerprints; no dependent gate or completion is claimed. M retains Phase7, P retains Phase3 then Phase4, and root retains Phase9/integration. No extra worker is spawned and the one-heavy-slot rule remains.

Further dependency review confirms that the human binding and delivery front uses the existing WhatsApp/support/session modules and the T4 schema/T9 base; it does not depend on professional availability T25. T48 therefore depends on T9. To keep four fronts advancing, M begins the whole Phase7 T48-T55 batch after incorporating the committed root base. Its original booking drafts are hash-preserved outside fingerprints and will be handed to P for Phase4 afterT25. C retains company forms/list and later UI; Root retains RAG. Booking admission still waits for the original green T16+T25 barrier. All per-task gates, atomic commits, final coexistence proofs and local-only scope remain unchanged. No dependency is waived for a business operation.

While M awaits the original booking barrier, root assigns it only the isolated controlled ServiceNamesField and unit preparation for user-directed T97. Drafts stay outside M's application fingerprint and do not complete T97. C remains the owner of T96/T97 integration, hook/API wiring, browser, screenshots, gates and atomic commits. Booking drafts remain intact. This shares preparation without spawning duplicate workers or weakening task dependencies.

The renewed user instruction, "prossiga de onde parou spawnar subagentes para acelerar", keeps all three workers active. Root begins the independent RAG front T63-T71 in N instead of waiting for Conversations UI T62. T63 depends on integrated company writes T13 and professionals T18. T65 additionally waits T25 so reconciliation covers the completed professional/availability writers. Human handoff T48 depends on the Phase3 base T25, not the unrelated buyer screen T47. These are technical ordering changes; product scope and all95 atomic tasks,71 criteria, real gates and final independent verification remain.

C and P retain their current assignments. M retains booking preparation/gates after integrated green Phases2/3. After P/T25, root may assign Phase7/8 to P. Future Atendimento UI can be prepared by C after Phase2, but its gates wait for its RAG evaluation and actual booking endpoints. Only explicitly dispatched work is active; future assignments here are not completion claims. Root coordinates shared files, integration and the single heavy slot.

- Resource orchestration adopted 2026-11-16 by root after code review, independent peer inspection, real owned-Job probe and eight isolated guard oracles: P28 may use the exact pinned supervisor CA393E556AFED0888B59621CBD2A6CCCD27A47BD5027410EAC7328EFA2F4E5F8 for the unchanged full official API build, default heap and coverage. Initial available commitment >=3072MiB; live reserve >=1536MiB sampled every300ms, actual gap <=500ms including resume/terminal/final boundaries. Any breach, identity/monitor failure or forced termination refuses the build and cannot attest green. Only the newly created confined process Job may be terminated. The exact conhost path is GetSystemDirectoryW()/conhost.exe under the same membership/parent/lifetime checks. This replaces only our earlier static5168MiB compiler launcher admission for this supervised path; old refusals stay recorded. Native AppModule2048MiB and PG-only1024MiB remain. Build mode cannot record an attestation; finalization is a separate root-reviewed step. No SUT/test/compiler/transaction deadline, heap, OS, foreign process or global Docker changes.

- Monitored process-inspection correction reviewed/adopted: supervisor73C8EB1A061659DD1625EB05B863ECB1014BA996523F2E24839B1C800CB51281 replaces CA393 only by an observation-race fix and explicit close of unretained handles. A failed process inspection is ignored only after same retained HANDLE/PID, signaledWait0, fresh absence from our Job and exitCode!=259 prove it has already exited; active/unknown/error still refuses. All live identity/parent/creation and memory guards remain. Prior053115 remains infrastructurefailure/noattestation; its specific cause was not proven.
