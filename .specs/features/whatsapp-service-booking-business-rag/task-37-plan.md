# T37: integral local attendance receipt

## Assumptions

Dependency T36 is committed b8e9ea604dc61a0647c00a2f90e89f2a98ba1c44 after actual Full422. User call_917429d4418143408cc57e769332d11b: "Registrar somente a quitação integral do saldo". Scope is the current persisted local AppointmentPayment obligation; its initial requestFingerprint is identity, not current price after authorized rescheduling. A receipt does not prove PSP confirmation or attendance. Parent owns STATE/context/design/spec/tasks/index and current M runtime; this step is SOURCE ONLY.

## Files

- This plan.
- New `apps/api/src/modules/operations/application/record-attendance-receipt.use-case.spec.ts` and `apps/api/tests/service-attendance-receipt-http.integration.spec.ts`, written before production.
- New `apps/api/src/modules/operations/application/record-attendance-receipt.use-case.ts`.
- Existing `apps/api/src/modules/operations/operations.module.ts` and `presentation/http/service-appointments.controller.ts`, only one provider/import/route composition.

No schema/table/provider/stock framework, no existing assertion changes. Actual HTTP/DI proves controller/factory composition. Existing privacy, manual, attendance, cancellation/reschedule and financial/product regressions remain in the Full inventory; exact unfiltered selectors/counts are frozen after source is ready and before execution.

## Command and invariants

Strict command: appointmentId (path only), paymentId, expectedPaymentVersion, amountCents, currency, paymentMethod and commandId (stored idempotency key). Actor/merchant/time/provider flags never come from the body. Positive safe integer cents within SQL Int; normalized bounded method; uppercase currency. Return only receipt/local payment projections.

Freeze actor/command before awaits. Existing effect fence precedes merchant lock/service administration, professional/appointment lock and exact selected financial row lock. Read receipt/audit identity before stale-current-version rejection so original replay returns its immutable receipt plus current payment facts without changing operational state/version. Changed same-key payload or another command's audit is a conflict.

New receipt requires the supported pending local obligation with no PSP linkage, exact financial version, valid historical same-currency local receipts and exact remaining cents. Partial/overpayment/zero are rejected. Current balance after an authorized reschedule controls amount; do not call old creation-fingerprint validation or catalog price. Historical imported partial receipts may reduce the outstanding balance; this command never creates a new partial receipt. Already settled another key cannot settle again. Current admission toggle/payment policy does not rewrite the historical local obligation.

One transaction writes immutable AttendanceReceipt, financial-only CAS/version/status, an attendance_receipt audit at current appointment version, and compact `service.payment.recorded_at_attendance` outbox payload with appointment/payment/receipt identity and versions. Use the server/database clock after reads/locks. Operational appointment row, lease, buyer/customer, external payment/provider/order/stock remain unchanged. T38 owns delivery; no inline notification.

## Tests first and gates

Component proof covers exact fields/time/audit/event, all operational states unchanged, same-key replay after later transition, identity conflicts, current repriced balance, historical receipts, input/role/mode/version/online negatives, CAS and modeled rollback. Real HTTP/SQL covers owner/admin, authenticated source, server clock, concurrent same/different keys, current reschedule then catalog change, strict partial/over/invalid inputs, foreign route/body/opaque IDs, Staff/anonymous, actual SQL failure rollback and clean retry, historical receipts and no physical/PSP effects. JSON null uses raw HTTP because the parser may reject before authentication/audit; existing fixture stays unchanged. Foreign body merchant is403, not400.

Parent grants all SUT windows separately:1024 small/lint/record/admit,2048 native/products,5168 types/capture/build; original budgets/heaps/no-skips/network/owned cleanup preserved. Write tests, then minimum source; report honest static inventory/pins before any execution. Actual Full and Root metadata review precede task37 marking/focused commit. Only then38, then39, each separate gate/commit. Existing order financial receipt is distinct from the future canonical booking notice, including gross fee truth; no duplicate/inaccurate booking copy is introduced in37.

## Source ready, runtime not executed

Initial tests-first receipt covers18 component and13 native cases before production. Root then requested one additional independent same-key/second-valid-obligation case before SUT; removing only that new body restores the original component bytes/hash. Current static cohort is19 component +13 native =32. Every original test body/assertion is preserved. Native201 precondition was applied once by Root under call_7c50b1827d2648748b894122500479e0; approved native SHA a5638d06. Executed0; no imports, compiler, tests or probes by this child.

Quick candidate is the WHOLE unfiltered component file under the existing network guard/ready-prod loader, concurrency1, original1024 admission. Native candidate is the WHOLE unfiltered HTTP/SQL file under the unchanged local disposable runner and2048 admission, only after a real current-source own build/header at fresh5168. The old formal task filter ^T37$ does not match the descriptive root title; Root must use the full file or correct its selector before claiming a gate. Source freeze and hashes are in .cache/t37-source-20261119/source-ready.json. No code/tests38/39, provider, stock, delivery, new schema or root metadata/index/commit edits.
