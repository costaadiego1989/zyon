# REFACTOR.md - cross-sell Module

## Current State

**Module Size:** 765 LOC (18 files)
**Architecture:** Clean Architecture with recommend + suggest + accept flow
**Maturity:** Production-ready; merchant CRUD, buyer accept/decline, listing

**Structure:**
- **Domain:** CrossSellPromotionEntity (82 LOC), CrossSellSuggestionEntity (78 LOC), 2 policies (eligibility, stacking), 2 ports, domain events
- **Application:** 6 use-cases (Create, Update, Archive, ListEligible, Accept, Decline), 1 service (CrossSellProductResolver, 73 LOC)
- **Infrastructure:** 2 in-memory repositories; e2e test module
- **Presentation:** MerchantCrossSellController, WidgetCrossSellController
- **Tests:** use-cases spec (199 LOC), policies spec (100 LOC)

**Key Invariants:**
- Recommendation ranked_items limited to product list (policies validate)
- Acceptance must pass stacking policy (max discount %)
- Suggestions are pending until accepted or declined
- merchant_id isolation enforced at repository level

---

## Issues

### CRITICAL

1. **CrossSellProductResolver Has Unclear Error Handling**
   - Returns empty array if products not found; silent failure
   - Merchant sees no recommendations with no error in logs
   - **Impact:** Merchant assumes system is working but recommendation engine is broken
   - **Location:** `application/services/cross-sell-product-resolver.ts` line 50–60

2. **ListEligibleCrossSellsUseCase Filters at Database But Does Not Validate Cart**
   - Fetches active promotions filtered by merchant/session; does not check if cart qualifies
   - Buyer gets irrelevant suggestions
   - **Impact:** Spam suggestions; LLM may write low-quality copy
   - **Location:** `application/use-cases/list-eligible-cross-sells.use-case.ts` line 30–40

### HIGH

1. **No Prisma Repository Implementation**
   - Both repositories are in-memory; CLAUDE.md violation
   - **Impact:** Production state volatile
   - **Location:** `cross-sell.module.ts` lines 20–25

2. **Accepted Skus Subset Validation Inconsistent**
   - AcceptCrossSellSuggestionUseCase tests that accepted_skus is subset of ranked_items
   - But archive/update promotions do not validate that recommended_skus are real products
   - **Impact:** Promotions can reference deleted products; merchant configuration drift
   - **Location:** `accept-cross-sell-suggestion.use-case.ts` line 20; missing in create/update

3. **Stacking Policy Implementation Incomplete**
   - evaluateStacking() exists but is not enforced if multiple cross-sell promotions overlap
   - No central stacking service for total discount calculation
   - **Impact:** Stacked discounts may breach margin even if individual are authorized
   - **Location:** `domain/policies/stacking.policy.ts` is a pure function; no orchestration

4. **Suggestion Status State Machine Not Documented**
   - CrossSellSuggestionEntity has pending → accepted/declined transitions but no failed state
   - If accept fails mid-flow, suggestion stays pending and blocks future suggests for same session+promo
   - **Impact:** One-shot suggestions never recover
   - **Location:** `domain/entities/cross-sell-suggestion.entity.ts`

### MEDIUM

1. **ListEligibleCrossSellsUseCase Couples Tightly to Outbox**
   - 4 dependencies; appends outbox event on each listing (side-effect on read?)
   - If outbox writes fail, listing throws and use-case never returns
   - **Impact:** Read operation has write semantics
   - **Location:** `list-eligible-cross-sells.use-case.ts` line 30–50

2. **CrossSellProductResolver In-Memory State**
   - Resolver doesn't fetch real product catalog; assumes products exist
   - No `Product Catalog` integration; tests use mock data
   - **Impact:** Promotions never resolve real SKUs in production
   - **Location:** `cross-sell-product-resolver.ts` line 30–40

3. **Controller Routes Inconsistent**
   - WidgetCrossSellController uses req.embedClaims while MerchantCrossSellController uses AuthGuard
   - Two auth models in one module
   - **Location:** `presentation/http/merchant-cross-sell.controller.ts` vs `widget-cross-sell.controller.ts`

4. **No Race Condition Protection on Promotion Status**
   - Multiple concurrent updates can set status to "active" or "archived"
   - No optimistic locking or version field
   - **Impact:** Last-write-wins; merchant loses configuration
   - **Location:** `update-cross-sell-promotion.use-case.ts` lacks version check

### LOW

1. **e2e Module Explosion**
   - Separate widget-cross-sell-e2e.module.ts adds complexity
   - May not be needed if test doubles work via dependency injection
   - **Location:** `widget-cross-sell-e2e.module.ts`

2. **Policies Spec Lacks Integration Tests**
   - Tests eligibility + stacking in isolation but no cross-promotion integration test
   - **Location:** `policies/cross-sell-policies.spec.ts`

---

## Coupling Map

```
cross-sell
├── domain
│   ├── entities/ (pure)
│   ├── policies/ (pure; no deps)
│   └── ports/ (contracts)
├── application
│   ├── use-cases/ → repositories + rules-engine + outbox (STRONG)
│   └── services/cross-sell-product-resolver (weak product catalog integration)
├── infrastructure
│   ├── in-memory repos (test doubles; P1 BLOCKER)
│   └── (no Prisma repos)
├── presentation
│   ├── merchant-cross-sell.controller (AuthGuard)
│   ├── widget-cross-sell.controller (EmbedAuthGuard)
│   └── (no DTO layer)
└── module
    ├── imports: [AuthModule, EmbedModule, RulesEngineModule?]
    └── exports: use-cases

External:
- @zyon/rules-engine (evaluateDiscountOffer, evaluateStacking)
- @zyon/shared-types (Cart, MerchantRules)
- rules-engine module (stacking policy)
```

---

## Proposed Changes

### P0: Implement Prisma Repositories

**Problem:** Both repositories are in-memory; cannot deploy to production.

**Solution:**
1. Implement PrismaCrossSellPromotionRepository
2. Implement PrismaCrossSellSuggestionRepository
3. Wire in cross-sell.module.ts
4. Add integration test for cross-tenant isolation
5. Update e2e test to use real Prisma repos

**Estimate:** 4–5 hours

---

### P1: Add Product Catalog Integration

**Problem:** CrossSellProductResolver does not resolve real products.

**Solution:**
1. Add ProductService port to cross-sell domain
2. Implement ProductServiceAdapter that fetches from catalog module (or external API)
3. Use in resolver; throw ProductNotFoundError if SKUs missing
4. Add fallback: cache last-known good product metadata

**Estimate:** 3–4 hours (blocked until catalog module exists or API integration available)

---

### P2: Strengthen Suggestion State Machine

**Problem:** Suggestions stuck in pending if accept/decline fails.

**Solution:**
1. Add `failed` status to CrossSellSuggestion entity
2. Transition rule: pending → failed (with reason)
3. ListEligibleCrossSellsUseCase skips failed suggestions
4. Add timeout: pending > 5min auto-fails
5. Add test for failed-state recovery

**Estimate:** 2–3 hours

---

### P3: Centralize Stacking Logic

**Problem:** Stacking policy function exists but no service to apply it across promotions.

**Solution:**
1. Create StackingService (application layer) that takes all active promotions for a cart
2. Apply stacking policy to compute max allowable discount
3. Inject into AcceptCrossSellSuggestionUseCase and ListEligibleCrossSellsUseCase
4. Pass to checkout flow to enforce total discount limit
5. Add test for stacked promotions

**Estimate:** 3–4 hours

---

### P4: Add DTO Validation

**Problem:** No HTTP input validation; controllers accept raw JSON.

**Solution:**
1. Create CreateCrossSellPromotionDto with class-validator
2. Create AcceptCrossSellSuggestionDto
3. Add @Body() DTO to controller methods
4. Validate recommended_skus is non-empty array of SKU format

**Estimate:** 2 hours

---

### P5: Consolidate Controller Auth

**Problem:** Two auth models in cross-sell module.

**Solution:**
1. Extract auth logic into a shared base controller or helper
2. Both controllers use @UseGuards() but resolve principal consistently
3. Add a CurrentPrincipal() decorator that returns MerchantPrincipal for both contexts

**Estimate:** 1–2 hours

---

## SOLID Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **S**ingle Responsibility | ⚠ | Some use-cases do validation + orchestration + outbox (e.g., ListEligible). |
| **O**pen/Closed | ✓ | Repository ports extensible; policies are pure functions. |
| **L**iskov Substitution | ✓ | In-memory repos implement contract correctly. |
| **I**nterface Segregation | ⚠ | ListEligibleCrossSellsUseCase couples to outbox (side effect on read). |
| **D**ependency Inversion | ✓ | Use-cases depend on ports. |

**To Improve:** Extract outbox publishing into separate event-publisher service used only by mutating use-cases.

---

## Object Calisthenics

| Rule | Status | Notes |
|------|--------|-------|
| 1. One level of indentation | ⚠ | AcceptCrossSellSuggestionUseCase has nested checks. |
| 2. No `else` | ✓ | Most use-cases use early returns. |
| 3. Wrap primitives in objects | ✓ | Entities wrap snapshots. |
| 4. First-class collections | ✓ | ranked_items wrapped. |
| 5. No getters/setters | ⚠ | Public properties on snapshot. |
| 6. One dot per line | ✓ | No deep chaining. |
| 7. No abbreviations | ✓ | Clear naming. |
| 8. Keep classes small | ⚠ | Use-cases 50–100 LOC. |
| 9. No more than 2 instance variables | ✗ | Some use-cases have 4+. |

---

## Recommended Refactor Priority

1. **First:** Implement Prisma repositories (P0) — production-blocking.
2. **Second:** Add product catalog integration (P1) — feature-correctness blocker.
3. **Third:** Strengthen state machine (P2) — prevents suggestion zombies.
4. **Fourth:** Centralize stacking (P3) — depends on coupon P4.
5. **Fifth:** Add DTOs (P4) — hardens HTTP boundary.
6. **Sixth:** Consolidate auth (P5) — improves consistency.

---

## Reference Files

- `/apps/api/src/modules/cross-sell/domain/entities/cross-sell-promotion.entity.ts`
- `/apps/api/src/modules/cross-sell/domain/entities/cross-sell-suggestion.entity.ts`
- `/apps/api/src/modules/cross-sell/application/services/cross-sell-product-resolver.ts`
- `/apps/api/src/modules/cross-sell/application/use-cases/list-eligible-cross-sells.use-case.ts`
- `/apps/api/src/modules/cross-sell/domain/policies/stacking.policy.ts`
- `/apps/api/src/modules/cross-sell/widget-cross-sell-e2e.module.ts`
