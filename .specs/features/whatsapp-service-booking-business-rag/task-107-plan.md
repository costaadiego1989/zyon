# T107 implementation plan

The existing Starter editor requests Growth-only advanced rules and shows a false error. T107 gates this existing request with the same advancedRules boolean that already gates its controls. Basic promotions and the API permission remain unchanged. Root recorded the independent technical order T107 -> T105 -> T106 before authorizing this source work.

## Assumptions

- The current hasFeature("advancedRules") result is the existing feature policy. Unknown/no-feature means false. No role, billing, price or API policy is added.
- Merchant/product context changes and feature loss invalidate in-flight advanced reads and mutations; stale responses must not change the new screen or start a recovery GET.
- T105 WIP stays byte-for-byte preserved. T107's commit must run independently without importing or selecting its uncommitted tests.
- Source and mock contracts can be prepared now. All execution, imports, typecheck, lint, build and actual browser operations wait for Root's explicit sole-window handover.

## Files

- Productive: `apps/dashboard/src/pages/product-detail/components/PromotionSection.tsx` only.
- New independent component proof: `apps/dashboard/src/pages/product-detail/components/PromotionSection.entitlement.spec.tsx`.
- New actual browser proof: `apps/dashboard/e2e/service-catalog-entitlements.spec.ts`.
- New own synthetic fixture: `apps/dashboard/e2e/service-catalog-entitlement-fixture.mjs`.
- Minimal composition only: `apps/dashboard/e2e/service-local-setup.mjs`, `apps/dashboard/playwright.service-local.config.ts`.
- This plan, T107 evidence and task/spec completion metadata after the real gate. Cache-only execution helpers and receipts remain outside the task commit.

## Implementation

Compute the feature boolean once. Use it in the existing rules-read effect and current rendered lock. Reset advanced-only rules/editor state when merchant, product or the boolean changes; retain the effect's cancelled check. Guard pending advanced configuration and advanced persistence/recovery against lost permission and changed context. Preserve basic promotion load, save, toggle and delete behavior.

New fixtures declare Starter or Growth before login and prove the returned real billing feature. Never upgrade an existing non-entitled test company to conceal its error. Product/service offers use the real catalog API and own database. Fixtures cannot replace catalog/auth/advanced-rules responses.

## Component cases

1. Starter and unresolved/no-feature do not request advanced rules, show the existing Growth lock when promotion is expanded, and still save a basic promotion with the exact unchanged payload.
2. Enabled saved product loads the same rules and performs a real rules control gesture with the same persistence payload.
3. False -> true begins the permitted load once; true -> false removes advanced controls, clears old editor/rules and lifts no pending advanced payload.
4. Delayed success and rejection after product or merchant change do not show old rules or a false error; current context can load its own rules.
5. Delayed success/rejection after permission loss do not enable promotion, show an unsupported error or start an extra request.
6. A failed in-flight rule save after context/permission change cannot issue its old recovery GET or apply stale state. Current supported failures retain their existing recovery behavior.

## Actual browser cases

- Starter product and service: open a saved offer through the real UI, prove billing advancedRules=false, perform basic promotion gesture/save, record zero UI advanced-rules requests and no false rules alert, reopen and directly read the unchanged persisted promotion. Direct authenticated unsupported advanced-rules GET still returns403.
- Growth product: prove billing advancedRules=true, observe the real advanced GET200, open the existing rule editor and save a supported rule using its genuine controls, verify the real payload and saved rules through API/DB, reopen and preserve the rule.
- Take readable actual desktop/mobile screenshots with local/synthetic provenance at native viewports; no resized image, masked toast, response stub, force click or deadline increase.

## Gate and commit

Use Root's reordered standalone T107 task gate: unchanged old55 component cohort plus new entitlement component file, dashboard typecheck, affected-file existing lint, official local dashboard build and the whole dedicated actual browser file. Preserve all current resource/ownership/teardown guards. Re-admit the unchanged own API artifact, not rebuild or share it. Zero skips/zero selected tests are required. Only after this full gate is green: mark T107 complete and create its atomic local commit, containing no T105 productive/test deltas. T105 and then T106 continue afterward.

## Independent replay after resource handover

Root's heavy compiler stopped before granting a new107window. Preserve the earlier5168MiB refusal, then allow one new unchanged admission attempt after this concrete environment change. Before replay, eight105/overlap files were SHA-backed under the path recorded in `.cache/t107-execution/parking-path.txt`. Only the four105productive files and its modified old BlockEditor assertion are temporarily restored to committed98base; its two uncommitted test files are safely parked inside own ignored cache. The107configuration lists only independently present tests. No105assertion is weakened or lost; restore its exact bytes after107gate/commit.

The standalone browser proof now observes actual request starts as well as responses. Starter must emit zero advanced-rules request starts, including requests that abort before a response. The three original cases, real gestures, payload/SQL/reopen/direct403 oracles and5s/10s/60s budgets remain. Productive107source is unchanged. Replay70components against this independent baseline, record six refreshed source hashes, then attempt types/build/lint and actual browser under the original guards. A resource refusal is partial evidence and cannot close107.

## Source-only repair after the first actual browser attempt

The original three cases all failed and cleanup raised AggregateError. The causal packet is `.cache/t107-execution/first-browser-causal-review.md`; all traces/screens and original oracles remain. No current case reproduced RAF starvation. Eight105files were restored SHA-exact and no task was committed.

Before any new execution, revise only the NEW fixture/helper and existing setup composition: prepare the three declared companies/products using the same actual register/SQL/catalog operations during bounded global setup, each actual HTTP operation still capped at10000ms. Await them before UI server readiness; the fixture POST then returns prepared coordinates. Add a declared empty AI governance policy before each real product creation, matching T65/T66's offline model precondition without changing advanced-rules billing. Record sanitized per-stage timing/status for future actual causal evidence; no past timing cause is inferred.

For the services trace, product/promotion waits preceded every such request; the observed main session billing/onboarding plus cold module loading consumed their interval. Attach onboarding/session observation before login, activate editor response waits at that actual lifecycle barrier, and observe every promise immediately. Keep every response200/login201, the separate10s bounds and case60s budget. The real existing `Promoções e regras do produto` summary must be clicked before visible controls, including after reopen. No force click, hidden DOM style or timeout extension.

Add sanitized cleanup error-code/number diagnostics before rethrowing the same existing AggregateError so a future missing ACK/provider gate remains visible. Do not change runtime close/assertion/ownership guards. Productive PromotionSection and all15component oracles stay unchanged. Hash before/after changes, then stop for Root's review and explicit execution handover; no automatic browser retry.

## Focused source review corrections before execution

The shared protected setup defaults to no entitlement preparation. New `playwright.service-entitlements-local.config.ts` inherits the existing configuration and overrides only testMatch and globalSetup. Thin `e2e/service-catalog-entitlements-setup.mjs` passes the static `{catalogEntitlements:true}` option; no argv parsing or internal Playwright state. Shared testMatch retains the previous tests, including the separate105WIP entry, without107. T107's formal Gate and C81 Proof use the dedicated configuration before execution. Affected107lint is the seven productive/test/config/wrapper files; shared config contains only its105delta and is excluded from107commit.

Cleanup diagnosis is capped at depth3, total6nodes,3codes per node of at most96characters; input is truncated before matching, error names are whitelisted, and a diagnostic error cannot replace the original rethrow. The offline AI policy uses an upsert to tolerate policy creation by registration without changing its declared empty grants. These are source-review corrections, not a claimed cause of the previous timeout or cleanup failure. Productive107hash d9497d24 and all component oracles are frozen. New source/checkpoints await review and explicit handover; no new app/native/browser run.

## Two fixture corrections after the corrected actual attempt

The resumed independent types, seven-file lint and official dashboard build passed. Actual browser still failed0/3, with native close/ACK/provider0/natural exit/owned teardown now passing. The second-browser-causal-review.md packet preserves exact response bodies and all failures.

Change only service-catalog-entitlement-fixture.mjs: rules snapshot fallback becomes []::jsonb to match the actual advanced_rules column and remove proven PostgreSQL42846. Global preparation makes the declared completed-checkout precondition true using the existing authenticated GET /checkout-settings200 under the same10000ms bound. Verify its own merchant/default empty rules and their persisted SQL row before product creation. Preserve all actual registration/catalog/promotion/rule writes and every case/status/payload/SQL/direct403/reopen assertion. No backend/CAS change or retry; the observed no-settings412 remains an existing separate edge, not repaired by this precondition.

Root accepted these two focused fixture fixes and one newly admitted browser gate. Record before/after hashes, syntax-check/lint the fixture, re-admit own API and run the same whole three cases once. Reuse unchanged d949/a1d4/committed98baseline70 proof plus types/build because only the e2e fixture changed outside their compilation inputs. Fresh SHA-park105for independent replay; all guards and deadlines stay unchanged. Root must receive the six actual acceptance captures after Full passes before marking/committing107.

## Source-only phase and genuine toast gestures after latest1/3

Root accepted the actual third-run causal packet before this edit and granted exactly one next whole-three execution. Change only the NEW service-catalog-entitlements.spec.ts. Keep response collectors before login/reload, add request-start collectors there too, await buffered-or-real exact editor request starts under existing10s after bootstrap, then existing10s responses. Same60s case bound, no new sleep/prewarm/forced style/retry. Assert exact success status at each real save, click its existing Fechar aviso button and assert notice removal before screenshots. Preserve viewport/full target/hit/overflow and every existing payload/API/SQL/Starter403/reload/request-start oracle. Keep d949 productive source/15component cases untouched. SHA back source, syntax-check and affected lint, reuse compilation proof only after identical-input check; fresh SHA-park105eightfiles, re-admit ownAPI and run one whole-three under unchanged2048. No further blind run after new failure.

Root accepted the exact camera-only move of the test-owned provenance caption bottom8 -> top8,left8 after inspecting actual overlap evidence. Caption remains visible; no pointer-events change, SUT styling, toast hiding or capture-oracle change. Refresh only syntax/lint/SHA and execute the already-authorized single next whole-three run with frozen source.
