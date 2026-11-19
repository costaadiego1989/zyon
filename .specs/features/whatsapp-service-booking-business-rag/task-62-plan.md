# T62 implementation plan

## Assumptions

- T61 is locally complete in ed126a774 with148 accepted cases. Root owns all runtime/resource probes; this task starts source-only. No test/import/parser/build/browser/install/probe or commit before a new dispatch.
- Conversations is available for products and services to actual OWNER/ADMIN/STAFF principals. Staff receives403 from private auth/profile/configuration endpoints; the existing three-field server context is its only bootstrap. No fake MerchantProfile, businessMode, plan or private grant. Existing configuration permissions remain OWNER/ADMIN.
- A URL selects a tab/ticket; it never supplies tenant, user or authority. One URL effect calls vm.open. Row clicks update the URL only. Current HTTP/socket/cursor/delivery/intent rules remain in hook60/drawer61.
- Owner/Admin keep the normal DashboardShell/bootstrap/subscription/onboarding and existing connection/templates/orders/usage behavior. Staff gets a narrow typed WhatsApp workspace, not the private Shell or an arbitrary route. Logout/session expiry invalidate the minimal context and old async resolutions.
- Read-only advisory .cache/t62-mount-reuse-root-20261119.md is a source reference, not a proof. Optional visual approval from61 remains unanswered, never inferred.

## Files to touch

- New pure conversation-navigation.ts and conversation-bootstrap.ts plus criterion-derived tests before implementation. Canonical route is #whatsapp-seller?tab=conversations&ticketId=<encoded opaque id>.
- New WhatsAppConversationsTab.tsx for current hook queue/loading/empty/error/cursor and shared drawer61; new WhatsAppStaffWorkspace.tsx for the typed limited authenticated host. Tests cover real gestures and denied configuration mounts.
- WhatsAppSellerPage.tsx separates owner configuration effects into the existing permitted child and adds the Conversations tab/URL navigation. main.tsx adds only denied-profile403 -> realStaffcontext fallback, stale-session invalidation and narrow host. Existing RouteGuard/PERMISSIONS/DashboardShell remain unchanged unless an actual composition proof requires a narrow wiring change.
- Existing whatsapp-seller.css for additive queue layout only, using current PageHeader/TabBar/Button/DataTable-or-existing list primitives and tokens. No new design system.
- Dedicated local Browser spec/setup/config for actual dashboard index/main route, reusing the owned T2/auth/API fixture and failure observer. Minimal explicit fixture readiness for actual owner bootstrap must use real registered records/roles and no auth/repository overrides. Preserve61 fixtures/defaults.
- Task62 plan/evidence/tasks/spec records only; preserve STATEe8ab, context, outputs, Root WIP and old containers UNKNOWN.

## Success criteria

- Staff can log in normally and reach the actual WhatsApp Conversations tab, including direct URL/refresh/back, while private profile/configuration calls stay403 and are not mounted as child effects. Crafted owner tabs/otherShell routes do not open private UI. Owner/Admin tabs and current product behavior remain functional.
- Selecting a row changes only the URL; a single route-to-selection effect reads canonical detail. Closing removes ticketId, and back/refresh restores selection without duplicate detail fetch caused by both click and effect. URL tenant/user fields cannot replace the authenticated context.
- Auth/tenant/session changes clear context, queue and selected history; late old responses cannot restore them. No ID derived from MerchantProfile.id is used as operator identity.
- Real queue/claim/send/close and truthful delivery/IA-return render through61, with loading/empty/error/offline and page cursors distinct. Keyboard and focus remain in existing primitives.
- Whole new/affected UI and preservation tests, normal dashboard type/lint/build headers, own API admission and dedicated actual-app Browser must pass under original guards before marking62. Final feature proofs/Verifier remain Root responsibility.

## Tests first and verification inventory

Write pure route/bootstrap tests first, then actual component/SDK gesture tests before mounting source. Initial static tests will not be described as RED until a real admitted run. The source for WhatsAppSellerPage.spec.tsx named by the original placeholder gate does not exist; bind the eventual gate to real wholefiles instead of an empty name filter.

Preserve all current134 and fixture11 source/oracles. Next affected UI gate will include current134 plus all new route/bootstrap/tab/session tests as wholefiles; exact counts/pins will be inventoried after tests exist. Do not use a filtered or skipped test root.

Browser must serve the actual index/main and use real local login cookies. Cover Staff minimal context/private403, forged owner tab, deep link/refresh/back, queue operation/unknown intent and logout/session expiry; Owner/Admin normal bootstrap and configuration tabs in products/services; foreign ticket denial without exposing its history. Capture real desktop1440x1000/mobile390x844 tab and error states without resizing. No response stubs, production access or real Meta provider. A61 development-only mounted drawer is not a62 app-route proof.

Original guards remain1024 for UI/pure/admission,2048 for Browser,5168 for compiler/type/build children, with existing heap/timeouts/workers/retries and first failure/refusal stop. Root currently has resource refusals; no margin is assumed and no new attempt is made in this source window. Own API1668/ed20 stays current for frontend/MJS-only edits; any later committed backend integration requires its own genuine current build before Browser. No output/client/stamp copy.

## Initial gate and composition source checkpoint

Initial pure13 passed13/13 in two wholefiles naturally0, fresh7827 over1024, with unchanged pins. Runtime returned immediately; no Browser/API/build ran. These13 remain unchanged and can retain their scoped receipt. Then seven actual Tab/SDK tests, five actual App state-machine login/logout/expiry/late-response tests and four Owner/Admin mount/legacy-tab gesture tests were written before their productive code. All16 are source-only and unexecuted. Their transport/entry/private-shell mocks are component boundaries, never actual auth or full-app Browser proof.

Source now has a shared queue tab, narrow Staff host, canonical URL hook and an optional drawer close callback that defaults to old61 behavior. Owner configuration effects live in the existing permitted child, mounted only when a configuration tab is selected. Main denied-profile403 consults only the real minimal Staff context; generation fences invalidate pending responses on logout/session expiry/new login and guard profile/settings/billing/onboarding commits. No fake profile or changes to Shell/RouteGuard/PERMISSIONS.

Pending scope: new16/3wholefiles first, then affected134 preservation and standard dashboard headers as required, retaining unchanged13 honestly. Combined unique UI inventory is163 across24files, not a claimed execution. Browser actual index/main route, session/role/deep-link/back and screenshots are still source pending. Next gate waits for Root to return the active API36 runtime window. No compiler/browser/probe ran in this source checkpoint.

## First composition gate scope

Pending whole41/8files selects new16 plus the directly affected drawer/draft19 and Main/subscription/private-role wiring6. It retains initial13 and the other unchanged old134 scopes rather than blindly replaying every test. Exact reasons, paths and pins are in composition41-gate-selection.json. This is a partial composition gate; it cannot replace dashboard headers or the actual main-route Browser. No execution until Root handover.

## First actual composition result

Whole41/8files passed41/41 naturally0 with0skips/fail/todo and exact source pins, raw0232b656. This includes all16new composition cases plus19drawer/draft and6private-role/subscription preservation cases. Combined with unchanged initial13,54 scoped cases are accepted. No Browser/header/full62 completion claim. Runtime was returned immediately before metadata. Browser now proceeds only in source while Root executes its own integrations.

## Header attempt and real-main Browser source

Header window admitted only integral own API check and confirmed1668/ed20/2585. Dashboard typecheck was refused3922<5168 before its child; standard dashboard build did not start. No build env/secret/network action was consumed. Runtime returned immediately, no retry. The first unstarted header remains normal dashboard typecheck. Public-auth local compile configuration is recorded for the existing standard validator; dashboard has no lint script/config, none is invented.

Browser4 tests were written first for actual main/index/login, Staff direct URL/refresh/back/claim/unknown/close/forged tab/logout, serviceOwner acceptance and existing tabs, productsOwner inactive-channel closure, and Admin foreign-ticket denial/session expiry. Optional appMount fixture readiness reuses the same owned T2 and existing register/login/SQL precondition patterns; canonical Admin role is persisted/relogged in, not an invented profile. Default61 path performs no app-readiness writes. Vite opt-in declares the actual index entry, no preload/warmup or changed limit. Four public compile envs are synthetic/local only, not OAuth proof. The new Browser comparison403 for foreign GET contradicts existing protected404; proposed76e39822 remains unapproved/unapplied, all other negatives and private profile403 intact. No Browser execution or full62 claim.

## Draft-preserving navigation, tests first

Root source review found that URL removal/ticket changes publish selection before the existing composer discard confirmation. Owner Shell changeTab also calls setTab before its hash assignment, so a hash listener alone cannot prevent sidebar unmount. This is a composition defect within62/HUM-04 and the approved61 draft contract, not a new retention policy. No runtime failure is claimed.

Assumptions: the original draft stays only in CanonicalSupportChat; no persisted draft/cache, automatic send, permission or session authority is introduced. Logout, SESSION_EXPIRED_EVENT and tenant/context invalidation always clear private state regardless of a pending navigation confirmation. Existing history.state fields must survive; a position marker may contain navigation metadata only. Only the specifically confirmed continuation/URL may bypass its own subsequent hash event.

Files for review: new conversation-draft-navigation.spec.tsx first; proposed changes only to useWhatsAppRoute, conversation-navigation, the Owner/Staff hosts and tab/drawer prop wiring, CanonicalSupportChat and the single pre-setTab point in DashboardShell. Do not apply the productive hunk before Root technical review. Success: real App/Staff and real Owner Shell gestures prove external ticket removal, deep-ticket replacement, cancel/confirm Back then Forward, module exit and sidebar navigation preserve the draft until explicit discard; logout/expiry still remove private UI. Seven new whole-file cases are written, executed0. Original13+41 tests remain untouched.

Approved comparison correction: user call_deccc27c26364dd295c4ea885e841b0e replied "Corrigir somente essa linha (Recomendado)". Exact76e39822 patch applied once: only foreign ticket detail403->404, original0e9b95d6/candidate6faac08b verified. Private Staff/auth/profile403 and all other assertions unchanged. Receipt .cache/t62-browser-draft-status-review-20261119/approved-applied-receipt.json. Browser executed0. The memory reply "Vou liberar memória e aviso quando terminar" reports intent, not a completed resource window; no SUT/probe is authorized.

## Navigation proposal for technical review, not applied

Seven new cases are source-ready at1a1dbf6d. Their original expected results are unchanged; waits now distinguish the first hash event from the final URL/rendered state under the existing default budgets. A fixture review retained the real shared SDK HTTP client and isolates only the Shell global transport for notifications/domains.

Complete nine-file proposal4467c985 is in .cache/t62-navigation-guard-review-20261119/proposed.patch; review.json pins current originals and candidate files. App mounts a small history-position observer before route hosts, with existing state fields preserved and only position/version/nonce added. Typed callbacks pass through existing Owner/Staff hosts. Shell consults before setTab; internal tab/row navigation consults before publishing selection. The composer owns its raw draft and continuation and reuses its existing confirmation. Known Back/Forward restores by exact delta and publishes only the specific confirmed destination. Epoch/version guards invalidate obsolete continuations, while logout/session expiry retain their unconditional state clearing. No History method replacement, new router, draft storage, send, tenant grant or API change.

For a genuinely old unmarked entry without a reliable native browser index or provable new history-length increase, no direction is guessed and no legacy entry/URL is rewritten. Route publication is stopped and the existing composer/draft stays mounted. The browser URL may already show the requested destination while editing continues; explicit discard publishes exactly that destination. This bounded fallback is not full Back/Forward proof for unmarked history. The normal first external hash case creates a new entry and is indexed, preserving the already-written expectation that cancellation restores detailHash. Root technical review remains required before applying this productive proposal; executed0, no RED claim.

## Navigation proposal review correction, execution0

Root static review found double guarding on X/Escape in the first unapplied candidate: local close stored the route callback, then discard called it and the dirty router asked again. Eighth composition case6554e65f was written before revising that candidate; removing only its new case restores the original seven1a1dbf6d byte-for-byte. X and Escape each must explicitly discard once, close the drawer, remove ticketId and submit no message. No old expectation changed and no runtime RED is claimed.

Revised nine-file proposed.patch07809ff0 remains cache-only/unapplied. Integrated close now delegates once to the registered router; the standalone drawer retains its local confirmation. Source order confirms logout increments epoch, awaits logout, then setAuthMode calls authUrlForMode/replaceState without a hash event. The candidate explicitly resets/rebases after this auth replacement, the existing plan-completion replacement and empty-hash route initialization. Epoch invalidates old callbacks during render and rebases in layout while preserving a child guard newly mounted in that commit. No stale hash/position is retained as the current physical entry; no auth/tenant grant, draft cache or router replacement. These are source-backed corrections, still executed0.

## Exact local application and affected gate, execution0

Root read all of review2 and authorized exact07809ff0. All nine productive candidates were applied once only after verifying every original/candidate hash. Receipt .cache/t62-navigation-guard-review-20261119/applied-receipt.json SHA b33e465b. Test8 and all original13+41 files/STATEe8ab remain byte-exact. The tests preceded this correction; no RED or GREEN was executed after it. Task62 stays open without commit.

Next selection is whole87/10files: all41 directly affected composition cases, the new8 real App/Staff/Owner Shell navigation cases and the unchanged support-settings-page38, which recursively reads the modified canonical support component. Existing subscription-access-wiring3 in41 reads Main/Shell, while the new8 mounts their actual gesture path. A source search found no other direct Shell test consumer. All old assertions remain intact. Unchanged pure13 retains its independent receipt; prior41 is historical proof and must pass on the new source again. No gratuitous replay of unaffected hook/API/socket scopes. Exact command/pins/counts are in navigation87-gate-selection.json; original1024/defaultheap/oneworker/no-file-parallelism/5s tests and first-failure stop remain unchanged.

Headers and Browser remain pending, with normal dashboard typecheck still the first unstarted header. Main-only/front-end changes do not enter the owned API fingerprint, and apps/api/packages have no current changes. No probe, compiler, browser, server, API or provider execution ran during application/preparation. Wait for an explicit coordinated resource window. The conservative unmarked-history limitation documented above remains; no universal Back/Forward claim follows from source.

## Actual-app Browser history proof prepared, executed0

Root requested the real history sequence before Browser. Existing Staff scenario now observes its already-required reload list response, chooses the exact canonical ticket by that response's rendered row index, closes the empty direct-link drawer and opens the ticket through the actual list button. It then fills an unsent draft, goes Back, continues editing with the same text, goes Back again, explicitly discards, and goes Forward to the same canonical case with an empty draft. It asserts zero message POSTs before the original send gesture. No Back traverses about:blank or the pre-login document.

The additive Browser source is c1cc63df; stripping only these additions restores6faac08b exactly, preserving all4 original scenarios and every previous gesture/assertion including private403/approvedforeign404, actual send/close/cart/provider and role/session negatives. No extra quota GET: the already-required reload response supplies the row. Fixture/config/shared limits/workers/retries unchanged, no Browser or other SUT/probe executed. Source receipt browser-draft-navigation-source-receipt.json records this inverse proof.

## Browser source review and isolated component history, no execution

Root reviewed the additive Browser4 sequence and authorized its freeze. Root also authorized exactly one shared fixture precondition in the new8 component file: initial replaceState becomes pushState, so each App begins at its own last entry instead of inheriting another case's forward stack. Every gesture/result/assertion in all8 cases is unchanged. Separate before/after/one-call patch receipt is fixture-isolated-entry-receipt.json. The earlier inverse proof for the eighth-test addition remains historical; this later mechanical isolation is separately pinned, not hidden as byte identity. It does not prove the genuinely old unmarked-history fallback. No SUT/probe ran.

## First current affected87 result and immediate runtime return

Root dispatched one original1024 attempt after the user resumed. The fresh measured commit margin8158 admitted Vitest PID36468 under launcher22300, and all10 wholefiles/87 cases ran naturally:86passed,1failed,0skip/todo, exit1 at15:09:20.886Z. Source/test pins remained exact. Receipt85bcbc51, raw a5adc634, report138139f2. No header/Browser/API/provider or second attempt started; all SUT/probes were explicitly returned to Root immediately after natural exit.

The sole failure is the deep-ticket replacement after explicit discard, at settledAt's History ticket-b assertion, duration48.1ms. All other7 new navigation cases, including actual Owner sidebar and X/Escape, passed; all79 original affected consumers passed current. The helper currently awaits final URL before immediately checking rendered content. That is a concrete source fact for diagnosis, not yet a proven cause or permission to change an expected result. No test/production edit, added observer, timeout change or retry followed this result. Full62 remains open.

## Failed-case source diagnosis and synchronization proposal

The JSON contains only the truncated failureMessage; file.message/meta are empty and raw reports only the JSON path, so the full received body cannot be recovered. Source confirms settledAt waits for URL and then immediately checks body, while the Tab opens canonical detail asynchronously from its route effect. Proposed helper-only patch b179ecf0 waits for both unchanged expected facts, flushes pending React work per check and retains the final body assertion. Installed vi.waitFor supports Promise callbacks and defaults1s/50ms; no options or5s test deadline changed. All8cases/expected values and productive source stay unchanged. Candidateb4db525a is cache-only awaiting Root review, execution0; old87RED remains preserved and sole-cause/repaired claims wait for actual rerun. Root owns the independent API native window.

## Current whole8 GREEN and scoped UI87 accepted

Root authorized only helper synchronization b179ecf0, applied once8c048679->b4db525a without changing expected values, test limits or productive source. A fresh commit margin8054 admitted the single whole8 run. It passed8/8,0fail/skip/todo,natural0 at15:16:01.050Z, current pins exact. Receipt9e6b040e/rawf7dd0a0d/report8a948661. All SUT/probes were immediately returned to Root before metadata. No other suite/header/Browser ran.

Nine unchanged wholefiles79 retain their original87 receipt85bcbc51; productive inputs and those test pins were rechecked after8. Current UI87 is accepted across79+8, not a fresh87 runner. Initial13 pure retains its separate unchanged receipt. Original87RED and raw remain intact, and the eventual pass after the wait correction does not retroactively prove the full old body or sole cause. Full62 still requires normal dashboard headers and actual app Browser4/screens. Only the already-given14/11 spec approval was separately repaired from mojibake to exact user words, with all other spec bytes preserved and no new approval request.

## First admitted dashboard types, nineteen diagnostics

Fresh7191>=5168 admitted standard typecheck. It ended naturally2 with19 diagnostics, receipt27538e74/raw5a53047c. Build, own admission and Browser did not start; runtime was returned immediately before any correction. Fifteen collection spreads require DOM.Iterable absent from the existing config, two pending annotations still say Promise<void>, one context variable excludes null, and one productive optional equality allows undefined===undefined before reading null verified.context. No compiler/limit change is proposed.

Root authorized preparing, not applying, the minimum review patch f7ce4f16:15 Array.from sites,2 ReturnType annotations for actual claim/send contracts,1 explicit nullable test context with unchanged initializer, and1 verified&& guard. Before that candidate guard, a new eighth co-located Tab caseb1e1a2fa was written to require a readable alert and zero context/queue/detail or authorized socket scope when both context and expectedMerchantId are absent. Seven previous case bodies/assertions are preserved; new test executed0. Ten-file patch/review is in .cache/t62-dashboard-types-review-20261119, still unapplied/source-only while Root runs its five native32. All old expected values, tsconfig/libs, heap/guards/timeouts remain unchanged.

## Current affected104 GREEN, next header refused before child

Root authorized exact f7ce4f16 application after review, receipt e03021e5. The single whole affected cohort includes current88 (prior87 plus the new absent-context case) and the two annotation fixtures3+13, total104 in12files. Fresh4179>=1024 admitted it;104/104 passed naturally0/0fail/skip/todo with exact pins. Receipt b65e68e6/raw d1557aeb. The new missing-context case ran and passed; independent pure13 remains unchanged. Earlier87/8 results remain historical after the transitive Tab change, rather than being relabeled as proof of this program.

As authorized, only header pins were refreshed next. The standard typecheck fresh guard measured4532<5168 and refused before its child, receipt5c73d2f5. Build, own API admission and Browser4 were not started. All SUT/probes were immediately returned to Root before retry/metadata; Root now executes its three native15 and possible original products. M stays source-only and62 open. Type diagnostics19 from the older source remain archived; passing transpiled UI104 does not claim the current TypeScript header or build passed. Existing heap/guard/public synthetic env and all Browser4 gestures/limits remain unchanged.

## Functional gates GREEN; stable desktop capture still pending

The coordinated resume admitted standardtypes5848 and build6416, both natural0 with source/STATE exact, receipt2b38e19a. OwnM1668/ed20/2585 integral admission passed; whole actual-app Browser4 ran4/4 with0errors/skips/flaky and natural0/normal mandatory teardown, receiptae1b4bb8/raw4bc73772. It exercised real main/Staff private403, canonical claim/unknown/close, actual indexed Back/cancel/discard/Forward, Owner services/private tabs, products inactive closure, foreignAdmin404/session expiry. All SUT/probes returned before images/metadata.

Root opened both exact PNGs. Mobile390x844 error is readable/contained, but desktop1440x1000 captured active queue refresh and is not accepted as the stable Tab state. No functional failure or productive change follows from that screenshot. Four original traces and both PNGs are archived byte-exact under that run retained-artifacts/manifest.json (fd934bd6). Candidate6558c55f adds only two default positive waits before Staff screenshot: list visible, then refresh enabled and loading status absent. All4scenario counts, existing gestures/asserts/limits and other3 bodies remain exact. Candidate is unapplied/source-only pending Root review, no new runtime. Next authorized reproduction will be only the complete Staff scenario; other3 functional results may retain their exact unchanged scope. Task62 remains open/uncommitted until stable capture review.

## Stable Staff functional pass, provider-trap teardown RED

Root approved the two-wait-only patch6558c55f; Staff case ran1/1 with original setup/guards/limits and captured desktop7e9e5758. Global teardown failed naturally1, receipt8d2e2701/rawa2951447/report2ea3f359. The preserved trap now identifies MetaCloudTemplateAdapter.createAndSubmit called by RecoveryTemplateLifecycle/MonitorJob. It blocked the fetch; no provider0/appClosed claim follows. Own redis/db disposes and their absence assertions completed, bridgeAfter0, with only the app/provider error in the complete aggregate. All runtime was returned before source diagnosis/retry; current trace/PNGs archivedf246ca6e and mobile8a9 unchanged.

Source confirms immediate+60s monitor seeding every catalog type, due filtering only active WhatsApp/nextCheck, and fixture publication of valid-format fake Meta credentials. No merchant recovery flag is consulted. Proposed MJS-only canonical precondition7afd64e5 uses own compiled real repository ensure/defaults before those credentials, then only owned WhatsApp rows inactive/nextChecknull. It requires no held claim before publication and never clears a token/revision/status; concurrent stale due claims lose their nextCheck CAS. Later ensure skipDuplicates preserves inactive rows. Three owners plus later Admin are covered; other base fixtures have incomplete credentials. Job, global environment, provider trap, channel ACTIVE/enabled and operator eligibility remain unchanged. Proposal7159731c is unapplied/executed0 pending Root review, no production or eligibility claim. Functional104/types/build and original three other browser results retain their exact evidence, but62 remains open until corrected gate/visual review.

## Canonical fixture applied; contract11 GREEN; Browser refused before child

Root reviewed and authorized exact7afd64e5, applied once7323->7159, receipt81af3cfd. Existing whole fixture contracts ran11/11 naturally0/0skip/cancel/fail/todo, rawa9589bbc. OwnM1668/ed20/2585 admission passed. Browser guard then measured1704<2048 and refused before child, receiptbee81fc1. Thus the new SQL precondition has not executed, no new App/PG/Redis was created, and no corrected Browser/cleanup claim follows. All runtime was returned before retry; Root now owns API37 lint.

Root inspected/emitted the prior desktop7e9 as a stable local preview, with the explicit qualifier that its Staff teardown failed. Mobile8a9 remains byte-exact. Optional user visual approval is unanswered and not inferred. No final aggregate gate count is claimed while Browser4 remains unexecuted after the shared fixture change. Types/build/UI104/pure13 retain their earlier scope and this fresh fixture11 is separate; no source/header/UI/APIbuild replay is justified without new impact. Task62 stays open, first unstarted scope is the whole corrected Browser4 after coordinated admission.


## Premium Conversations refinement requested by the user

User: "quero ajuste use /impeccable para ajudar num layout mais premium e exclusivo". The7e9 preview is not visually approved. Impeccable3.7.1/product register and the existing PRODUCT.md/DESIGN.md guide this revision; context initialization/update prompt are not repeated.

Assumptions: the operator works through a queue, then a focused conversation. Existing Dashboard mineral surfaces, sans typography, semantic state colors and Lucide icons carry the Zyon identity. A real ticket reference, preview, received date and current mode replace no customer data. Counts describe this loaded page only. No buyer names, global KPI, filter, dependency or backend change is introduced.

Files: ConversationsTab, StaffWorkspace and scoped whatsapp-seller.css; CanonicalSupportChat presentation and scoped support-settings.css; two additive queue gesture tests and extra Browser viewport/capture checks. Hooks, DTOs, auth/tenant/roles/context3fields, history order/cursor, navigation/draft/intent/send/close behavior remain unchanged. All original accepted assertions stay intact.

Success: whole current affected UI cohort including the two new presentation/selection gestures; standard dashboard headers; retained fixture11 only if byte-identical; current ownAPI admission; whole original Browser4 with canonical7159 fixture/provider trap and normal cleanup. Save genuine1440x1000 and390x844 captures, including readable toolbar/content. Earlier source-dependent UI/header/browser evidence becomes historical after productive changes. No execution, probe, status mark or commit in this source-only window.


Premium source checkpoint:6 productive presentation/CSS files plus additive UI/Browser checks. New2 queue gestures were written first; original8 unit cases remain a byte-exact prefix and removing only new Browser geometry/capture lines restores every prior4 case/assertion. All Canonical handlers and queue authority effects are byte-exact. Root clarified count copy to "N conversas carregadas" because cursor pages accumulate. No contact name, avatar, global metric, filter, API/dependency or permission was added. The prior source-dependent104/header/Browser receipts and PNGs are historical after this revision. Current106/12wholefiles is unexecuted; pure13 and fixture11 unchanged retain their original evidence. Next coordinated gates: whole106, standard dashboard types/build, ownM16 admission and original wholeBrowser4 with fixture7159/trap/normal cleanup. No SUT/probe, mark or commit in this source-only window.


Premium gates prepared only: whole106 uses the original12-file Vitest setup/args/1024guard and defaults. Headers reuse standard typecheck/build with5168 per child and the same public synthetic compile environment. Browser reuses unfiltered original4/setup/2048/workers1/retries0/traceon/cleanup, preceded by ownM16 admission1024. Existing11 fixture contracts remain accepted unchanged from bee81fc1. Root approved additional mobile observation680753af: existing Admin390 scenario waits for its real own queue/stable refresh after closing the foreign denial, captures it, then performs the original logout. No new request/scenario/viewport/limit. New capture inventory is queue+drawer1440x1000 and error+queue390x844. All original4 assertions inverse-byte-exact, no new SUT executed.


## Active Conversations tab visibility after real mobile RED

Current premium106 and standard headers passed, but Browser4 ended3pass/1fail with normal global teardown/no global errors. Admin390 own queue was visible and stable; its selected last Conversations tab remained clipped horizontally at the original tab-strip position. Receipt799c8fc7/raw2d0a5407 and failurePNGae637257 are retained; no timeout/oracle/trap weakened. The assertion before mobile capture remains unchanged and the original later logout assertions remain required.

Root authorized a scoped local fix: a parent ref/layout effect in WhatsAppSellerPage, always declared before conditional returns, runs only for allowed mounted Conversations and tenant id, compares the selected tab and scroll-container rectangles, and adjusts only scrollLeft. No shared TabBar, tab order, focus, page/Modal scroll, routes, auth, configuration hooks or other premium styling changed. A new host geometry/keyboard/URL-transition case was written first; original4 mount cases remain an exact prefix, all prior106 assertions retained. Test protocol emits the actual hashchange listener after preserving history.state; no expected value changed. New unit executed0; actual pre-fix causal evidence is the Admin Browser RED. Source84520993 is ready for current107/headers/wholeBrowser4 after a separate dispatch.


## Background read concurrent with the explicit send gesture

Current107be77 and headers61c6 passed; Browser8de13 ended3pass/1fail/natural1 with normal mandatory teardown/no global errors. Admin390 now passed selected-tab visibility, captured its own queue and completed original logout/expiry. ServicesOwner original5s draft-empty assertion failed. Trace86038adc shows claim201, no POST/messages, send gesture144177-144301, enabled input snapshot144224, background detail GET144252 and disabled after-snapshot144313. This proves the transition/no submission, not an API rejection or RAM cause. The native suppression/early-handler distinction is not instrumented. All4 current images and traces archived1036fb15.

New4 mounted cases were written first (f0edc5e5), execution0: same authorized pending background read must preserve the explicit send; failed read, changed owner and explicit foreground reload remain blocked. Hooka1db remains unchanged. Proposed patch516ecf95 -> candidateccae1387 separates internal quiet background read from unchanged public foreground open. All command/working/scope/selection/epoch/unknown-intent guards remain exact. No queued/resubmitted unknown message, delay/debounce or old assertion changed. Root review and a separate causal-test/runtime dispatch are required before applying/running.


Actual causal4 against originalhooka1db:3controls passed, positive failed exactly at authorized-button-disabled assertion line60; no missing module/API setup failure. Receipt02443b4a/raw6809f963, natural1/0skip/pins exact, launcher/worker ended and resources returned before fix. Immutable copies include original frozen source/selection/launcher/raw/JSON under causal-red-02443b4a. Proposed516ecf95 remains unapplied pending Root handoff.


Exact516ecf95 applied once after Root authorization and meaningful causalRED, sourceccae1387/application6db9cb29. Command/working/scope/epoch/unknown-intent code remains exact; public open stays foreground. Full affected138 across20wholefiles includes old107 plus new4/intent4/refresh-budget4/merge4/actionpermissions3/SDKcontract4/socket4/actionlabels4. The unchanged pure13 and fixture11 remain outside with their original receipts. New UI/header/Browser gates are prepared, not executed; old107/header results are historical after hook source changed. No backend input, new public API, blind resend, timing or existing assertion changed.


First current Full138 attempt was refused before the Vitest child at fresh307<1024MiB, receiptabb496ca, executed0. Launcher37296 ended naturally1; no App/DB/headers/Browser started. Original bounds retained, no retry or further memory probe, runtime explicitly returned before metadata. Original receipt/selection/freeze/launcher archived under first-full138-refusal-abb496ca. Hookccae/new4f0ed remain current but untested after correction.


The single bounded scheduler1250 found31 stable seconds>=1024 and invoked b355 once; independent launcher admitted4751. Whole138 ended naturally1 with135pass3fail/0skip, receipted4826fd/rawa68eb261, sourcepins exact. New background4 ALLGREEN. The three failures exceeded original5s (5251.7/5738.3/5360.8ms): first2 legacy38 export/date cases await import before assertion; Owner Shell navigation case exact awaiting phase is not proved. No RAM/cold-cache/source cause claimed, no timeout/preload/oracle change. Eighteen complete passedfiles92 may retain current scope; both failedwholefiles38+8=46 remain required and their partial43 are not counted complete. Original raw/report/selection/freeze/runner archived under full138-red-ed4826. All scheduler/launcher/Vitest owners ended; runtime explicitly returned before any retry. No current headers/Browser launched; Task62 remains open.


User desktop style approval: "Aprovar o estilo do desktop" (call_28d46de81a384fc5991547007d8ae055). This settles desktop styling only, not technical gates, task closure or publication. Styles are frozen. Root authorized one scheduler d6000fe4 conservative5168stable30s/max600 before original remaining46/e580 fresh1024/default5s;92 whole-file passes retained, no automatic later gates.


Remaining46 passed naturally0 without any test/source/5s deadline change, receipt23080c57/raw77030520/pins exact. The conservative5168stable30s scheduler45f6b658 invoked originale580 once; its independent original1024 guard admitted8711. The current UI138 are accepted across18 retained completefiles92 +2 current completefiles46, not a fresh successful138 run. Historical deadline failures remain archived with unknown delay cause. Scheduler/launcher/Vitest ended, no current headers/Browser auto-started; runtime explicitly handed back before further actions. Desktop style is approved, current technical headers+Browser still pending.


Current quiet-source dashboardtypes passed naturally0 (rawbaaf4355) under5320>=5168. Next build guard refused3633<5168 BEFORE child, receipt6df9f06c; no build/ownadmit/Browser started. All header owners ended and runtime handed back. Retain current types0/UI138; resume only first unstarted standardbuild with unchanged public synthetic compile env/original5168, then separately admitted ownAPI/Browser. No blind retry, guard/source/timeout change or extra memory probe. Original partialheader receipt and logs archived under types-green-build-refused-6df9f06c.


Current build-only passed naturally0, receipt e2512b67/raw dc8a85e8, sourceAndStateExacttrue. The single bounded5168stable30s/max600 window admitted18:13:38Z; independent original5168 guard measured7315. Original standard public-env verify/tsc/Vite finished18:14:06Z. Retain types6df9 and currentUI138(92+46); no replay/automatic ownadmit/Browser. Scheduler36192/launcher37696/build22744 all ended naturally, runtime explicitly returned to Root before metadata. Current ownMAPI admission+wholeBrowser4 remains pending separate dispatch; desktop style approved but T62 remains open.


Current wholeBrowser4 passed4/4 naturally0, receipt ecf27c4a/raw0d8b262e/report1d5477ef, no skipped/unexpected/flaky/global errors. OwnM1668/ed20/coverage2585 integral admission0, sourceAndStateExacttrue. Original scoped fixture81+27 templates inactive/notdue/unclaimed; providertrap remained active and runtime close required providerCalls0, appClosedtrue/remainingContainers0/remainingBridgeSockets0. All mandatory teardown returned normally. Real1440 queue effba3df/drawer cb9b8779 and390 queue f8f62ef8/error cf780d12 opened/readable, original dimensions verified, archived with receipt/report/raw. Launcher37120/browser16404 ended; runtime explicitly returned before metadata. CurrentUI138 accepted92+46, types6df9/build e251 retained. Desktop style already explicitly approved; technical/capture Root review pending before62mark/commit. No production.
