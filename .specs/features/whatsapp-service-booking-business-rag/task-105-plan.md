# T105 implementation plan

Source-only dispatch: Root registered Phase16 T105/T106 before authorizing this worker. User feedback2026-11-16: "está sim mas trar checkbox por toggle e poder vincular um profissional a um serviço se ja nao tiver". CAT03/C79 governs105; CAT04/C80 and106 remain cache-only until105 gate and atomic commit. No runner/import/build/browser/container before the separate execution window.

## Assumptions

- Replace actual catalog preference checkboxes with existing ToggleSwitch. Values, defaults, validation, persisted payloads and disabled behavior remain identical. Item selection controls remain selections.
- Actual service schedule preference is `serviceSchedule !== undefined` in ServiceScheduleEditor, not an invented requiresSlot property or ServiceFields component. Later T78/T81 canonical-professional availability work remains separate.
- Banner add-current-product is a real preference in ProductBlockEditor, so include its checkbox. Keep its ctaAction/linkUrl transformations and block payload intact. Existing variant/publication switches and visibility icon actions need no redesign.
- Reuse the installed impeccable3.7.1 product register/current tokens, with real label/id, name/state, comfortable labelled row and scoped focus-visible styling. No global ToggleSwitch redesign or update/setup.

## Base and preservation

Local merge afd867ca5812aaa7f39bf2ec573dcec314d2a01f incorporates only committed Root f09c217e68991309a2c66378f1410624bc4548ad into C98 4ddb706d1. Only STATE/spec/tasks conflicted. Complete old C blobs+hashes are in `.cache/t105-t106-preparation/before-root-alignment/manifest.json`; canonical formal Root records plus a C preservation checkpoint were retained. API/packages/lock source diff versus f09 is empty. Schema SHA f6c794aa356623e5f4ada2e41a2969d2183c26bd9a1df7c78add4199f99c18a9 and lock77375bd8c270c482e32d760dd0b49a254bd4d11cf740a297074febf549fe934f match Root. No dependencies/Prisma client/build outputs or dirty70 copied. C98 artifacts are historical until current integral validation, not relabelled.

## Files to touch

Productive:

- `apps/dashboard/src/pages/product-detail/components/ProductForm.tsx`: Active and food Required switches.
- `apps/dashboard/src/pages/product-detail/components/ServiceScheduleEditor.tsx`: schedule preference switch.
- `apps/dashboard/src/pages/product-detail/components/ProductBlockEditor.tsx`: banner add-current-product preference only.
- `apps/dashboard/src/pages/product-detail/product-detail.css`: scoped switch row/focus/reduced-motion rules.

Tests and fixture configuration:

- new `apps/dashboard/src/pages/product-detail/components/ProductForm.toggles.spec.tsx`: actual controlled gestures/state and full payload preservation, disabled states, food group identity and banner payload.
- existing `ProductBlockEditor.spec.tsx`: only necessary handler-source spelling change e.target.checked→checked; keep every assertion, enum expectation and test count.
- new `apps/dashboard/e2e/service-catalog-toggles.spec.ts`: real local pointer/keyboard/save/reopen/API persistence and desktop/mobile captures.
- `apps/dashboard/playwright.service-local.config.ts`: add this exact file to the existing allowlisted testMatch; no deadline/retry/resource changes.
- owned ignored execution launcher only if exact existing runner retargeting is needed, with before/after SHAs and source frozen during capture.

Metadata: this plan, actual evidence after gates, T105-only status/check pointers and own STATE checkpoint. No106 productive source.

## Success criteria and gate

Create criteria-derived new tests before the minimum productive delta; they are unexecuted preparation until the window. Pointer/real keyboard switches expose exact labels/checked state and disable correctly. Active persists true/false; schedule toggle preserves its old undefined/default/removal representation and other metadata; food required preserves all groups/prices and original minSelections rule; banner switch preserves ctaAction/linkUrl behavior without changing other props. No switch submits the enclosing form.

Run formal105's complete unfiltered component cohort plus unchanged ProductBlockEditor.spec.tsx; add any concrete new companion before execution. Dashboard typecheck, existing affected-file lint, official `node scripts/service-local-build.mjs dashboard`, and actual protected Playwright file. Preserve every prior assertion except directly authorized control role/gesture or callback-source spelling. No skips/zero-match, resource/deadline/API artifact shortcuts or provider actions. Gate green precedes marking105 and its own atomic commit;106 starts productive code only afterward. Counts, diagnostics, actual receipts and local capture provenance will be recorded, not predicted.

## Current status

Technical proof alignment before browser: C79's old `--grep "CAT-03$"` selected none of the two actual prefix-labelled titles. It now uses `--grep "^CAT-03"`, selecting both unchanged cases. The whole-file gate remains unfiltered, with all assertions preserved. C80's future selector will be checked against its actual106 titles when that task enters; no106 source yet.

Source prepared: four productive files, ten new controlled component cases and two new real-browser cases. Existing ProductBlockEditor source-string assertion changes only the event callback's boolean spelling; its enum/undefined expectation remains. Browser file uses the existing owned catalog fixture, real login/API and saved/reopened state, including actual Tab/Space focus. Configuration adds that exact file to testMatch without changing any guard/deadline/retry. Banner behavior is covered by the new full-block component payload/readonly cases and its unchanged old cohort; no banner HTTP/browser claim is made by those cases.

Execution checkpoint2026-11-16: full78/78unit (55old+13BlockEditor+10new), dashboardtypes0, lint7/0/0 and officialdashboardbuild0 passed. Fresh OWN official API build covered2543sources, generated ownPrisma6.19.3 and passed integral fa8c/1d61; no imported artifacts. All four productive UI files are unchanged since these gates.

Browser attempts remain incomplete: first1pass/1fail from early catalog click; second0pass/2fail from a new helper URL predicate excluding querystrings; third1pass/1fail from exact2RAF y drift0.03125px; fourth0tests from native Redis proof setup failure, not a UI assertion. The predicate now matches exact owned origin/path/status=all/limit20/offset0; capture centers, uses the native stable wait, preserves exact2RAF equality and control/label hit-tests. No timeout/rounding/skip or business oracle changed. First three runtime closures enforced ACK/provider0/naturalexit0; fourth setup cleanup returned without aggregate and read-only inspection showed zero C Nodes/owned harness containers, without an app-ready/ACK-success claim. Logs/reports/traces and diagnostic images are preserved under `.cache/t105-execution`; exact receipts are in task-105-evidence.json.

Fourth cause: `nest-construction-only.guards.mjs:109–111` captures native peers through `Get-NetTCPConnection -OwningProcess <ownPID> -State Established`, with the existing10000ms execFile timeout. It was killed with SIGTERM; the54clients/17queues/17workers remained ready, socket changedCount0. No fifth blind retry or harness/source patch was made. The sole window was returned to Root after confirming owned cleanup. T105 is NOT complete and has no atomic task commit. Root107metadata e4e5783dc waits for105green before source/merge;106remains cache-only; Phase8 awaits55. No provider/production/finalVerifier claim.

## Post108 checkpoint

Root's independent108 bda28419d was incorporated in merge de422833b after SHA-backing all16WIP files and88cache files. All14nonmetadata WIP hashes matched afterward. ProductiveAPI/packages/schema/lock remain identical to f09; integral ownAPI fa8c/1d61/2543 re-admitted without rebuilding or re-recording. Only three committed test-harness JS files and Root's formal107/108 metadata were incorporated; no dirty70API or mutable dependency/client/artifact sharing.

Fifth/sixth browser runs passed the actual Redis ownership setup and enforced ACK/provider0/naturalexit0/ownedcleanup. Both ended0pass/2fail on cold UI/fixture navigation. The sixth created/edited food and produced four actual product toggle captures, then a fullpage open reinitialized the app and eventually hit quota429. Source-only fix now uses the exact CatalogPage `Editar <name>` row action and a scoped real getProduct200/id before its unchanged heading/state assertions. Save awaits the actual catalog/statusall before reopen. Initial creation checks button visibility/enable and its real editor categories request. Every concurrent response promise is observed immediately with Promise.all, preserving10s/5s/60s budgets and all original payload/direct persistence/reopen assertions. No quota resets, sleeps, response stubs, tier changes or rounding were added.

The revised helper was unexecuted at that historical sixth-run checkpoint. Sixth cleanup inspection showed zero C Nodes/owned harness containers, and the window was handed to M9. `task-105-evidence.json` and `.cache/t105-execution/seventh-source-only-checkpoint.json` retain those six outcomes and source hashes.

## Seventh run and independent repair order

The unchanged source6264168b subsequently executed in `.cache/t105-execution/browser-2026-11-16T17-43-15.040Z`: two cases, two failures, natural CLI exit1 at17:47:09.595Z. Complete trace copies are retained under that run's trace-artifacts directory. Product catalog requests began only after a cold lazy module subtree completed, beyond the original10s response wait. The service toggle/duration succeeded but the normal Add schedule click could not finish its stable check; rendering-frame progress needs a bounded actual diagnosis. No moving-control, overlay or API cause is inferred from this trace. No eighth run has occurred.

Root recorded the technical dependency order107->105->106 before authorizing107source. The observed Starter advanced-rules403 already exists in the committed98editor, so its independent repair does not depend on105. Metadata5e168c03b was integrated as4f90aa2e7 after preserving21files in `.cache/t107-before-metadata-20261116T160510`; all19nonmetadata WIP hashes matched afterward. The four105productive controls and its browser source remain unchanged. T107 has its separate plan/evidence/tests and gate;105 remains open without a task commit. Root owns execution after107's typecheck preflight was refused4970<5168 and its affected lint passed; no build/browser was launched.

## After completed T107: bounded actual gesture diagnosis first

T107 completed independently in fbfa6d5a3 and is integrated in Root774c62d18, with all six native captures reviewed. T105 eight files were restored SHA-exact, including original browser6264168b; no eighth whole-file run has occurred. Root explicitly granted the sole window after M191natural0. Before any full105gate, run exactly one protected actual service gesture diagnosis from ignored cache, with unchanged2048admission, ownAPI fa8c/1d61 re-admission and existing native cleanup.

Files first: cache-only diagnose-service-actionability.spec.mjs, diagnostic.config.mts and an exact existing runner retarget under .cache/t105-post107-readiness-20261116. No productive105/107 edit. One actual synthetic service fixture/profile/login on the supported direct create-editor hash, then original service name/SKU/price/modality, Tab/ShiftTab/Space schedule gesture, duration45, normal Add schedule click and actual date/time fields. Record bounded timer/twoRAF progress plus exact button/control/associated-label rectangles and center hits before/after; no force, styling, rounding, prewarm, sleep or relaxed assertion/deadline. Diagnostic is not the whole catalog/sidebar/create acceptance gate and cannot close105. Preserve trace/timings/native cleanup and stop if admission or actual diagnosis fails.

After diagnosis, the separately reviewed supported#catalog and buffered pregesture request-start/response setup may enter only the NEW105browser helper with before/afterSHA, preserving every original sidebar/create, payload/read/reopen, keyboard/focus and exact capture oracle. The final78component/currenttypes/lint/officialbuild/whole2browser gate must run on combined committed107+105source before task mark/atomiccommit. Earlier105compilation predates productive d949 and cannot close that combined gate. T106 remains cache-only until105complete.


## Current actual diagnostic and combined contracts

The actual diagnostic failed before login/editor/normal Add schedule: original30s navigation/load exhausted on pending development app modules; nativecleanup passed. The after-failure document was visible/focused with timer0.7ms/twoRAF4.9ms but no service controls, so service-actionability remains unknown. OriginalcacheCJSconfig0case failure and its explicit.mts/static-discovery correction remain separate history. All original8T105files andd949 are unchanged; no eighthwhole2 or new105productive/testhelper change. Full causalpacket and source-only previewassessment are under .cache/t105-post107-readiness-20261116. BlankcurrentPNG/criticalpendingmodules do not support a DOMContentLoaded-only shortcut. Officialproductionpreview has real HTTPSscope/captcha constraints; no appflags/auth/API workaround is proposed.

Root then authorized a separate unit-only union: current93/93 across9files,0skip/fail,44.81s,natural0 at22:21:15.155Z; original10578 plus10715, all10sourcehashes exact and knownCnode/cmd0. Earlier78proof is historical; this93proof validates the combined current component contracts, not nativeCSS/gesture or105Full. SlotreturnedRoot; no currentcombinedtypes/build/browser/extraresourceprobe follows without explicit handover.

## Resumption after T77, 2026-11-17

Root reviewed source-only plan0f4f0c4a and candidate36382c7b, then explicitly handed C the sole execution window. Assumptions/files/success are recorded in .cache/t105-post107-readiness-20261116/RESUMPTION-20261117.md. The actual new source delta is ONLY the helper's supported initial catalog hash plus pregesture buffered start/response phases. Before18file backup and exact patchd0477637 are in .cache/t105-execution/resumption-20261117T083345Z; all original eight105files and six old native images were preserved before adoption. The complete body from basic onward, including both actual journeys, remains byte-identical. PromotionSection d949 is unchanged.

The first runtime is one bounded actual normal Add schedule diagnostic under2048 after integral ownAPI2543/fa8c/1d61 readmission. A refusal/failure stops the window with exact phase/trace/cleanup. Only an actually passing gesture permits continuation without another handover: whole93/ninefiles (78old+15entitlement), affected lint, current dashboard types/build5168, then original whole2Browser2048 and six real native captures/cleanup. Keep original guards, auth, Vite/captcha,5/10/30/60/600bounds; no prewarm, forced interaction, DOMContentLoaded shortcut or preview bypass. Root reviews readable actual captures before marking/commit; this is author work, not final independent verification or user visual approval.

M55's exact return-undefined fixture source eae24bd4 is adopted only as source in C, backup/receipt .cache/t55-shared-fixture-type-adoption. Keep that one old74test file outside105's commit until55alignment. No API/dependency/generated-client/output was copied. T106 remains cache-only and T78 follows105then106, preserving current service schedule authority throughout105.

## Actual first current gate and mechanical fixture types

The current bounded service diagnosis passed1/1 natural0 at08:36:05.122Z, with actual normal Add schedule and date/time fields; normal owned nativecleanup. This proves the current gesture only, not the historical cause. Whole93/ninefiles passed13.11s with0fail/skip; lint7passed0. Current dashboard types admitted8931>=5168 then returned2 at08:37:29.518Z: ProfessionalsPanel.spec131 inferred void for the GET branch, and old74spec118 declared Promise<void> for the existing refresh77 Promise<boolean>. No build/whole2 followed. Exact logs and frozen19proof are in .cache/t105-execution/resumption-20261117T083345Z/partial-gate-receipt.json; knownCnode/cmd0 and slot returned.

Root then reviewed and authorized ONLY patchd4548030, before a new sole C window: return undefined after the same fixture throw and Promise<boolean> on the pending refresh variable. All assertions/expected results remain exact. Before/candidate SHAs and full backups are in .cache/t105-current-type-fixture-review. The old74 eae/804 sources and the ProfessionalsPanel test correction stay outside105's focused commit; API/product source unchanged.

New execution dispatch: whole unfiltered46 relevant fixture contracts (23+23), current types5168, official dashboard build5168 and original whole2Browser2048 with ownAPI2543/fa8c/1d61 readmission. Reuse current93/lint7 because none of their inputs changed; all original budgets/guards/status/payload/reopen/geometry remain. Stop on first failure/refusal and return the slot with evidence; no automatic retry.

## Actual current build and encoding-only browser repair

The two mechanical fixture corrections passed their whole46/2files (4.17s), current dashboard types0 at08:43:38.206Z and official dashboard build0 at08:44:02.007Z. Prior93/nine and lint7 remain exact. OwnAPI2543/fa8c/1d61 re-admitted0 before the complete two-case browser. Browser0/2 ended natural1 at08:45:38.574Z with normal ACK/disconnected cleanup and knownCnode/cmd0. Both cases had actual login/bootstrap/catalog/category success but the helper stopped before creating a product: its new navigation name had corrupt encoding.

The original6264 name and both actual DOM snapshots are exactly the same M\u00f3dulos name, while helper3638 used the wrong decoded literal. Three strings in that newly prepared helper were affected: navigation, service create-button, new-service heading. The old complete body from basic onward and both business journeys remain byte-exact. This is a helper-authoring defect, not a SUT behavior defect or a new Add schedule failure. Failure ZIP/PNG/context and sanitized cause packet are preserved in browser-2026-11-17T08-44-37.759Z/failure-artifacts plus causal-encoding-packet.json.

Root reviewed patch334d16e4 and manifestf779dfd9, then authorized ONLY restoring those three original6264/actualDOM literals, before source adoption. Backup/reversal/hashes are in .cache/t105-helper-encoding-review. No semantic selector, exact, expected status, payload, assertion, timing, viewport or gesture changes. Root currently owns the combined checked API runner; no C lint/discovery/browser is authorized until handover. After handover, affected lint/list/whole2Browser only, with original guards and fresh ownAPI readmission. Reuse93/46/types/build because only helperE2E and plan metadata changed outside tsc/build inputs.

## Current Full complete before focused atomic commit

Actual final source17dec26c passed original whole2Browser at2026-11-17T08:57:28.376Z:2/2,0skip/flaky/unexpected,38.296s; natural0, normal before_closed_ack/disconnected and timers[], exact-ownedCnode/cmd0 at08:58:17Z. Current affected lint7zero/list2zero and integral ownAPI2543/fa8c/1d61 readmission0 preceded this run. Current93/nine (78old+15entitlement),46/two pertinent type-fixture contracts, dashboard types0 and official dashboard build0 remain valid; the only later change was helperE2E encoding outside tsc/build inputs. All23frozen inputs were SHA-exact before completion metadata.

All six current frames were generated within the final run at actual1440x1000/390x844, archived under its native-captures with SHA/mtime manifest. Root opened all6 and accepted accessible target toggles/labels/focus and absence of target obstruction/horizontal overflow. This technical review is105only, not user approval, final independent verification, sidebar82 or association106. Active-off frame shows the actual gesture state; its subsequent save/direct read/reopen all passed. Required and schedule states were reopened after creation. No image editing or postprocessing.

Before marking: new controlled toggle contracts assert resulting values/payload, pointer/keyboard/disabled behavior and form non-submission. Native cases preserve actual mode/type, SKU/prices/groups/minimums/modality and schedule serialization/removal, real direct reads and reopen. Every old assertion remains; only the user-requested control handler spelling and explicitly reviewed fixture declarations changed. No skip/delete/weakening, extra backend writer, quota/plan reset, forced click, prewarm or auth bypass. Canonical C79 proof selects both CAT-03cases. Original failure history and raw ignored diagnostic traces remain.

Task105 is marked before the focused20path commit:10code/test/infra,6PNG,4metadata. Root now authorizes including the two mechanical type-fixture support files. Root55 already contains old74eae(returnundefined); Root adoption must add only the new Promise<boolean> delta beyond eae to reach804. C also carries ProfessionalsPanel returnundefined682. Both keep throw/assertions exact. No71/API/package/schema/lock changes. T106 remains ignored source preparation; productive adoption awaits105commit and the next explicit handover, followed byT78.
