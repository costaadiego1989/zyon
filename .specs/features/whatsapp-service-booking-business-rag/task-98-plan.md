# T98 implementation checkpoint

Owner: C (`feat/service-company-ui-20261114`). Local implementation only.

## Base and preservation

- Committed root base: `b5adc21f32f59eef1eb3d97c32ad960dfa477efe`.
- Local merge: `2ea6cf0f7`; only STATE conflicted and both handoff histories were retained.
- API sources, Prisma schema, packages, lockfile and frontend sources matched that committed base before T98 edits. Dirty root T69 files were not copied.
- Four prior metadata files and eight cache-manifest hashes were preserved in `C:/tmp/zyon-service-company-t98-preservation-20261116/manifest.json`; the cache hashes remain unchanged.
- Only CAT-01/02, T98, C73/74 and dependencies 17→98→95 were composed from the validated root addendum. Local specification and tasks validators both returned zero errors (existing T4 warning retained).

## Assumptions settled before source edits

1. `/merchants/me.businessMode` is authoritative for presentation. A missing/invalid mode or `businessModeSelectionState=review_required` cannot enable creation. Legacy `products` remains supported; role/plan are separate and no new permission is inferred here.
2. Products expose physical/digital/food. Services use `service` on the first render and on reset, with clear service entry/title/save labels. No selector offers a forbidden alternative.
3. Loading an existing item preserves its stored type and content. A record incompatible with the current mode remains visible but cannot be silently converted or saved through the new form.
4. Merchant/mode/item context changes mount a fresh editor, so a draft, created ID, variant/media state or pending promotion cannot leak into the next context. An old save completion cannot redirect or update the new editor.
5. The existing API guard remains the final authority when a profile becomes stale. No API/source, product purchase, financial, schedule or history behavior changes in T98.
6. The existing ProductForm/fields, PageHeader/Button and product design register are reused. No layout redesign, skill setup or optional skill update is needed; the user previously declined the update.

## Intended files

- `apps/dashboard/src/api/types.ts`: type the existing optional profile selection state.
- `apps/dashboard/src/pages/product-detail/utils/catalog-business-mode.ts`: small shared presentation resolver/type compatibility helper.
- `apps/dashboard/src/pages/product-detail/components/ProductForm.tsx`: mode-appropriate type controls and preserved historical type feedback.
- `apps/dashboard/src/pages/product-detail/hooks/useProductForm.ts`: initial-type-aware reset.
- `apps/dashboard/src/pages/product-detail/hooks/useProductDetailPage.ts`: mode default and save guard, preserve loaded type, stop stale editor continuations.
- `apps/dashboard/src/pages/product-detail/ProductDetailPage.tsx`: keyed context and service labels.
- `apps/dashboard/src/pages/catalog-page.tsx`: entry/title/empty-state labels and unavailable-mode feedback.
- `apps/dashboard/src/pages/product-detail/product-detail.css`: three desktop columns for the three supported product options; existing mobile breakpoint retained.
- New criterion/component/hook/page tests and `apps/dashboard/e2e/service-catalog-business-mode.spec.ts`, plus the existing browser test allowlist if required.
- This plan, T98 evidence, own STATE handoff and CAT/T98 metadata.

## Tests derived before implementation

- CAT-01: rendered products controls are exactly Físico/Digital/Alimentação; gestures update only those types, unknown/review modes offer no creation, and historical service data remains unchanged/read-only rather than converted.
- CAT-02: services begin and reset to `service`; a loaded physical/digital/food item retains its type; the real page/hook sends `service`, blocks incompatible/unknown types and resets all editor state on merchant/mode context changes.
- Existing product-detail, product validation and service schedule tests run unchanged and without name filters. New page tests prove payload and stale asynchronous completion behavior, not only setter calls.
- Real local browser: synthetic products and services merchants use the actual identity/API/DB. Click entry, inspect type controls, fill and save, assert the outgoing payload and persisted type, reopen a clean form, and exercise current-mode guards. Capture products/services at desktop and mobile; label captures local.

## Gate and resource boundary

No unit, typecheck, build or browser execution until root grants the resource window. Writing source and test drafts is currently authorized. Do not mark T98 complete or commit its implementation before the full gate passes.

The approved unit gate runs the two named new CAT files plus the three unchanged legacy files. A necessary additional actual page/hook companion will be added to that same unfiltered file selection and recorded before the first run. Use one worker if required by the existing local resource convention; no skips or relaxed assertions.

Then run dashboard typecheck, affected-file lint, the existing checked dashboard build and the new Playwright file through `playwright.service-local.config.ts`. Add only the new file to its explicit testMatch. Resolve the required committed API base/artifact and owned local runtime with root before browser; never reuse historical artifact96 against changed source or copy root dirty69.

### Concrete adaptations recorded before the first run

- Add `src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx` to the approved unfiltered Vitest file selection. Its ten cases exercise the actual editor plus the hook, create payloads, loaded history, unavailable/review/invalid modes, context reset and an old asynchronous completion. Together with five CAT-01 component cases and four CAT-02 form cases this is 19 new cases, all still unexecuted at this checkpoint.
- Add only `service-catalog-business-mode.spec.ts` to Playwright's explicit `testMatch`; two roots cover CAT-01 and CAT-02 without name filtering. Existing timeout/retry/ownership/cleanup/provider guards stay unchanged.
- Add a closed synthetic fixture installer at `apps/dashboard/e2e/service-catalog-fixture.mjs`, wired in the existing local setup. It registers each merchant through the real API with the required business mode and marks only synthetic local onboarding metadata. It provides no API/auth/repository override. Products are created through the real page and retrieved through the actual API; negative/stale-mode requests retain the existing 409 guard.
- The service browser case deactivates its own offer, changes mode through the real guarded API, asserts the old page cannot create service, then explicitly reloads the real profile before checking the preserved historical service and the new product form. These are local UI/API/DB proofs, not provider or production evidence.

### Frontend execution adaptation, before execution

The combined C API input digest is `5d6dda5df0edbf59bfe0ae194082bac783fbfc938c475e375de65a2ab6e3b1cc`; M53 and P29 outputs do not match it, so neither is copied or relabeled. The API full checked build remains necessary before browser unless an exact certified artifact is found. The API compiler's existing resource admission remains unchanged.

Only `packages/shared-types` sources changed since C's old phase2 outputs. Run its existing `pnpm --filter @zyon/shared-types build` locally before dashboard types/build; this is a fresh package compilation and is not a claim of an API build. Dashboard has no lint script or frontend ESLint configuration. For affected TS/TSX files, the ignored local runner uses the existing API ESLint parser and unchanged seven safety rules with a file-selection glob extended to those actual TS/TSX paths. No dashboard package script, lint rules or production config is introduced. It reports every selected file and requires zero ignored warnings/errors. New browser installer MJS syntax is checked separately. This adaptation preserves the required affected-file lint instead of counting ignored files as lint success.

Initial typecheck found one missing required `isActive:true` field in the new synthetic variant fixture (TS2741). The field was added without changing any scenario or assertion. Initial affected-file lint found the unchanged ProductDetailPage comment naming `react-hooks/exhaustive-deps`, a plugin absent from the repository's only existing ESLint config. The local lint invocation therefore disallows inline config while applying all seven existing safety rules to the 14 actual TS/TSX/MJS files. No comment/source or rule is removed, and inline directives cannot disable those safety rules. Both initial failures remain in the logs; they are not passes.

### Resource checkpoint 2026-11-16 13:34 UTC

The first full unit selection passed55/55 (19new+36unchanged,0skips), own shared-types build passed, and affected-file lint passed14files/0errors/0warnings. Dashboard typecheck is pending after the corrected new fixture. Two real compiler admissions refused before creating a compiler:422MiB at13:29:44Z, then4404MiB at13:34:45Z against the unchanged5168MiB threshold. The second was the single renewed admission authorized after the unrelated large Node processes disappeared naturally. No process was killed by C. The sole execution slot was returned immediately after each refusal.

No dashboard build, API capture/build/Prisma generation, browser, DB/container or screenshots ran. T98 remains incomplete and has no implementation commit. Details and exact logs are in `task-98-evidence.json`. The API launcher prepared in ignored cache uses the normal capture→official eight-package/API checked build with own Prisma→record-exit0→integral assertion; it has not executed. No incompatible donor output was copied. Future gates require a new root execution window; preserve both ENV refusals and the TS2741/lint diagnostics.

### Renewed independent execution 2026-11-16 14:20 UTC

Root granted a new sole window after its69 cold-graph diagnostic;69 remains uncommitted, so no donor artifact/source is used. Fresh existing admission passed6675MiBcommit≥5168. The actual C API capture covered2542 sources, official eight-package build/ownPrisma6.19.3/Nest exited0, standard recording and integral assertion passed (`.cache/t98-execution/api-2026-11-16T14-20-06.989Z`). This is a new ownC build, distinct from all proposed69 reuse.

Before the **first** browser execution, source inspection found the existing wrapped Name/PrefixInput labels include validation/prefix text in their accessible names. The new browser locators now match the anchored Name/Price/Weight label prefix rather than incorrectly requiring the bare label as the entire accessible name. Every gesture, payload/status/persistence assertion remains intact; no application label, assertion, timeout or existing test is changed. API build inputs remain unchanged by that browser-draft locator correction.

The first actual browser run passedCAT-01 and failedCAT-02 at the new exact Modalidade locator, before saving the service. Its DOM snapshot shows the existing wrapped select accessible name includes all option text. Only that new locator is changed to the anchored label prefix; all business assertions and10s action budget remain intact. Existing teardown returned without an error. Full first-run output/trace/error context and both initial product screenshots were copied to `.cache/t98-execution/browser-2026-11-16T14-31-24.274Z/preserved` before Playwright can clear its output directory.

Root reviewed the product captures and requested the desktop type choices be visible together. Inspection showed input-focus scrolling plus the existing sticky page header clipped them; no productive layout regression or CSS change was identified. The capture helper now scrolls the actual editor ancestors/window to top at the unchanged1440×1000 desktop and390×844 mobile viewports, and asserts the title plus all three product labels are fully in the viewport before capture. No application layout/style is edited. Browser-only rerun uses the same checkedAPI and unchanged UI source/typecheck/build; affected browser-file lint is repeated. The existing optional JSON Playwright reporter records this rerun, without changing assertions/retries/budgets.

## Local closure

Final gates:55/55 unfiltered units(19new+36unchanged,0skips); dashboardtypecheck0; affected-file lint14files/0errors/0warnings; officialdashboardbuild0; own full checkedAPIbuild2542/input5d6dda5d/artifact2bcd67b5; ownPrisma6.19.3; realbrowser2/2/0skip and CLI/globalteardown0. Post-browser integral artifact assertion returned the same exact hashes. Source was frozen throughout productive builds/browser; only the new browser locator/capture helper was corrected between actual runs. No old assertion was changed, removed, filtered or skipped. The first unit55, TS2741 fixture typing diagnostic, first lint failure, ENV422/4404 and first browser1pass/1locator-fail remain recorded.

C74's technical Proof selector now includes both the4 form cases and the10 actual page/hook cases, without a name filter. This selects the already-green full gate's actual header/payload/history tests and avoids claiming the small form-hook default test alone proves production wiring. No final proof script was run here.

Four primary local captures are listed with exact SHAs in `task-98-evidence.json`. Product desktop and service desktop/mobile come from final successful run14:38:19Z. The clear product mobile is explicitly preserved from the first successfulCAT-01 run14:31:24Z, SHA04081f748e9551605b51a72c50548a1c764e3012e30632a95d03d6e5993a1306. All8 productive UI file SHAs and API2bcd match across those runs. The new top-scrolled mobile whose annotation covers its last label is retained separately as cropped diagnostic evidence. Root viewed legibility and shared local captures; the user has not approved this UI, and final sameHEAD screen review remains later. No capture was fabricated or silently relabeled as a retake.

Test self-check: new tests assert rendered allowed choices, defaults/reset/data preservation, actual page payload and stale completion/forbidden save outcomes. The actual API/browser proves persistence and real409 guards, not just mocks. Every case traces to CAT-01/02 or their listed unknown/context/history edges; all old cohorts remain intact. The Proof selectors select their intended cases. Local source changes are confined to the approved frontend surface, required typing/entry/default wiring, owned browser fixture and evidence.

All C runtime/compiler children and owned resources have closed, with the original ACK/natural-exit/provider0/bridge/disposal guards intact; slot returned to root before documentation/commit. No remote/provider/production action, final feature verifier or global proof run. Root-owned69/99–104 and frozen Phase8 remain separate.

Future scoped integration note from root: T78/T81 must reconcile the reused legacy per-offer "Horários do serviço" editor with canonical professional availability, keeping duration/modality and avoiding a second per-variant availability authority. This was observed in the real service capture and is not changed in T98.

Completion requires observed green counts/cleanup, reviewed real desktop/mobile captures for both modes, preserved API guard/purchase behavior, updated T98/CAT status before the atomic local commit, and no claimed provider/production proof. No final global verifier is run by this helper.
