# T58 implementation plan

Status: local Full gate passed; task marked before focused commit. Dependency T57 is committed1505e48b and committedT34 safely alignedff91. The initial source-only plan and execution history below preserve the original boundaries and evidence.

## Assumptions

- Approved HUM-04/HUM-07/HUM-08 require a WhatsApp-only queue for the existing owner/admin/staff roles in both business modes. Tenant and current membership come from the existing authenticated principal. No request body/query chooses tenant, channel or role.
- Existing claim/send/close commands remain authoritative for assignment, expected epoch, channel/window, delivery and duplicate prevention. This task adds routes and safe read projections.
- Staff must keep HTTP 403 on /merchants/me and /auth/me. The operator bootstrap is only merchant_id/user_id/role, without a fake MerchantProfile, plan grant or configuration access.
- Current SupportModule retains notification settings and all modern providers. Existing runtime, Meta intake, RAG factories, tenant/auth guards and T109 fences are not replaced by cached snapshots.

## Files to touch

New tests, written before productive files (unchanged frozen source hashes in .cache/t58-source-adoption-20261118/selection.json):
- `apps/api/src/modules/support/application/read-whatsapp-conversations.use-case.spec.ts`
- `apps/api/src/modules/support/application/read-whatsapp-conversations.snapshot.spec.ts`
- `apps/api/src/modules/support/application/whatsapp-conversation-projection.spec.ts`
- `apps/api/src/modules/support/application/whatsapp-conversation-context.spec.ts`
- `apps/api/src/modules/support/application/whatsapp-conversation-context-guards.spec.ts`
- `apps/api/src/modules/support/presentation/http/whatsapp-conversations.controller.spec.ts`
- `apps/api/tests/whatsapp-conversations.integration.spec.mjs`
- `apps/api/tests/whatsapp-conversation-snapshot.integration.spec.mjs`
- `apps/api/tests/whatsapp-conversations-unavailable.integration.spec.mjs`
- `apps/api/tests/whatsapp-conversation-context.integration.spec.mjs`

Productive files:
- `apps/api/src/modules/support/application/read-whatsapp-conversations.use-case.ts`
- `apps/api/src/modules/support/application/whatsapp-conversation-projection.ts`
- `apps/api/src/modules/support/application/whatsapp-conversation-context.ts`
- `apps/api/src/modules/support/presentation/http/whatsapp-conversations.controller.ts`
- `apps/api/src/modules/support/support.module.ts` (minimal additive hunks only)
- `apps/api/src/modules/support/presentation/http/support.controller.ts` (minimal additive hunks only)

Task metadata: task-58-plan.md, task-58-evidence.json, tasks.md (own T58 Gate, applicable checks and actual Handoff), and spec.md traceability only after a passed gate. Existing unrelated STATE.md handover stays uncommitted. No frontend changes in T58.

## Implementation

1. Pin and read selected frozen tests. Write all ten tests before productive files; retain all assertions and cases unchanged. Source-only restriction means no RED execution claim.
2. Adopt v2 RepeatableRead reader and snapshot cases, whitelisted message DTO, strong three-field context and command controller. Register only new reader/controller in current module. Add the context route only to existing SupportController so the URL has one decorator.
3. Record exact patches/inverse proof for both existing files and a source freeze. All existing tests and production guards remain byte-exact. Conservative own API artifact becomes stale after TypeScript adoption.
4. After an explicit runtime handover, run execute validator, affected whole unit files, fresh own checked API/lint/types, all four whole HTTP/SQL files and relevant existing command/auth/support preservation plus normal48/widget176. Use original child guards, heap, deadlines, provider trap and natural cleanup. Stop the first failure/refusal. No exact-name filter, skipped tests, foreign cleanup or borrowed outputs.
5. Close T58 metadata and commit only after the actual Full gate passes. Screens and final feature proofs/independent Verifier remain later tasks/Root.

## Success criteria

- Server-scoped list excludes foreign, non-WhatsApp and merged support; deterministic cursor pagination; ticket/binding/history are one RepeatableRead snapshot under concurrent canonical close.
- Detail/command responses expose actual allowed delivery status/revision with no credentials, original authority, provider account/attempt or inbox lease. Invalid stored facts produce a failed read, not empty success.
- Actual signed owner/admin/staff membership in products/services gets only its own minimal DTO. Machine keys, missing/disabled membership, tampered session and caller-selected authority cannot gain access. Staff private profile/configuration permissions stay denied.
- Actual served claim/send/close reuse original assignment/epoch/client-intent rules; replay does not resend, ordinary support still works, offline channel does not grant command authority.
- Proposed new cases: 24 unit cases across six files and 25 native cases across five files, static counts only until executed; exact gate inventory/counts will be recorded before execution. All previously accepted receipts remain historical proof for their original program.

## Source review gap closure before runtime

The original ten frozen tests stay byte-exact. Add `apps/api/tests/whatsapp-conversation-availability.integration.spec.mjs` as an independent root plus three cases: actual empty queue and merged-ticket exclusion; actual offline/disabled channel detail with no mutation or delivery promise; actual message-history cursor paging and malformed-cursor rejection. These are existing T58 Done when cases, not new product requirements. Source is still unexecuted while Core34 owns runtime. No productive change is proposed for them before a failure.

## Exact source-ready gate inventory

Affected whole Quick51/13 (24 new static and 27 existing static), native56/9 (25 new static and 31 previously measured), normal48/widget176. The complete path inventory is `.cache/t58-source-adoption-20261118/gate-selection.json`; every count must be confirmed by real execution. No execution, admission or current build is claimed. T58/C26/C29 proof bindings now name actual whole files; C30 visual tab proof remains the responsibility of its later UI task.

## Dedicated-route source boundary repair (tests before implementation)

Root source review proved a concrete HUM-04 channel-isolation hole: the dedicated WhatsApp messages route currently calls generic SendTicketMessageUseCase.execute, whose non-WhatsApp branch writes ordinary support. A same-tenant widget ticket can therefore be mutated through this new endpoint. A controller pre-read alone would race.

Add independent `apps/api/src/modules/support/application/send-ticket-message.whatsapp-source.spec.ts` and `apps/api/tests/whatsapp-conversation-source-boundary.integration.spec.mjs` first. Assert dedicated non-WhatsApp/alias refusal with no persistence, retain canonical locked WhatsApp source authorization, and prove the existing generic route still handles widget messages. Frozen original tests remain unchanged. The minimal planned producer change is a server-owned optional requiredSource=whatsapp in TicketMessageServerContext, checked against the canonical direct ticket before entering legacy persistence; WhatsApp still enters the existing locked authorizer. The body cannot set this capability.

Files added to this task's productive scope: existing `apps/api/src/modules/support/application/send-ticket-message.use-case.ts` (one optional server-context field and required-source rejection), and the already selected dedicated controller (explicit server-owned flag). Root review is pending for the frozen controller unit's exact expected second argument, which currently contains only principal; do not silently alter that expectation. Runtime remains Core34 only.

## Source-boundary checkpoint

Three additional unit cases and three real-HTTP cases are now written. The minimal source-only requiredSource fix is prepared. All ten original frozen test files are unchanged. One literal context expectation has a review-only correction at `.cache/t58-required-source-expectation-review-20261118/proposed.patch` (d4de5b26), not applied. Current proposed total: Quick54/14, native59/10, normal48/widget176. Earlier 51/56 inventory is historical before this proven channel-boundary fix. Execution0; no RED/GREEN claim.

## Actual partial execution after committed T34 alignment

Root safely aligned committed ff91a61c while preserving all T58 source and unrelated STATE. Authorized execute validator returned0. Thirteen whole Quick files passed49/49 with zero failed/skipped/cancelled/todo; every child natural0 and original fresh1024 admission, minimum5213MiB. The entire controller test file remains outside this scheduled partial gate because its one context expectation is awaiting user approval, original6c8e exact. No name filter/skip or Full claim. Receipt `.cache/t58-partial-quick/2026-11-18T22-00-25.779Z/receipt.json`, SHA1d74fe66. Runtime explicitly returned to Root after own launcher25868 absent; no native resource created. Compiler, capture, lint/types, native and product gates remain unstarted. Full T58/commit pending.

## API headers accepted, first unstarted capture refused

Independent invocation22:15Z passed API lint0 and types0 naturally. The next fresh admission for original capture required5168MiB and observed3779MiB at22:16:09Z, so the child did not start. Receipt8aa3ef9c at `.cache/t58-independent-gates/2026-11-18T22-15-01.466Z/receipt.json`. Freeze46/STATE/controller original were exact; own launcher47172 absent, only lint51188/types41388 children natural0. Runtime explicitly returned to Root, no retry/probe after handback. Preserve49/13 and both headers; any later separate resume begins only at the still-unstarted capture. No build/record/admit/emitted snapshot/native/products claim. User-pending one-field controller expectation unchanged; T58 remains incomplete.

## Actual own build and first native RED

The coordinated resume admitted capture7354/build7266MiB and completed actual capture/build/record/admit0, checked2582 inputs d1ff6ff1/artifactfdb58146. The actual emitted2674 JS/JSON manifest18e43d05/hashdd793622 is preserved before either pending expectation correction. First whole served queue file passed8/8. The next whole snapshot file ended natural1, one child passed and the detail child/root failed (1pass/2fail,0skip): old history already has the fixture's system claim message, while the frozen oracle expects0. Ticket/binding old human/epoch2 assertions and concurrent list passed. Root-cause source refs: fixture48-51 calls claim; canonical claim52-54 writes system; close110-113 writes another. New current count2 is source-derived and not yet executed.

Review-only patch8f6208dd changes only counters0->1 and1->2, preserving all other assertions/cases/cleanup. It is NOT applied. The controller d4de5b26 review remains separately pending. Original RED receipt4b5a5ef8/raw518a3491 retained. Launcher50796 checked absent, all children ended, test finally returned without a cleanup error. Runtime explicitly returned to Root; no further probes/retries. Remaining8 native files, products and controller5 unstarted. T58 remains incomplete.

## Independent remaining-eight admission refused

First fresh2048 admission observed1829MiB at22:26:46Z and refused before any child or artifact/emitted recheck. Receiptbc564632 records children0. Own launcher47556 absent, runtime returned to Root, no retry/probe. Previous passed scopes retained without repetitions; no current admission or new native/product claim. Both review patches untouched and T58 incomplete.

## Both exact test corrections approved and controller validated

Root applied the user's exact controller d4de5b26 and snapshot8f6208dd approvals once. Never ask again. Whole controller5 passed5/5 natural0 and current API lint passed0. The next first-unstarted types admission required5168MiB and observed759MiB, refusing before child. Receipt1404cf95 preserves this attempt. Own launcher45244 absent and children26112/23168 natural0; runtime explicitly returned. No captures/build/native/products started. Retain prior Quick49 as its own accepted cohort, without a fake fresh54 claim. Own d1ff/fdb5 is stale after the approved TS assertion change;2674 emitted baseline remains preserved for real rebuild/comparison. Only a separate coordinated first-unstarted types resume can proceed.

## Local Full result

PASS337 distinct cases: Quick54, native59, products224. Retained49 and queue8 keep their original receipts; actual2674 emitted bytes were proven identical after the exact user-approved test-only corrections. Current own checked build is d311f3b6/6158e16a/2582, final admit after widget0. No test was skipped/deleted or assertion weakened. Original RED and refusals remain preserved. Full summary and exact log/receipt hashes: `.cache/t58-final-review-20261118/full-gate-summary.json` and task-58-evidence.json. No production/provider proof, UI acceptance or final feature verification claim. Focused24-file commit excludes the unrelated dirty STATE and all outputs/dependencies/stamps.
