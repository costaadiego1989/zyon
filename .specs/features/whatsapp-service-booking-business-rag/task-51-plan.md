# T51: original-turn authority and canonical effect admission

Status: design and causal-test proposal before productive implementation. Root selected implicitAI0 and preservation of both T49 bindingcount0 negatives. This supersedes the older T51-plan brainstorm. No T51 source or gate is accepted yet.

## Guarantee

No new AI-origin provider request starts after the human transition commits. A request already started can deliver bytes or a provider result later; this is historical work, not prevented delivery. No new cart/checkout/buyer mutation from an obsolete AI turn commits: its actual writer transaction owns the same conversation advisory lock through commit/rollback. LLM/network response time is outside that lock. A mutex around an independent/nested writer is forbidden.

Operational paid/order/booking accounting and notifications retain their own canonical authorization. A buyer/model flag never selects an origin or releases a fence. Handoff applies to this merchant/config/session, not to every channel used by the buyer.

## Captured authority

A versioned server token records merchantId, configId, whatsappSessionId, canonical buyerPhone/device/provider, bindingId (null only for implicit initial state), epoch, original checkoutSessionId and original conversationId. Account/routing identifiers actually used by the sender must match the canonical configuration captured for this turn; secrets never enter the token. The token is immutable and stored with the durable inbox/SavedTurn or legacy captured response before ASR/LLM awaits. It is never reconstructed from the current epoch on retry.

Implicit0 is admitted only when no binding exists under the same identity advisory key used by RouteToSession and handoff: JSON of whatsapp-session, merchantId, canonical buyerPhone, deviceId. Read the canonical session/config and session row while holding that lock, validate the inbox lease using PostgreSQL clock, and confirm original checkout/conversation identity. This read must not call repository.loadLocked, which currently creates a binding. Add a read-only locked path; existing begin/getOrCreate keeps creation behavior.

A handoff creates binding epoch1; close advances rather than restoring0. Therefore an old null-binding0 token is rejected if any binding now exists, even modeai. Renewal/reused WhatsApp session also rejects the old token when checkout/conversation identity differs. Config/recipient resolution is checked against the original authority after credential/media awaits. Missing/malformed legacy authority never adopts current0: mark the old result for truthful suppressed/unknown handling instead of regenerating or resending.

Sequence: RouteToSession operational routing -> verified turn context -> T50 human router -> original AI capture -> ASR/handoff detection/post-sale/engine -> guarded effects -> durable presentation -> guarded state application -> every actual request start. A confirmed initial human notice instead uses its original server receipt (ticket/binding/epoch/inbox), not the AI epoch. An unconfirmed initial notice keeps the original implicitAI0 authority; its catch cannot mint a newer ticket/epoch. Both T49 count0 negatives remain intact.

## Actual SQL write boundaries

Expose a server-only automation context carrying original authority plus an admission callback. Canonical writers invoke it inside their actual transaction and before domain locks. No global Prisma proxy, root transaction around nested clients, OS/network monkeypatch, test route or productive bypass flag.

Required write inventory:
- Actual PrismaStorefrontCartRepository.withCart -> withStorefrontCart/withStorefrontCartInTransaction; cross-sell/coupon/local-effect transactions must enter admission before their merchant/cart locks. The separate foundation PrismaStorefrontCartUnitOfWork is not proof of the real flow.
- PrismaCheckoutRepository transaction and each standalone session/commercial/coupon/edit/cross-sell writer. Some save/create fallback paths currently take only a checkout anchor. Admission must precede merchant/checkout/cart locks, not be added after them.
- WhatsAppHubAddressesService.mutate before buyer lock, phone-only account/profile/preference/identity writers actually used by WhatsApp, product questions/reviews/favorites and post-sale NPS/review effects reached by a turn.
- WhatsApp session/menu/presentation writes. Read-only lookups can finish, but cannot authorize a later mutation or external request.
- Payment creation retains canonical durable intent/coupon/paid guards. Already-admitted payment reconciliation/complete-order remains server-operational after verifying its existing canonical payment authority; it is not a newly authorized AI sale.

Inventory route renewal separately: existing withRoutingLock invokes RouteToSession with a transaction-bound session repository but its createCheckoutSession collaborator uses the root client. Do not claim an outer lock enlists that root write. If a concrete controlled timeout race demonstrates a new gap, bring the exact writer/transaction proof to root rather than silently refactoring historical routing or relaxing the financial guard.

## Own checkout transition

Concrete source: CheckoutWhatsAppConversationAdapter creates wa_checkout_<fingerprint> and returns that new checkoutSessionId while preserving the store conversation. Meta.dispatchPrepared currently updates WhatsAppSession and saves sessionApplied in two separate awaits. A token that compares original checkout forever would reject its own valid checkout response; accepting arbitrary current checkout would admit renewal.

Proposed minimal composition: apply the prepared session state and its existing inbox/SavedTurn sessionApplied receipt in the same canonical transaction under the conversation lock, original-token check and revision CAS. Extract the existing inbox save/receipt-merge helper so the same implementation can run in a supplied transaction; do not duplicate receipt merging or open another root transaction. Keep the original token immutable. A later admission may use the exact server receipt for this inbox/original token to validate only the resulting checkout/conversation/revision written by this turn. It never captures the current state as new authority. If current revision belongs to a newer turn, reject. This is a proposal for code review before implementation, not a new commercial authority.

## Saved turns and paid preparation

Every new durable state retains the original token. capture occurs before HandleIncoming.prepareAudioForHandoff, not only in Meta.execute. Initial capture can persist an authority marker without changing the phase/presentation. The current invocation knows it captured the marker; a retry restores it rather than adopting the current epoch. Any ASR/LLM work whose result is uncertain must not be blindly submitted again. Reuse the existing generating/dispatching unknown semantics and prepared-media behavior, with explicit first-invocation versus replay handling; do not let a marker alone accidentally trigger another interpretation in Meta.execute. Authorized speech keeps exact media/inbox/conversation scope.

A stale result becomes a terminal server receipt (AI suppressed) and cannot later resume after close. If the current exact conversation is under human handling, use T50 to persist the still-authenticated input/authorized transcript to that ticket; otherwise retain the original inbox without generating. Legacy no-response acknowledgement must remain distinct from sent/read and from human_received when no human message was actually appended.

## Request initiation boundary

After every asynchronous credential/media/preparation step, the actual adapter supplies the resolved merchant/config/device/provider/account/recipient to the fence. Check those against the original token, current binding absence/id/epoch/context and live inbox/outbox lease under the same identity lock. Invoke a synchronous startSubmission callback at the real fetch boundary and attach a rejection handler immediately. Return an object containing the in-flight promise, allowing the transaction to commit/release without awaiting the network response. Await result outside. If the transaction fails after request start, preserve dispatching/unknown and reconcile; never call start again blindly.

Guard high-level SendWhatsAppResponse sendUi/execute and delayed legacy delivery, plus real provider boundaries after their awaits. Include Meta image preparation (download and Graph /media POST), /messages, typing if present, Twilio/Bubble fallback sends, ASR/vision/LLM request initiation and optional-media/text retries. Do not prove only /messages while upload/typing starts late. A local sender fixture can start immediately; it does not prove the real adapter's asynchronous preparation seam, which needs controlled adapter tests.

## Async origin and event bus

WhatsAppTurnContext must preserve the immutable authority across withMessage/authorizeSpeech and restore it without replacing it. Origin changes use separate ALS.run frames, not mutation of a shared origin object. InMemoryDomainEventBus executes Promise.all handlers inline, so they inherit the AI ALS. Verified operational handlers clear/substitute authority only after their canonical server proof; event names or buyer flags alone are not authority. Accounting/paid notifications triggered while an old AI frame exists must still run correctly. No HTTP hop was found in the current Meta-to-store/checkout mutation path (DI calls); do not invent a header capability. Any actual HTTP mutation seam discovered later must carry a validated server proof, since ALS does not cross requests.

C56 return-to-AI notice is separate: closed ticket+closedEpoch receipt and exact successor AI epoch, its own outbox idempotency, no old intake SavedTurn or operator-open-ticket impersonation. New handoff invalidates it.

## Causal matrix

1. Read-only implicit0 capture under advisory lock leaves binding count0; real handoff then creates1 and rejects old capture after close/newcase. Both unchanged T49 negatives still pass.
2. Hold the canonical identity lock and observe the competing DB backend waiting via pg_stat_activity. Capture/check cannot slip between absence read and handoff. Use fresh DB lease clock after lock.
3. Renew/reuse a session with no binding: original checkout/conversation token fails. A deliberately successful checkout transition by the same turn, with atomic state/receipt CAS, still sends its correct payment/checkout UI. A newer revision cannot reuse that receipt.
4. Block a controlled LLM/ASR/preparation result, commit handoff, resume. No new request/tool mutation; exact durable cart/checkout/buyer/payment/appointment state remains. Raw input/authorized transcript is retained for the exact ticket. No new ASR charge while human.
5. Pause the actual cart tool before its real withStorefrontCart transaction and the actual checkout/hub writer before their canonical transactions. Commit handoff and resume: old writer refuses before mutation. Also prove a writer already holding the identity lock commits before the waiting takeover; no detached inner writer continues after timeout/release.
6. Pause actual sender credential/image preparation, commit takeover, resume: final request-start callback is never entered. Cover upload/download/typing/fallback and each partial presentation message, not only the first text.
7. Start a request under lock, prove takeover waits, release admission and let already-started response finish after takeover. Exactly that historical request may complete; no subsequent request starts. Do not assert physical late bytes are impossible.
8. Immediate rejection of the started promise cannot become unhandledRejection. Inject a commit failure after start and require unknown/reconciliation plus exactly one attempted start; retry never resends blindly.
9. Prepared partial/SavedTurn/legacy delayed response resumes its original token after takeover/close and refuses. Unversioned work does not mint0. Current failure in a catch/fallback must not replace the authority with current state.
10. Initial confirmed and unconfirmed notices are fenced by their own receipt/original implicit0; operator claim/close/new handoff invalidates the old notice, including retries. No new epoch is adopted.
11. Publish an actual verified paid/booking operational event while obsolete AI ALS exists. Canonical accounting/notification remains allowed with its own proof, while a fake buyer origin/event label cannot acquire that authority. A concurrent storefront thread for the same buyer remains independent.
12. Run old T49/50 unit/native and commerce regressions on the final checked artifact. All new DI/module/factory wiring is in the same T51 commit. Full real AppModule/HTTP/DB, no auth/repository overrides; any fake provider port expansion needs its own explicit reviewed child-only boundary.

## Files and gate proposal

Production: handoff repository read-only locked path; original-token/context/fence service and small module wiring; incoming/Meta/send/delivery integration; inbox transactional helper; canonical cart/checkout/buyer/hub/post-sale writers and verified operational handlers actually reached; provider request adapters at their last preparation boundary. Add only files demonstrated necessary by the call graph. Preserve all existing commercial assertions.

Tests: pure original-token/receipt/origin/request-start units; controlled real adapter preparations; owned SQL races and signed HTTP/AppModule journeys for mutation/renewal/retry/operational preservation. Native transport fixtures remain explicit/local only. Source51 and new heavy gates wait for the documented review; T50 is f49d6f664, with137 unit/contract and25native green on a4b6ce93/d9bd2198.


## Adopted review refinements before source

Root accepted the technical direction; C's incremental read-only review is not the final feature Verifier. Preserve all T49 assertions.

- Own-turn context receipt is read from the persisted inbox under the same identity lock and current lease. It binds inboxId, complete original token, old/new checkout and conversation, previous/result revision. A memory sessionApplied boolean or route snapshot cannot grant it. If the revision CAS fails, do not fabricate a receipt. Test an actual SQL rollback between WA update and receipt, a retry with the valid persisted receipt, and refusal after renewal/newer revision.
- Extract the existing inbox receipt merge, preserving and validating immutable authority and own-context receipt on every save, including catch/fallback. Do not let spread response omit or replace authority. Compute eligibility with clock_timestamp() after the advisory/row wait, not NOW() fixed at transaction start. Test a real lock wait crossing lease expiry.
- ASR already has the necessary independent attempt receipt. MetaAudioTranscriptionService uses SHA merchant+inbox+media; AiMeteringService.fetchTranscription permanently creates AiUsageEvent before transport, P2002 blocks another attempt, and completion retains the key. Reuse that exact contract rather than invent another ASR billing protocol. The authority marker is not ASR initiation proof. Test crash after create/before transport, request start/pre-result and retry with one attempted start, plus preparedMedia consumed without another interpret.
- Governance/pricing await may finish after takeover. Fence the final actual transport with original authority; no new request starts. A reserved usage row that never submitted is not completed charge and must finish under the existing rejected/suppressed/cost0 contract without generating another key. Real accounting for a request started before handoff remains operational and must not be blocked by stale ALS. Never invent a transcript whose result was not made durable.
- Actual cart coverage is PrismaStorefrontCartRepository.withCart -> withStorefrontCart, not merely the foundation UOW hook. Test the real tool plus cross-sell/coupon writer transactions. Provider resolution/recipient is compared to original authority even though WhatsAppOutboundMessage currently lacks merchantId.
- Route ownership hypothesis is now prepared in tests/whatsapp-routing-transaction.integration.spec.mjs against the valid T50 artifact. It uses only owned PostgreSQL/Prisma/middleware. A fixture holder15s is separate from unchanged productive5s; observed SQL waiters and checkout-PID transaction settlement precede the orphan counter. Do not claim an orphan until its causal run actually reproduces it. Any fix must enlist the actual collaborator writes, not increase a timeout or relax a paid guard.

## Implementation checkpoint (2026-11-15, not a completed gate)

Assumptions: only the immutable authenticated inbox/turn can supply original authority. Absent binding stays absent (implicit0). The canonical per-conversation identity lock orders actual writer transactions before merchant/professional/cart/checkout/support locks. Non-WhatsApp operations retain their existing behavior. No remote action is authorized.

Files implemented so far: original-authority and immutable-response domain helpers; shared server-only execution/payment-claim context; handoff readLocked; inbox load/saveWithin with clock_timestamp after row wait; dispatch fence + module; incoming/Meta/legacy response paths; actual cart, checkout, buyer/profile/address, NPS/review/testimonial and generic support-question transactions; Meta/Twilio/Bubble/media/capability/AI-metering request-start boundaries; payment creation repository, ResumePaymentCreation and actual MercadoPago/Asaas/Stripe request/SDK boundaries. Existing canonical payment approval may clear the AI context only after its persisted identity/amount/account authority checks. Creation-result persistence/recovery uses the exact persisted intent/session/amount/currency/creation-input/lease receipt and retains all normal CAS/financial guards.

Success condition: no new AI-origin request or effect from the obsolete original turn; no lost authenticated input; no new charge from blind retry; existing paid/booking operational reconciliation remains valid; original product paths and both T49 zero-binding negative assertions preserved. Native and checked gates are still pending. Future booking writers must compose the same actual-transaction helper when their feature lands; no seeded appointment snapshot is called an admission proof.

Recorded evidence:
- Base merge9633371cb includes only committed Ne1379a5c3; four cache/test/archive manifest hashes preserved. Root's uncommitted65/66 plans were not imported.
- Routing causal RED against original T50 checked artifact a4b6ce93/d9bd2198: one actual PG case, outerP2028, takeover waiting_human epoch1 committed, independent checkout backend settled, checkout count1->2, original no-orphan assertion failed. Log .cache/t51-routing-causal/2026-11-15T21-11-43.025Z/case.log, owned cleanup completed, session58425exit1. Prior no-FK holder fixture failure is separate, not RED. Fix enlists checkout collaborator in routing's actual transaction, keeping default5s. Corrected GREEN setup retains the same no-orphan oracle/PID settlement and handles the now-shared backend by releasing the test SHARE lock only after observing takeover wait and crossing the original5s DB-clock deadline. No post-fix native run yet.
- Initial domain/context/adapter/intake selection160/160 unit; writer selection initially42/43 due an old shipping fixture lacking paymentIntent.findFirst. HEAD963 source/spec copied with explicit import-only adaptation reproduced identical original failure4/5 (manifest/log under apps/api/.cache/t51-checkout-comparison and .cache/t51-checkout-comparison). Root authorized completing that fake's missing read with null; both shipping assertions remain unchanged. Writer selection then43/43, zero skipped.
- First payment/approval/recovery selection63/63, zero skipped. It is an intermediate snapshot, not a final current-source gate. Subsequent changes/new cases need their focused rerun.
- Native companion tests/whatsapp-ai-dispatch-fence.integration.spec.mjs is prepared/syntax0 only: implicit0/actual cart refusal, request-start versus completion, SQL-trigger rollback of WA+own receipt, legacy newer-applied input versus pending, renewal, exact PSP creation claim, and post-lock lease expiry. Existing T49/T50 HTTP/regressions remain required on the final checked source. Local provider initiation is not delivered/read or real Meta/PSP evidence.

Outstanding before T51 completion: finish writer/operational inventory, paid-result negative tests, input retention in delayed legacy suppression, incremental review findings, canonical HTTP/adversarial compositions, final unit set, one checked build, actual native/HTTP/DB gates, evidence/tasks/check_commit and own atomic commit. Heavy slot currently belongs to root65; M runs only light source/unit preparation.

## Executed checkpoint, 2026-11-15 23:15 UTC

T51 remains incomplete. Fresh checked2528 passed (007c89f7/b0b107f1); current focused489 units passed. Native16 passed, including the original routing no-orphan oracle with a shared PID, rollback, current lease, real cart/normal-reader/admission guards, adapter request order and permanent ASR attempt accounting. Signed HTTP3 passed with real AppModule/auth/repos and the explicit local sender port. These are local proofs, not provider delivery or production acceptance.

Regression40 yielded38 pass/2 fail: T2/T48/T49/T50 passed, while the original signed Twilio intake rejected a legitimate authToken+configured-To legacy connection without SID. No existing assertion or fixture was changed. Compatibility must retain that authenticated intake while the real SDK still requires SID/token/sender; original configuration and credential rotation must invalidate old authority. The peer reviews this identity contract before its implementation.

New live-legacy SQL18 yielded15 pass/3 fail (two children plus parent): terminal inbox suppression before any outgoing capture incorrectly left its own delivery processing_unknown. The exact original token/lease and validated support receipt now authorize only acknowledged/suppressed on that same processing delivery, never sent or an uncertain submission. A fresh checked build and rerun remain required. The earlier unique-config fixture error is separate from this executed RED.

The supplemental normal-adapter file is unchanged: the same80 tests produced69 pass/11 fail on the previous source and on51. An external combined-clock fake candidate retained the same11; it was not applied. No clock, date or business oracle was changed. Product DB normal/widget and the existing17 admission cases remain pending. The root temporarily owns the next checked66 slot; M does not run a heavy process concurrently.

## Current checkpoint, 2026-11-16 00:30 UTC

T51 is still incomplete and uncommitted. Current source is checked2528, input9b130af1bb0cdb15567aa79c7b63ece73c94d3c9727f9728ba992bedc98dd967/artifactc419896044ef7247332e1dace5325dc68de9934b32b956d7a99df68fe8d2686c. The latest552 units passed, zero skipped (00-14-58 log). Original T50 native10 passed on this artifact (00-22-17 log), including both unchanged historical notice-consumption assertions.

Executed additional REDs are preserved: expired prepared Meta response reset history/conversation/revision before suppression (2026-11-15T23-28-32 log on8c2d/19ea); malformed confirmed notice epoch/missing-or-foreign binding minted a receipt from an unproven pair (2026-11-16T00-12-35 log on908163/98e385,25 total/21pass/4fail). Prior missing BuyerIdentity fixture failure was separate. Root's peer C reviewed the source and identified that consistency finding; C is not the final Verifier. Binding IDs are persistent in current writers; no reassignment/delete path was found.

Restoration now precedes routing; the actual routing transaction checks the original capability, and resumed work retrieves its original WA context without lifecycle renewal. Fresh authenticated inputs retain the ordinary expiry/bootstrap behavior. Known handoff replay is consumed from its exact historical intake, preserving T50's human_received marker and null receipt for an unconfirmed original case. Root explicitly approved aligning only the two new HTTP expectations to that existing internal contract; zero binding/ticket/send/renewal oracles and every old assertion remain intact. Confirmed replay requires its proven original binding/epoch; invalid pairs terminalize without a receipt and cannot forward on retry.

Final broad comparison was refreshed with all modified tracked production TS overlaid from HEADa040bd047 and original import URLs. Both complete80-test suites still have the identical11 failures,69 pass,zero skipped; no assertions/dates were edited. See apps/api/.cache/t51-final-normal-comparison/manifest.json and results.json. This is regression comparison, not general green evidence.

M currently owns the heavy slot. HTTP7 is running on the current artifact (session32323); core26, remaining compatibility30, existingT26 native17, normal/widget Product DB and compiled contracts are next. No remote operation or provider delivery occurred. Check actual logs/runner exit before marking any remaining gate complete. Root66's index fixture work is independent and did not edit M.

## Product DB fixture bootstrap, 2026-11-16

The original widget runner failed identically before/after51 at its first quote/accept, before any case passed. It omitted the canonical write-version SQL guards. The parent now installs the same byte-matched migration assets as the normal checkout runner. Its first subsequent failure was a fixture reset trying to write the read-only version counter; no product case had run, so that setup failure is not a product RED.

Root approved a technical historical loader inside this owned synthetic worker only. It validates the exact loopback URL/application name, UUID database marker, database name and checkout ID/tenant/session. A short transaction disables only the two explicitly named canonical triggers, loads the existing historical4/MAX/context snapshots, reenables both before commit and proves their catalog state. Errors roll back the DDL. Before each SUT case and after each historical load, an actual forbidden version write must fail with CHECKOUT_SESSION_VERSION_READ_ONLY and preserve the whole checkout row. Concurrent mutations use an ordinary no-op write so the canonical version trigger performs the increment. No runtime/config/API bypass exists.

The two payment/radius fixture updates keep their original customer/shipping and strategy/version mutations inside the same owned loader. No commercial oracle, fixed version/date or adapter source changed. AST comparison records every original assert call in the same order with unchanged text; only new safety assertions were added. Evidence: .cache/t51-widget-bootstrap/assertions.json. Widget execution remains pending until the root returns the heavy slot. Production TS remains9b130af1/artifactc4198960, so this MJS-only bootstrap does not require a productive rebuild.

## Gate checkpoint, 2026-11-16 01:29 UTC

T51 is uncommitted and incomplete. Checked2528 remains9b130af1/c4198960. Final unit552, originalT50 native10, new signedHTTP7, SQL/routing26, compatibility30, existingT26 native17, normalProductDB48 and compiledcontracts6 all passed with0skip/provider/ownedcleanup. The eleven broad normal-adapter failures remain identical before/after in the complete80-case file. Detailed final paths/counts are in task-51-evidence.json.

Widget's canonical bootstrap/history loader passed its rollback/catalog/actual forbidden-write proofs and49 original cases, then exposed a preexisting expectation: email OTP asserts strategyContextVersion increases by1 despite no strategy assignment. Both previous/current productive sources with exactly the same loader/worker/DDL pass49 then fail this same0-versus1 oracle. Canonical SQL preserves the strategy counter without an assignment; both original/current confirmWrite also require it unchanged. No strategy row was invented and no old assertion was changed.

Root requested an external one-line candidate for concrete review. Only the cache overlay expects equality rather than+1. That diagnostic corpus passed176/176,32 actual SQL lock waiters, provider0/cleanup0/naturalexit0 in110.7s. The tracked worker remains unchanged from its actual failing oracle; AST manifests retain every536 original assertion in order plus8 safety assertions. Three fixture-only Merchant writes now select id to avoid requesting newT4 columns from the intentional legacy SQL projection; where/data and every oracle remain identical. Two earlier candidate fixture failures59/62 are archived separately.

Approval to change the old expectation is pending under the TLC test-integrity requirement. Parent owns that user question. Candidate GREEN is explicitly not the real T51 gate. After approval, apply exactly the proposed line, run the real protected widget runner against the same checked artifact, then mark/commit51. No heavy M process remains.

## Approved test correction applied, 2026-11-16 02:33 UTC

Parent relayed the user's exact reply: "Sim, corrigir essa linha (recomendado)" (call_895e4cba1100411cbc83b4423b42623d). Recorded in tasks Handoff. Applied only the proposed old email OTP counter assertion, preserving saved.version6 and every other commercial oracle. The tracked worker now exactly matches SHA dc71368a28b3039c8569392a9cc6ab4fc24834f904281a2d83d71e8424ce3d99, the external successful176-case candidate. AST proof retains535 unchanged original assertion calls and the1 explicitly approved correction, plus8 new guard assertions; old pre-approval manifest is preserved separately.

Syntax/diffcheck/validate_tasks passed, with only the inherited T4 granularity warning. Real widget gate is not yet run. Root owns the heavy slot for67; M will run the normal unmodified protected runner only after handover. Production TS remains9b130af1/artifactc4198960; no rebuild is required for this MJS-only assertion correction. T51 remains unchecked/uncommitted.

## Completed local gate, 2026-11-16 02:50 UTC

The user-approved one-line old test correction is now exercised by the actual protected widget runner, not an overlay:176/176,32 observed SQL lock waiters, provider0/natural cleanup0 in94.4s. Worker bytes match the reviewed external candidate.

The final self-check identified the planned matrix8 COMMIT-injection proof was not yet explicit. Parent authorized one MJS companion, with no productive TS change/rebuild. The real readLocked transaction keeps its canonical guards; a local wrapper adds an owned DEFERRABLE constraint failure only after the physical local Meta fetch callback. SQL INSERT returned, actual COMMIT failed and its row rolled back. Real DeliveryService/MetaAdapter recorded submission_unknown; retry made0 requests, generation0, forwarding0, receipts0, unhandled rejections0. Companion1/1 and natural cleanup0 passed. Its first missing synthetic wabaId fixture failure is preserved separately and never called a productive RED.

Full local gate is now green:552 units;91 selected native tests including default runtime/intake/router/Twilio/service admission and the additional deferred-COMMIT negative; normalProductDB48/widgetProductDB176; compiledcontracts6; checked2528/source9b130af1/artifactc4198960. The unchanged complete normal-adapter80 comparison remains69pass/11fail on both sources; it is not included as a green suite. Requests initiated before takeover may finish later; only new initiation after the committed transition is refused. Local captured transports prove order/admission, never real provider delivery/read/transcription or production acceptance.

Heavy slot was returned to root immediately after the companion. Evidence/status/proof selectors are updated before the atomic51 commit. Root owns final integration and the later independent Verifier. Future52-55 are not accepted by this gate.
