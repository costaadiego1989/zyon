# Phase 2 preparation

Worker: service_company_ui. Branch: feat/service-company-ui-20261114. Base: ae2cb48e7. Local implementation only. T9 is the first gate/commit barrier; parallel-execution.md supersedes the old phase ordering.

## T10

- Assumptions: commercial mode is exactly products or services, independent of segment and plan. Both email signup and pending OAuth completion require the explicit choice. Resume preserves only the commercial choice in session storage, never a password.
- Files: SignupWizard.tsx, AuthScreen.tsx, main.tsx, api/types.ts, signup-experience.css, companion SignupWizard.spec.tsx and browser coexistence spec/setup as needed.
- Success: accessible native exclusive selection, required choice, matching signup and completion payloads, retained choice after error/reload, both modes persisted by the local API. Vitest and genuine local browser proof before commit.

## T11–T16

- Assumptions: actor and merchant are server-authenticated. Policy CAS uses expectedVersion; mode change checks canonical records before mutation. Canonical public About is company.description (1200), omission preserves and empty string clears. Private owner email is never a public-contact source.
- Files: policy controller/use cases/module and companion tests; existing merchant/settings repository and both settings writers/controllers/DTOs; shared company mapper; existing company hook/page and companion tests; local HTTP/browser fixtures. Confirm each task's exact files before editing.
- Success: actual AppModule/owned SQL response, persistence and rollback tests per HTTP task; About roundtrip through both API families and public-api/settings alias; form load/save/clear/error and local screenshots; sequential per-task gates and atomic commits after T9. No final verifier or global proofs by this worker.

## T11 implementation plan

- Assumptions: absent policy has version0; updates require expectedVersion and explicit hold/payment. Admission defaults disabled unless explicitly requested. Mode and role are independent guards. Existing platform plan authorization is preserved; modality does not grant subscription access.
- Files: new service-business-policy.controller.ts/spec.ts, new configure-service-business-policy.use-case.ts, new service-business-policy-http.integration.spec.mjs and service-company-http-fixture.mjs; MerchantModule composition only after T9/T10 gates.
- Success: invalid input/actor/tenant/products/review/stale cannot mutate; four hold/payment combinations persist exact values and CAS increments; concurrent updates have one winner; failed audit rolls back policy. Real HTTP AppModule and SQL evidence, zero external calls/skips.

## T12 implementation plan

- Assumptions: food is a product. Pending/scheduled/in_service appointments conflict with changing to products; completed/cancelled/no_show history stays intact and can reconcile after a permitted change, per T7/T8 and root review. A checkout with items remains active until completed or explicitly abandoned; a nonexpired storefront cart also blocks a cross-mode change. Pending/requires_action are the canonical open PaymentIntent statuses.
- Files: new change-business-mode.use-case.ts/spec.ts, new business-mode.controller.ts, new service-business-mode-http.integration.spec.mjs. Module registration only after prior task gates.
- Success: merchant FOR UPDATE precedes all facts and CAS; active physical/digital/food/service offers, appointments, active checkouts/carts and payments reject with no mutation; completed/abandoned checkout and terminal finance remain intact; stale CAS/foreign actor and audit failure roll back; valid transition audited with admissions disabled.

## T13 implementation plan

- Assumptions: company.description remains the sole public introduction. Raw text longer than1200, null, arrays and objects are invalid. Trim surrounding whitespace; empty clears. A canonical transaction reads and merges under the merchant lock; omitted fields are never copied from an administrative profile or login records.
- Files: new company-settings-write.ts, new update-merchant-theme.use-case.spec.ts and service-company-about-write.integration.spec.mjs; later wire existing two writers/repository/public alias after T9. Existing theme/policy behavior is preserved.
- Success: both writers and /settings/store reject invalid input without writes, preserve omitted company/address/settings fields, clear explicitly, and atomically create company source work without graph/provider calls. Same content is idempotent; forced outbox error rolls back all fields.

## T14 implementation plan

- Assumptions: the canonical company read allows only published business fields. Merchant name can supply the existing legal-name fallback; login-user email never supplies public company email. Administrative settings retain their existing surrounding fields, and the public alias retains snake_case names.
- Files: new company-settings.mapper.ts/spec.ts and service-company-about-read.integration.spec.mjs; later integrate the two existing readers plus public settings mapper/response DTO.
- Success: description roundtrips including empty string in all API families, aliases retain previous fields, nested private canaries omitted, no user auth query/fallback needed.

## T15 implementation plan

- Assumptions: the existing form edits the canonical public introduction. Only changed company fields are sent, including an explicit empty description, so a concurrent omitted email/address/policy is preserved. The returned canonical description confirms save.
- Files: useStoreSettingsPage.ts and companion useStoreSettingsPage.spec.ts. No dependency additions; React createRoot/act and the already installed Vitest jsdom environment exercise the real hook.
- Success: actual hook loading/hydration, exact minimal payload, save/clear/reload/error retention and read retry; unchanged fields and other tabs omit About.

## T16 implementation plan

- Assumptions: reuse the company tab and existing FormTextarea. Public-use guidance and a1200 limit are visible and associated with the field. No RAG central or service-management page is added here.
- Files: CompanyAboutField.tsx, store-settings-page.tsx, companion store-settings-page.spec.tsx, a separate service-company-about.spec.ts browser file and its fixture plugin; configuration registration after T10.
- Success: focus/typing/limit, actual local API save/reopen/clear/error and desktop/mobile screenshots. Unit component gestures supplement the real existing company-page browser flow.

## Context

Read approved spec, design, context, tasks, execution amendment, source-review notes and tlc Execute/coding principles. validate_tasks --execute: 0 errors, preexisting T4 granularity warning. Impeccable product guidance applies to existing product components; root confirmed reuse of approved design and existing components without PRODUCT.md setup/update.

## Preparation checks

- T10:25/25 unit/transport tests, zero skips. Browser pending.
- T11: initial unit could not load the ungenerated local PrismaClient; after allowed offline generation,4/4 pass. No HTTP gate yet.
- T12:3/3 unit pass. Full HTTP/DB pending. Root clarified completed/cancelled/no_show history is compatible; negative scheduled case and a historical-preservation case are prepared.
- T14:3/3 mapper unit pass. Full HTTP/DB pending.
- T15: RED showed missing description hydration; real hook jsdom then passed1/1 including save/clear/error/reload and omission of concurrent fields.
- T16: the new preparation test incorrectly expected16 characters for a17-character fixture. Root approved correcting that arithmetic on the unpublished test;1200 limit and all behavior assertions remain. Browser and screenshots pending.

## T10 gate

T9 fast-forward15e6957d019e8d7c9001da7bc11b7c54fc269f24 completed without conflicts. Future preparations are byte-verified outside the checkout at C:/tmp/zyon-service-company-preparation-20261114. T10 final browser1/1 and unit25/25, zero skips. The first OAuth seed failed on a nonexistent merchant_users.name column; the second replaced owner_name while setting pending flags. Both fixture defects were corrected using the real /auth/me writer and a JSONB flag merge. Assertions were preserved. Product/service captions now use the existing primary text token after visual review. API build artifacts were copied independently from clean T9 and verified by unchanged assertServiceArtifacts; no new API build is claimed.

## T11 gate

Unit4/4, API typecheck/build0 and checked coverage2488sources. Final AppModule/HTTP/DB native11/11 with ACK, natural exit0 and owned cleanup. First native execution passed all10 business scenarios but missed the unchanged5s natural-exit gate; the unchanged rerun passed in32.9s. No cleanup/guard/deadline was changed and no productive shutdown defect is claimed fixed. Gates use a dedicated MJS file so T8 retains its own root and no skipped tests.

## T12 native correction

The first native attempt had4pass/12fail including root, zero skips. All expected rejection statuses and the observed merchant-lock case were correct, but the new snapshot wrongly expected no canonical HTTP failure audit. Root authorized separating only known http.put/failed records for this route and actor, with explicit persisted metadata assertions; all other audit events and domain state remain compared. The new cart fixture also omitted mandatory updated_at and now uses the existing at timestamp. No production source, API artifact, guard or deadline changed for this correction. Canonical unlinked legacy reserved capacity uses the same closed-order exclusions as ServiceSlotHoldsService/order-fulfillment; completed/cancelled/no_show appointment history remains compatible.

## T12 gate

Final unit3/3 and actual AppModule/HTTP/DB17/17, zero skips, checked API build0 with2490 production sources. Canonical HTTP audit is awaited by correlation before snapshots/close; invalid400 keeps domain/finance intact, while staff403 is explicitly denied before tenantPrincipal and produces no interceptor audit. The first16/16 corrected run passed; expanded matrix initially had15pass/2fail due only to a new incorrect staff-audit expectation, now corrected after code review/root confirmation. One mistaken-cwd rerun was interrupted immediately and only its two verified owned containers removed. Final runner ACK, natural exit0 and owned cleanup all passed; no production/guard/deadline changes or general shutdown-fix claim.

## T13 gate

Merged canonical74e051739 as ef0e05650 before restoration, preserving both phases and the latest ONB-02 status. Eight preparatory files restored with verified hashes. Unit3/3 plus8 existing policy/repository regressions passed, no skips. Official checked API build0,2492sources; final real AppModule/HTTP/DB16/16 with ACK, natural exit0 and owned cleanup. First native12pass/4fail hit the unchanged60request/min tenant quota; fixture now waits on the real remaining/reset headers before the next request, with no retry, quota/guard/assertion change.

The three existing routes prove canonical nested merge/omit/clear,1200 validation, idempotent work, scoped chunk invalidation and rollback both before and after work creation. T64 must read only persisted storeSettings.company using the canonical public snapshot/hash contract; never use getStoreSettings or users/auth fallbacks. Signup flow is unchanged: explicitly stored company.email is already public today; when it is absent, private login never enters canonical storage or source hashes. Canaries and explicit public contact cover all three routes, plus withdrawal when no public company content remains.

## T14 gate

Six preparatory files restored with hashes verified, then the Prisma getter replaced against the exact saved T13 fragment. Unit3/3 plus8 existing regressions passed; checked API build0 with2493sources and real AppModule/HTTP/DB8/8, zero skips. Both getters no longer query users; shared public mapper preserves stored contact and legacy description while excluding nested private canaries. All three routes prove save/reopen/clear and explicit public contact; ACK, natural exit0 and owned cleanup passed. This checked API artifact may be reused for T16 only with unchanged full assertServiceArtifacts validation and an explicit reuse record, as root authorized.
