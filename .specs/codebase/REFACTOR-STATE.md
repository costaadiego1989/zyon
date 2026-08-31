# Refactor State & Decisions

**Last Updated:** 2026-08-29  
**Status:** Audit in progress

## Decisions

- **Analysis First:** Complete architectural audit before proposing refactors
- **Monolithic Boundary:** Respect 10 laws; no microservices yet
- **Clean Layers:** Controllers → Use-Cases → Services → Repositories (no repo-in-controller)
- **No Comments:** Code speaks; JSDoc only for public contracts
- **SOLID First:** SRP before OCP before DIP

## Blockers

None yet. Awaiting agent results.

## TODOs

- [x] Phase 1 (god-modules) complete
- [x] Phase 2 (coupling) complete
- [x] Phase 3 (architecture principles) complete
- [x] Synthesized findings into 4 problem buckets
- [x] Created REFACTOR-ROADMAP.md with atomic tasks + effort + waves
- [x] Wave 1 COMPLETE (typecheck EXIT=0): T1.1 + T3.1 ✓
- [x] Wave 2 COMPLETE: T2.1 (start-checkout decomposition) — execute() 300L→59L, 17→10 deps; 4 collaborators; InterventionRuleTextBuilder shared. 4/4 specs pass.
- [x] Wave 3 COMPLETE: T2.2 (send-chat decomposition, SAFETY-CRITICAL)
  - execute() 414L→97L; ChatContextService + ChatResponseBuilder extracted; isSafeGeneratedMessage INLINE (verified line 148)
  - **Fixed 3 regressions the subagent introduced (caught by running actual tests, not just typecheck):**
    1. Agent-context wrongly guarded `if(userId&&agentId&&globalUserId)` → removed (unconditional call, matches original)
    2. globalUserId passed as `undefined` param + wrong exception type → derive from session.globalUserId inside loadContext + restore NotFoundException
    3. **finalMissingFields hardcoded `[]` in both branches** → pass missingFields through, use in else branch (this broke 7 tests)
  - send-chat spec migrated to createStartCheckoutUseCase fixture (24 sites) + fixture extended with customerService override
  - **Result: send-chat 20/22 pass, start-checkout 4/4, typecheck 0 errors**
  - 2 remaining failures are PRE-EXISTING (files unchanged on branch, outside refactor scope):
    - send-chat test 20: `missing_fields[0]` CPF vs telefone — DATA_FIELD_ORDER in customer-extraction.service.ts (untouched)
    - track-checkout test: ledger-cap expected 1 got 2 — track-checkout use-case (unchanged, uses ledger port not settings)
- [x] Wave 4 (partial): T1.2 anchor + e2e spec migration
  - T1.2a: revenue-lift.repository.ts — typed all `$queryRaw` rows (CohortAggregationRow/FeatureBreakoutRow/DailyTrendRow), removed `(prisma as any)` + `rows as any[]` (6 any → 0)
  - **CRITICAL cleanup: 45 typecheck errors surfaced** — e2e/spec files in presentation/http/ still constructed use-cases with OLD positional args (T2.1/T2.2 changed sigs). My earlier waves only migrated __tests__/, missed presentation/http/.
  - Created send-chat-message.fixture.ts (createSendChatUseCase); extended start-checkout.fixture with agentContext/intentMemory/intentConsent/holdoutGroupService/customerService overrides
  - Migrated 14 e2e/spec files to fixtures (bulk perl + subagent for multi-arg mapping)
  - **VERIFIED: typecheck 0 errors, 0 raw constructions left, checkout unit suite 53 pass / 3 fail**
  - 3 fails ALL pre-existing (files unchanged on branch, outside refactor scope):
    - send-chat test 20 (field order), track-checkout (ledger cap), complete-order (WhatsApp tracking)
- [x] Wave 5 COMPLETE (typecheck 0 errors, committed):
  - [x] T4.1 (split payment-platform.use-cases 14 classes → connect/billing/platform-events + barrel). Subagent botched it (102 errors: missing .js extensions + wrong ../ depth 2 levels down + barrel without .js). Fixed directly: corrected depth (../../../domain) + added .js to all relative imports. Verified 0 errors.
  - [x] T4.2 (split integrations.use-cases 17 classes → api-keys/webhooks/tracking + barrel). Clean.
  - [x] T3.4 (knowledge-base → catalog infra leak) — EmbeddingPort in kb domain; 5 use-cases inject EMBEDDING_PORT; module useExisting EmbeddingService. Port needed isAvailable() + generate() (caught by typecheck).
  - Skipped C1 (console→Logger): cosmetic + adapters intentionally avoid NestJS Logger (domain-purity).
  - LESSON AGAIN: subagent file-split without .js extensions + wrong relative depth = 102 errors it reported as "done". Root tsc caught it. Barrel-pattern splits must verify BOTH depth and .js.
- [~] Wave 6: T4.3 (long-method extraction) — PARTIAL
  - [x] complete-order.use-case execute() 264→178L: extracted sendWhatsAppConfirmation, tagAttributionForOrder, recordConversionAnalytics (private methods, behavior identical, typecheck 0). Test 3 (WhatsApp) pre-existing mismatch: test expects whatsapp.message.requested outbox event but code uses BubbleWhats fetch — spec unchanged by me, code path predates session.
  - NOTE: audit LOC numbers were stale — storefront files already refactored by earlier commits (langgraph 597→286, adapter 1206→299). Current >200L methods: create-payment-intent execute() 226L, langgraph run() 286L, send-store execute() 178L. Each is payment/AI-critical — do individually with care, not batched.
- [x] T1.2 knowledge-base repo: typed $queryRaw rows, 12 any removed (caught 2 latent mismatches: null metadata, unconstrained source_type)
- [x] T1.2 checkout repo: 10 decimal-column `any` fields → DecimalLike (exported from decimal.util). 0 errors.
- [x] T1.2 inventory repo: removed 10 stale casts ((item as any).salePriceCents — column is typed; QueryMode "insensitive" as any). 0 errors.
- SKIPPED create-payment-intent + langgraph extraction: dense money/AI logic with interwoven mutable session state; extraction risk (wrong charges) outweighs readability gain. KISS + safety mandate.
- T3.3 ASSESSED = mostly FALSE POSITIVE: pure functions (cipher/parser/provider-check) need no port; the 4 injectable services (queue/quote/dispatcher/deduplicator) are already DI-injected via constructor (concrete-type-as-token is idiomatic NestJS, zero `new`-instantiation). Forcing ports = ceremony (KISS violation). Only genuine hard-dep was S3Client (C2) — self-contained SDK client from env with graceful null fallback, also low-value to wrap. Skipped both.

## T1.2 repo-any sweep: COMPLETE for identified modules
revenue-lift, integrations, knowledge-base, checkout, inventory — all typed, 0 errors, committed + pushed.

## Wave 7 COMPLETE (all 0 errors, committed + pushed)
- [x] T3.2 — billing-plan-guard moved payment/domain → payment/infrastructure/billing/; domain file now a barrel re-export. 38 importers intact, domain free of Prisma/@nestjs.
- [x] T4.5 (partial, 3 safe targets) — routed repo-in-controller WRITES through use-cases:
  - coupons: ToggleCouponActiveUseCase (spec 4/4)
  - returns: CancelReturnUseCase (find + canCancel guard + updateStatus)
  - whatsapp-channel: ConfigureWhatsAppUseCase.disconnect()/setEnabled()
- [x] T4.4 ASSESSED = FALSE POSITIVE: operations/payment-platform/m2m controllers have ZERO `private async` business logic (0 each). "Fat" = multiple controller classes co-located (operations 3, payment-platform 3) or verbose thin handlers (m2m). Only action would be a file-split like T4.1/T4.2 — deferred (low value, route-decorator churn).

## Genuinely remaining (deferred — reasons)
- T4.5 embed-consent: writes LGPD consent — SKIPPED to avoid racing the other agent's active intent-memory/consent restructuring.
- T4.5 storefront cart write: storefront being edited by other agent (conversation-engine).
- T1.3 (http ~280 `any`): user said leave the anys. Deferred by request.
- T4.3 rest (create-payment-intent, langgraph): money/AI mutable state, skip recommended.
- T4.4 file-splits (operations, payment-platform multi-controller files): mechanical, low value.

## Lesson reinforced (2nd pass — the migration was NOT actually done)
First "done" claim was false: `npx tsc`/`node ./node_modules/.bin/tsc` CRASH silently (missing `apps/api/node_modules/typescript/lib/tsc.js`), so `grep -cE "error TS"` returned 0 on a crash log with no errors. User's tsc-watch showed the truth: 24 errors. My perl bulk-replace renamed CALLS without adding IMPORTS; subagent hallucinated a `createPaymentIntent: payments` override that never existed in the original.

**AUTHORITATIVE TYPECHECK (only one that works):**
`cd apps/api && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -cE "error TS"`

All 24 fixed: added fixture imports to 8 files, migrated 3 more raw-construction files, removed 2 hallucinated createPaymentIntent overrides (diffed `git show HEAD:` to get true mapping), tightened crossSellRecommender param type. Final: **0 errors (root tsc), controller 1/1, ai-safety 7/7, revenue-lift-integration 7/7, send-chat 20/1-preexisting**.

## Pre-existing build blockers (NOT from refactor)
- checkout/presentation/http/checkout.payment-method-fix.spec.ts:94 (commit 693961e) — T1.1 agent updated its constructor call; verify
- storefront/infrastructure/tool-handlers/product.handlers.ts:46
- `tsc --noEmit` (pnpm typecheck) is EXIT=0; these surface only in the nest-build test runner. Triage separately.

## New findings during execution

- `payment/domain/billing-plan-guard.ts` exports PlanLimitGuard + BillingPlanMeteringService + RequirePlanLimit/Feature decorators; imported by 38 files. `BillingPlanMeteringService.getEffectivePlan(merchantId)` already does T1.1's billing-plan resolution → REUSE candidate for MerchantPlanPort adapter.
- cross-sell services isolated: only 2 in-module importers. Clean move.

## Key Finding

Raw god-module count (51%) OVERSTATED risk. Reality: ports/adapters correct, zero cycles, DI shallow (avg 1.2). Real problems concentrated in 4 buckets:
1. Type-safety (742 `any`) — highest ROI
2. God use-cases on core checkout path (start-checkout 18 deps, send-chat 422L)
3. Layer leaks (4 domain-purity + 11 DIP)
4. Mega files (2 multi-class use-case files, 7 methods >200L)

## Deferred

- Performance optimization (after structure fixed)
- Event bus migration (after clear module boundaries)
- Database indexing (after query patterns stabilize)

## Lessons

(To be populated during refactor execution)

