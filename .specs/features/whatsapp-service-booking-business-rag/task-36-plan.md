# T36: Reconcile late payment without a false appointment

## Assumptions

- T35 is committed in169efb8a and Root0908c0fe also contains committed60; current HEADc20a94c5 adds the parent's approved timezone planning documents only. Existing persisted PaymentIntent approval is financial authority; webhook payloads, model messages and mutable carts are not.
- A failed canonical capacity admission leaves the real approval intact. It creates one tenant-scoped merchant inbox notification and durable outbox fact, never an invented appointment, additional charge or automatic refund.
- Existing T35 approved AppointmentPayment rows are reused. A mixed or discounted financial allocation review must report the actual current booking state; it cannot call a successfully scheduled appointment unconfirmed.
- Regularization identity is stable per merchant/payment/order/unit. Once routed to human resolution, duplicate events do not silently retry booking against a later slot or hold generation.
- Only a current persisted outbox claim can clear a WhatsApp execution frame for financial reconciliation. The existing dispatcher runs registered handlers sequentially; direct in-memory publication can run siblings concurrently. Missing completed order is a durable retry, not a false success.
- This window is SOURCE ONLY. No imports, tests, compiler, runtime, resource probes, task status, index or commit. Parent exclusively owns spec/tasks/STATE/context while refining the already approved timezone plan. Existing UTC fixture/history and all accepted oracles remain unchanged.

## Files

1. This plan.
2. apps/api/src/modules/payment/application/reconcile-service-payment.use-case.spec.ts (criterion-derived component tests FIRST).
3. apps/api/tests/service-late-payment.integration.spec.ts (real SQL/Redis/canonical admission, tenant inbox and rollback FIRST).
4. apps/api/tests/service-late-payment-dispatch.integration.spec.ts (real persisted claim/dispatcher, replay/disable-inflight FIRST).
5. apps/api/src/modules/payment/application/reconcile-service-payment.use-case.ts (minimal command and existing bus subscription).
6. apps/api/src/modules/payment/payment.module.ts (add one provider/import only).
7. apps/api/src/modules/payment/application/reconcile-service-payment.current-state.regression.spec.ts (source-review causal tests before a proposed replay-state correction).
8. apps/api/src/modules/cross-sell/infrastructure/repositories/prisma-normal-commercial-benefits.spec.ts (complete the existing typed CheckoutSession fixture ABI only).
9. apps/api/src/modules/revenue-manager/infrastructure/incentive-coupon-binding-boundary.spec.ts (same nullable fixture ABI only).

No new schema, table, queue or framework. Original P packets are read-only prototypes, not accepted runtime evidence. Their test-first receipt records actual0. Current protected shared fixture5d6 and T35 stock/origin fixtures remain unchanged.

## Required behavior and tests

- BOOK-06: late approved payment with expired original lease, occupied capacity or disabled admissions keeps exact persisted payment evidence and emits one visible human-regularization receipt without creating capacity or charging again.
- BOOK-08: actual tenant/session/provider/currency/amount approval is reread; unknown/pending/failed cannot become approval. Repeated or concurrent events cannot duplicate appointments, balances, notifications or event receipts. Existing moved/terminal appointments are never revived or moved back.
- REG-04: started payment processing continues after new admissions are disabled. An already confirmed appointment remains confirmed even if its old Redis hold expires or the feature is disabled.
- Reuse canonical reserveProfessionalOrderUnit and its savepoint. Unexpected SQL/Redis errors propagate for durable retry; a real business refusal becomes regularization only after the unit savepoint rolls back.
- T36 does not introduce an allocation policy or another payment balance. It reuses T35's approved per-unit balances, including multiple units and provider-fee evidence. A linked manual obligation that cannot be promoted is flagged for regularization without inventing an allocated receipt or changing its original amount.
- A pending manual appointment is adopted only by the existing immutable payment continuation. When it cannot be promoted, the linked real payment evidence and visible regularization retain its actual identity; no coordinate/name matching or fabricated buyer owner.
- Full native proof must include real Redis expiry/generation, occupied merchant/professional lock race, repeated claimed webhook event, claim loss/forgery rejection, handler replay, SQL notification/outbox rollback and clean redelivery, owner inbox visibility and foreign denial, no physical inventory/delivery/payment-provider side effects.

## Gate inventory

Source-only inventory, executed0. The three new whole files contain29 static cases: component10, late-payment SQL/Redis/HTTP12 and producer/claim/served-worker7. Tests were initially written before production; the later pre-execution source review aligned the new Redis get fixture with its existing undefined ABI and added end-of-work claim rollback/replay. No accepted test changed.

The first proposed small window is the WHOLE new component10 plus existing payment.module.spec.ts1,11 total, under fresh1024 and the original loader/network/concurrency/defaults. This is a proposal, not a dispatched or executed gate.

Full36 minimum selected components38: new command10, module1, unchanged PaymentDispatchService8 and Asaas webhook19. Selected natives51: new12+7, current35 manual-continuation9, approved-order8, approved-completion5, stock5 and origin5. Normal48/widget176 complete the proposed313 total. These are static counts pending actual runner summaries. No name filter, skip or unrelated capacity-scope replay is proposed;35's remaining accepted capacity/history receipts stay historical, with source identity.

Full36 requires own current API lint/types/standard capture/build/record/admit; own1668/ed20/2585 is STALE after the new source. No borrowed M output or stamp. Original guards remain1024 small/lint/record/admit,5168 types/capture/build and2048 native/products, PG PID128, native600s/preflight150s/boot110s and original product heaps/deadlines. First error/refusal stops and returns runtime. No execution or task closure is claimed by this plan.

## Future obligations

T37 local attendance receipt, T38 channel projection and T39 truthful presentation remain separate tasks. T41 must call the tested manual preparation helper before its real public payment dispatch and project private audit data. Global BOOK-08/final verification remain open. Parent owns the separate fixed-Brasilia refinement for all NEW schedules, preserving history; this task does not rewrite existing times.

## Source review after the first small gate

Authorized whole command10 passed10/10, natural0/no skip/fail/cancel, receipt441ca805/rawc1954556 under fresh6197>=1024. No other gate ran; own1668/ed20 remains stale. Parent owns the next runtime window.

The prior-notification branch currently returns frozen bookingConfirmed/appointmentId as the current command result. The fresh branch reads current appointment state. After a later legitimate cancellation or resolution these disagree. Add a separate whole causal file4 (root+3) before proposing a minimal production hunk. It asserts current tenant/order/unit binding or the original linked manual ID, with notification/outbox/payment receipts unchanged. The original accepted10 test bytes remain unchanged. No production correction or causal execution is authorized by this source review. The proposed full inventory becomes317 only after this pending regression/correction is genuinely gated; the prior313 count is the initial inventory.

## Final ownership serialization proposal

The exact current-state patch6165021f was applied only after the original whole4 failed in the three expected bookingConfirmed assertions. Current whole10+4 then passed14/14 with natural0/no skips. Receipts and the original RED remain in .cache/t36-replay-current-state-review-20261119/. No native/build/product proof exists yet.

Source review identified a remaining logical interval after the final clock read and before COMMIT. Existing claimBatch only reclaims expired rows, heartbeat renews the same token and completeHandler already fences its acknowledgment. No duplicated payment or legitimate pre-expiry reclaim was demonstrated. The proposed local fence locks the eventId+merchantId row ONLY immediately before the existing final assertClaim, then rereads token and clock. Admission and its Redis/SQL IO retain an unlocked heartbeat.

Write one additional integration child FIRST in the existing dispatch native file. At the initial claim checkpoint a second real SQL connection acquires FOR UPDATE NOWAIT and successfully runs the existing renewClaim, proving admission leaves renewal available. After the final clock read the second connection must receive real55P03 lock exclusion. The test also asserts uncommitted notification invisibility, one durable notification/event and the same current owner after release/commit. The pause observes existing query completion without changing query arguments, clock, budget or assertions; it is not the proof itself. It does not fabricate a legitimate reclaim before expiry. No production fix or SUT execution is authorized in this source-only step. The proposed native file becomes8 cases and total inventory318 after this extra case is eventually gated.

The parent's later technical dispatch authorized only exact47609a42. It was applied once SOURCE ONLY,55c65e1a to9a4425e6, after the integration proof was written. Receipt .cache/t36-final-claim-lock-review-20261119/approved-applied-receipt.json records its inverse and untouched14/35pins. No RED is claimed for this fence and no duplicated financial effect was demonstrated. Its real SQL proof remains pending. Final independent mutation must remove this final row lock and be killed by that proof.

Current Full inventory is318 static tests: five whole components42 (newcommand10, causal4, paymentmodule1, PaymentDispatch8, Asaas19), seven whole natives52 (late-payment12, dispatch8, manual-continuation9, approved-order8, approved-completion5, stock5, origin5) and normal48/widget176. The earlier14 GREEN applies to source before this final fence and is retained with that provenance; tests are unchanged. Current fence/source has executed0. All35 original source pins remain byte exact. Own1668/ed20 is stale. API lint/types and one genuine own standard capture/build/record/admit are required before native gates. Nothing runs until the parent explicitly returns runtime from M and dispatches Full36.

## Actual current Full execution inventory correction

After the parent's Full dispatch, all five current whole component files exited naturally0 with no failure/skip/cancel:10+4+1+8+66=89. The Asaas file generates47 additional cases (2 token cases,4 events times9 identity cases,3 provider cases and6 lookup cases) beyond its19 column-zero test declarations. Its actual66/66 is accepted directly from the unchanged whole-file raw, not rerun or relabeled as19. Original count-mismatch receipt32e13eb1/summary41d8b97c remain preserved; this was inventory metadata, not a failing test or changed oracle. Current Full expected total is365=89components+52native+224products. No source/test changes were needed for this correction; source9a4425e6 and every35 pin remain unchanged.

API lint passed68e8e54c. API types then produced TS2739 in the two existing typed fixtures listed above: both omitted the nullable serviceOrigin/serviceOriginProof fields already present in the deployed Prisma schema. Original type receipt67a15ea0/wrappered23005f remains preserved. Complete only those fixture objects with explicit null/null, matching unproven historical checkout reads. No assertion, case, financial amount, clock or productive API source changes. Archive original/candidate/diff/inverse, run the affected whole files (normal commercial22=12+6+4; incentive boundary27=3+4*(1+5)), and rerun required lint/types after this real compiler-input repair. Preserve the already accepted89 without replay. Proposed current Full becomes414=138components+52native+224products if these actual affected49 and the remaining gates pass. No own capture/build has run yet, so this does not repeat a completed compiler build.

Actual affected whole files passed30+27=57, natural0/no failures/skips/cancellations. Normal commercial contains8 further generated rollback/version/money cases beyond the initial22 estimate; its original count-mismatch receiptbcd1f7d9 remains preserved and the same raw3565cfc4 proves all30 passing. Incentive boundary actual27 matches its enumeration, receiptd10889e8/rawd06951c5. No affected file was repeated. Current accepted components are146=(89+57), and Full expected total is422=146+52+224. Parent requested explicit runtime handback after the headers/own checked build and BEFORE the first native, to run an independent UI/browser window. T37 remains read-only until36 is actually gated and committed.
