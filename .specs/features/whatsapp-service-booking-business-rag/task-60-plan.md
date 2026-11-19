# T60 implementation plan

Status: SOURCE ONLY; no imports/parser/tests/install/build/browser/resource probes, task mark or commit. Core35 owns all runtime. Dependency T58 is committed d7a3601766da1d1bcef580d57981e23fdbf78b38; T59 is already complete.

## Assumptions

- HUM-04/05/08 and T60 require server-scoped HTTP reads/commands plus existing authenticated support socket events. The real drawer is SupportChatDrawer with useSupportChat, not a useSupportDrawer hook. Its legacy optimistic path stays unchanged and is not used for WhatsApp.
- T58 owns tenant/source/role, stable cursor, epoch/client intent and true delivery DTOs. The frontend uses only its three-field context and exact routes, never a fake MerchantProfile or a caller-selected tenant/config. Existing Staff403 and Connection/Templates/Usage/products stay unchanged.
- The existing publisher emits case_updated and new_message; the existing handshake is authenticated. Add only typed subscriptions to those real frames in current useSupportSocket, without creating a server event or changing sends. Scope cleanup must not expose prior-tenant queue/socket state.
- No optimistic merchant message, automatic resend or inferred delivered/read state. Unknown response retains the same explicit client intent; reconnect performs reads only. UI/tab/drawer mounting and delivery-label presentation remain T61/T62 after the actual T60 gate.

## Files to touch

Productive: new conversation-types.ts, conversation-reconciliation.ts, conversation-actions.ts (command permission only, no T61 labels), useWhatsAppConversations.ts under pages/whatsapp-seller; new api/endpoints/whatsapp-conversations.ts; additive api/index.ts and hooks/useSupportSocket.ts.

Tests first: retain original frozen useWhatsAppConversations.spec.ts (3) and conversation-reconciliation.spec.ts (4) byte-exact. New independent useWhatsAppConversations.lifecycle.spec.ts, conversation-actions.permissions.spec.ts, api/endpoints/whatsapp-conversations.contract.spec.ts and hooks/useSupportSocket.conversations.spec.ts. Exact test inventory/counts will be frozen before any later execution.

Metadata: task-60-plan.md, task-60-evidence.json and own T60 task/check/Handoff bindings. Preserve unrelated STATE and all outputs/stamps. No T61/T62 component implementation.

## Source plan

1. Record this plan/Handoff before tests; pin/read original valid test sources. Leave the never-adopted SDK draft intact in cache: its GET body===undefined assertion overspecifies the shared client's valid null/no-body wire representation. New HTTP tests derive the actual criterion of no body/tenant selectors, not that internal signature.
2. Write new criterion-derived lifecycle tests before hook deltas: loading/empty/error, same-scope out-of-order reads, scope/selection late response fences, history cursor merge without stale metadata/status, claim race reread, reconnect/case event reads, socket/HTTP duplicate/revision reconciliation and pending unknown intent without resend. Preserve old7 cases.
3. Adopt minimal typed DTO/endpoint/reconciliation base, closed permission helper and hook. Add only current socket frame subscriptions/state cleanup and API group composition. Guard every async completion by current scope/selection/request identity; retain delivery revision truth and server command authority.
4. Source-only freeze/patch inverse; do not execute or mark. On an explicit future runtime handover, validate tasks and run all named whole Quick UI files with existing HTTP-client/socket/legacy-support companions under original guards and defaults; confirm exact actual counts, no skip/name filter. Do not run UI/browser/build now.
5. Actual Quick UI pass, post-gate self-check and focused commit are required before T61 implementation. Final feature proofs/Verifier/screens belong to Root after the last task.

## Success criteria

- Queue/detail pagination sends only supported cursor/limit/status, rejects read failures as errors, and discards late old tenant/user/selection/request responses. Loading/empty/error/disconnected/unknown remain distinguishable; existing data stays visible on a failed refresh without granting stale actions.
- Duplicate HTTP/socket messages reconcile by ticket/id/clientMessageId and monotone delivery revision. No unknown-to-delivered/read inference or automatic send retry. Real authenticated reconnect/case frames trigger canonical reads, not command replay.
- Claim conflicts reread current owner/epoch, concurrent gestures create one command, and a late action cannot reopen an abandoned conversation or leak errors into another selection. Client intent remains stable after an uncertain explicit send.
- SDK preserves exact body/epoch/client IDs, rejects HTTP failure, has no merchant/profile/config selectors; existing generic SDK/legacy support and product flows are unchanged.

## Source-ready checkpoint

The six T60 whole files declare31 cases: original3 hook+4 reconciliation remain byte-exact, new lifecycle13, permissions3, SDK4 and socket4. Proposed unchanged preservation72 in seven whole files gives Quick UI103/13 files, static only. Exact paths/hashes: `.cache/t60-source-20261118/quick-ui-selection.json`. Source-only receipt precedes all productive writes; no RED/GREEN execution claim.

Actual source includes current-scope/list/selection request fences, buffered real socket facts during initial HTTP read, monotone message revision merge, history-only cursor pagination, claim-race reread, one command in flight, no optimistic send and stable unknown client intent. Existing socket receives only publisher case_updated and gateway authenticated subscriptions, clears stale tenant state, and subscription effects rebind after authentication. A nested actual-hook composition regression and pending-close regression were written before those respective minimal source fixes.

Only API index and useSupportSocket current files have reviewed small deltas; their before bytes/patches are retained and inverse removal restores original text. No Connection/Templates/Usage/product page, legacy drawer, auth guard or API source was modified. No T61 delivery labels/drawer/presentation and no tab mounting were implemented.

T62 dependency: current Staff /auth/me and /merchants/me remain403. Three-field context58 proves no Shell/UI access by itself. T62 must mount an isolated conversation workspace using that verified minimal principal, without fabricating MerchantProfile/business mode/plan, unlocking configuration or inheriting private Shell effects. Record this as future composition, not T60 visual acceptance. C27/C30 end-to-end proof bindings remain later criterion-closure work; this source checkpoint settles no feature criterion.

Next step only after explicit runtime handover: actual whole Quick UI103 and required deterministic validators under the existing guard, with no name filter/skip. No import/parser/install/test/compiler/browser/OS or resource probe/commit was run in this source window.

## Source-backed uncertain HTTP-success regression before any fix

Root found that command(send) deletes the pending client ID after every fulfilled DTO, including HTTP200 delivery.status=unknown. The next manual retry for the same text then gets a new ID and can create a second physical intent. HUM-05/HUM-07 and External dependency failure forbid duplicate provider action for uncertainty; current canonical send command deduplicates exactly by ticket/clientMessageId and returns its original persisted projection.

Add only independent `useWhatsAppConversations.intent-lifecycle.spec.ts`. Compose the REAL hook and REAL whatsappConversationEndpoints/dashboardJson with a synthetic HTTP transport returning200 DTOs, never a fake rejection/missing-module RED. Cases: unknown200 retains ID on manual same-intent retry; queued200 retains ID while pending; reconnect sends no command; an authoritative delivered/read fact permits a later intentional new send with a new ID. Existing31+72 whole-case files stay byte-exact. No productive source fix in this window; the next coordinated runtime must execute this whole file against the current real module and preserve the causal RED before any fix.

Proposed minimal policy for review: keep unresolved original intent for queued/unknown (and conservatively accepted until an authoritative resolved disposition); settle only the matching current-scope/ticket/client ID after canonical terminal facts. Never clear a pending key merely because the HTTP Promise resolved. Reconcile by the existing merged revision rather than a stale raw event, preserve scope/epoch/ownership fences, and do not resend automatically. Delivered/read are unambiguous resolved outcomes in the new positive control. Definitive failed is source-classified as not-started/provider-rejected, but no new failed-retry UX decision or implementation is made here.

## Authorized source repair after exact causal RED

Root accepted actual whole3 causalRED (receipt7f85df18/rawc6cc9db6, unknown/queued ID comparisons only; delivered/read control passed). The prior conservative suggestion to retain accepted until read is superseded: classifyOperatorSubmission returns accepted only after a started submission has a provider message ID; failed means not_started/provider_rejected. These are resolved submissions, without changing delivery to read.

Before the fix, add one independent control inside the causal whole file for accepted/failed facts arriving through real SDK GET/backfill. Preserve the prior three case bodies/expectations byte-for-byte and all previous103 cases. Then change only private hook bookkeeping: pending Map<string,string> holds only its original client ID. The existing stream ref mirrors the messages array produced by mergeConversationMessages; no second status ledger or revision algorithm is introduced. Keep queued/unknown/missing facts; settle only matching current-scope/ticket/text/client ID whose reconciled status is accepted/delivered/read/failed. Observe HTTP response, socket and canonical history reads; no private error-code decision, new endpoint or new UI. No SUT during Core's stock window. Next authorized window: whole causal4 GREEN, then original103 once, never a redundant aggregate107 replay.

## Minimal repair source ready, execution pending

Only the hook changed productively after the causal RED. The independent accepted/failed control was added first; removing that control and its new fixture method restores the entire original causal3 bytes. All original103 test files remain byte-exact. Current hook SHA2dfa6105, causal4 SHA60b9e09a; exact patches and inverse patches are in `.cache/t60-intent-causal-20261118/`. No Green execution, compiler, browser, resource probe, task mark or commit occurred. Core owns SUT. Next coordinated window: whole causal4, then original103 once.

## Local Quick UI acceptance

T60 passed107 distinct cases on the exact current source:65 in12 whole files retained from the original103 invocation,38 in the unchanged legacy support page under its original5s deadline, and4 causal intent cases in their separate whole-file run. Receipts are recorded in task-60-evidence.json. The previous5s import timeout and causal RED remain recorded; the subsequent38 pass establishes no repair or cause of the earlier delay. No test, timeout, preload or source changed between these runs.

Post-gate review confirms criterion-derived state/DTO assertions, tenant and async fences, canonical revision/ID reconciliation, no duplicate uncertain send, no optimistic read/delivered and preservation of existing72 cases. No cases or assertions were removed/weakened. Runtime returned to Core immediately after the runner. Task60 can be marked before its focused local commit; STATE and outputs remain excluded. T61/T62 visual mounting and final feature proofs remain pending.
