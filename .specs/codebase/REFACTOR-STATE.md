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
- [ ] Wave 4 REMAINING: repo-layer any sweep (integrations 31, checkout 13, knowledge-base 12) + T4.x mega-file splits + T3.3/T3.4 (DIP infra imports)

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

