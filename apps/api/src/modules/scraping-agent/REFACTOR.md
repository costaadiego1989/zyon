# REFACTOR.md - scraping-agent Module

## Current State

**Module Size:** 625 LOC (14 files)
**Architecture:** Clean Architecture; incomplete (in-memory only, stub implementations)
**Maturity:** Early-stage; quote request/finalize/cancel flows present but thin

**Structure:**
- **Domain:** PriceQuoteJobEntity (132 LOC, large), 3 policies (routing, allow-list, cost), 1 service (result ranker), 2 ports, events
- **Application:** 5 use-cases (Request, Ingest, Finalize, Cancel; list via controller inject)
- **Infrastructure:** InMemoryPriceQuoteJobRepository (ONLY; no Prisma), FlatRateSourceAdapter (stub)
- **Presentation:** WidgetPriceQuoteController; embed guards
- **Tests:** use-cases spec (314 LOC)

**Key Invariants:**
- Job state: pending → running → completed/failed/cancelled
- Results ranked by total_cost (price + shipping - coupon discount)
- Routing decision (integrated vs external) based on cart + sources
- merchant_id scoped lookups

---

## Issues

### CRITICAL

1. **PriceQuoteJobEntity State Machine Incomplete**
   - States: pending, running, completed, failed, cancelled
   - No atomic transitions; caller responsible for ensuring valid state
   - Complete() method requires rankedIds passed in; no validation of rankedness
   - **Impact:** Garbage data stored; no audit of state changes
   - **Location:** `domain/entities/price-quote-job.entity.ts` lines 80–110

2. **Ingest Quote Silently Succeeds If Source Not Found**
   - IngestQuoteFromSourceUseCase does not validate source_key exists in sources registry
   - Appends outbox event with no source fetched
   - **Impact:** Quote job completes with stale/wrong data
   - **Location:** `application/use-cases/ingest-quote-from-source.use-case.ts` line 20–30

3. **Result Ranker Does Not Handle Empty Results**
   - rankResults() filters out-of-stock but doesn't return error if all results are out-of-stock
   - Finalize job with empty ranked list, job appears completed but has no recommendations
   - **Impact:** Buyer sees no options in UI; silent failure
   - **Location:** `domain/services/result-ranker.service.ts` line 8–12

### HIGH

1. **No Prisma Repository**
   - Only InMemoryPriceQuoteJobRepository wired; violates CLAUDE.md
   - **Impact:** Production state lost on restart
   - **Location:** `scraping-agent.module.ts` line 30–35

2. **FlatRateSourceAdapter Is a Stub**
   - Hard-codes flat rates; doesn't fetch real shipping estimates
   - Used as mock only
   - **Impact:** Module cannot produce real quotes
   - **Location:** `infrastructure/adapters/flat-rate-source.adapter.ts`

3. **Purchase Routing Policy Incomplete**
   - decidePurchaseRouting() checks merchant_domain but logic is unclear
   - Comment on line 5 says "P1 fix: was `external` hardcoded"
   - No concrete criteria for integrated vs external
   - **Impact:** Routing always defaults to one option; not actually routing
   - **Location:** `domain/policies/purchase-routing.policy.ts` lines 1–20

4. **No Outbox Implementation Wired**
   - Both use-cases inject OUTBOX_REPOSITORY but module does not provide
   - If ever wired, will throw at runtime
   - **Impact:** Events are lost
   - **Location:** `scraping-agent.module.ts` providers list

5. **Controller Missing Idempotency Guards**
   - WidgetPriceQuoteController POST endpoints (request, ingest, finalize) lack Idempotent() decorator
   - Duplicate requests create duplicate quote jobs
   - **Impact:** Buyer can trigger multiple pricing analyses
   - **Location:** `presentation/http/widget-price-quote.controller.ts` lines 20–50

### MEDIUM

1. **PriceQuoteJobEntity Too Large**
   - 132 LOC; stores all results (ProductQuery, PriceQuoteResult[]) inline
   - Snapshot includes full price list; inefficient for large catalogs
   - **Impact:** Bloated Prisma records; slow queries
   - **Location:** `domain/entities/price-quote-job.entity.ts`

2. **RequestPriceQuoteUseCase Creates Job But Does Not Start Fetching**
   - Job created in pending state; caller must separately invoke IngestQuoteFromSourceUseCase
   - No automatic orchestration
   - **Impact:** Flow is manual; easy to forget steps
   - **Location:** `application/use-cases/request-price-quote.use-case.ts` line 30–40

3. **Source Allow List Validation Weak**
   - isSourceAllowed() only checks source_key; does not validate merchant has configured source
   - **Impact:** Merchant can request prices from unconfigured sources
   - **Location:** `domain/policies/source-allow-list.policy.ts`

4. **No Rate Limiting on Quote Requests**
   - Buyer can spam quote requests; no per-session/per-buyer throttle
   - **Impact:** DOS risk; resource exhaustion
   - **Location:** No mechanism exists

5. **Finalize Job With Stale Results**
   - FinalizeQuoteJobUseCase does not validate results are fresh (time-to-live)
   - Can finalize old quotes from 1 hour ago if user requests
   - **Impact:** Buyer sees stale prices
   - **Location:** `application/use-cases/finalize-quote-job.use-case.ts` line 20–30

### LOW

1. **Total Cost Policy Simple**
   - calculateTotalCost() is a pure function, but "coupon_discount" hardcoded as field name
   - No discount type abstraction
   - **Location:** `domain/policies/total-cost.policy.ts`

2. **No Logging of Price Quote Flow**
   - No observability into which sources failed, which succeeded
   - **Location:** No structured logs in use-cases

---

## Coupling Map

```
scraping-agent
├── domain
│   ├── PriceQuoteJobEntity (large)
│   ├── policies/ (pure)
│   ├── services/result-ranker (pure)
│   └── ports/ (contracts)
├── application
│   ├── RequestPriceQuoteUseCase → repository
│   ├── IngestQuoteFromSourceUseCase → repository + outbox (MISSING)
│   ├── FinalizeQuoteJobUseCase → repository + outbox + result-ranker
│   └── CancelQuoteJobUseCase → repository
├── infrastructure
│   ├── InMemoryPriceQuoteJobRepository (ONLY; no Prisma)
│   └── FlatRateSourceAdapter (stub)
├── presentation
│   └── WidgetPriceQuoteController → use-cases + embed-auth
└── module
    ├── imports: [EmbedModule]
    ├── providers: (in-memory repo, flat-rate stub)
    └── (no Prisma repo, no real source adapters)

External:
- @zyon/shared-types (Cart, etc.)
```

**Missing:**
- Outbox provider
- Real source adapters (Shopify pricing, external APIs, etc.)
- Price caching layer
- Source registry

---

## Proposed Changes

### P0: Implement Prisma Repository

**Problem:** Only in-memory; violates CLAUDE.md.

**Solution:**
1. Implement PrismaPriceQuoteJobRepository
2. Wire in scraping-agent.module.ts
3. Run tests against Prisma
4. Add integration test for merchant_id scoping

**Estimate:** 3–4 hours

---

### P1: Fix Result Ranker Empty Case

**Problem:** rankResults() returns empty array if all results out-of-stock; finalize succeeds with no recommendations.

**Solution:**
1. Throw NoAvailableSourcesError if rankResults returns empty
2. Fail the job instead of completing with no results
3. Add test for out-of-stock scenario

**Estimate:** 1 hour

---

### P2: Strengthen Purchase Routing Policy

**Problem:** Routing logic unclear; hardcoded to one path.

**Solution:**
1. Define explicit criteria: integrated if [conditions], external otherwise
2. Add comments documenting business rules
3. Add test cases for each routing branch
4. Consider: number of sources, cart value, merchant configuration

**Estimate:** 2 hours

---

### P3: Implement Result Freshness Check

**Problem:** Can finalize stale quotes (hours old).

**Solution:**
1. Add TTL to PriceQuoteResult or PriceQuoteJob
2. FinalizeQuoteJobUseCase checks: now() - createdAt < TTL_SECONDS
3. If stale, fail job with error code (caller should re-request)
4. Add test for stale result rejection

**Estimate:** 1–2 hours

---

### P4: Add Idempotency Decorators

**Problem:** POST endpoints lack idempotency guards.

**Solution:**
1. Add @Idempotent() decorator to RequestPriceQuote, IngestQuote, FinalizeJob endpoints
2. Use idempotency-key header to deduplicate within TTL window
3. Add test that verifies duplicate request returns cached result

**Estimate:** 2 hours

---

### P5: Decompose PriceQuoteJobEntity

**Problem:** 132 LOC; stores full result set inline.

**Solution:**
1. Extract PriceQuoteResultSet as separate domain object
2. Store only summary in job (e.g., numResults, topPrice, lastUpdated)
3. Fetch full results separately via repository query
4. Reduces Prisma record bloat

**Estimate:** 3–4 hours

---

### P6: Add Source Registry

**Problem:** No way to discover available sources; adapters hard-coded.

**Solution:**
1. Create SourceRegistry that merchants can enable/disable per account
2. Add PriceSourceRegistry port
3. Check registry in isSourceAllowed() policy
4. Add test that source not in registry is rejected

**Estimate:** 3–4 hours

---

### P7: Add Rate Limiting

**Problem:** No throttle on quote requests.

**Solution:**
1. Add rate limit middleware to WidgetPriceQuoteController
2. Throttle: 5 requests per session per minute
3. Return 429 Too Many Requests if exceeded
4. Add test for rate limit enforcement

**Estimate:** 1–2 hours

---

## SOLID Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **S**ingle Responsibility | ⚠ | PriceQuoteJobEntity is too large (132 LOC). FinalizeQuoteJobUseCase orchestrates ranking + routing + completion. |
| **O**pen/Closed | ⚠ | Repository ports extensible, but source fetching is hard-coded. |
| **L**iskov Substitution | ✓ | Repository impl is correct. |
| **I**nterface Segregation | ⚠ | Use-cases couple to outbox (even though not provided). |
| **D**ependency Inversion | ✓ | Ports used; no concrete dependencies in domain. |

---

## Object Calisthenics

| Rule | Status | Notes |
|------|--------|-------|
| 1. One level of indentation | ⚠ | PriceQuoteJobEntity has nested state transitions. |
| 2. No `else` | ✓ | Most use-cases use early returns. |
| 3. Wrap primitives in objects | ⚠ | PriceQuoteResult uses inline JSON. |
| 4. First-class collections | ⚠ | results stored as raw array in entity. |
| 5. No getters/setters | ⚠ | Public properties. |
| 6. One dot per line | ✓ | No deep chaining. |
| 7. No abbreviations | ✓ | Clear naming. |
| 8. Keep classes small | ✗ | Entity is 132 LOC. |
| 9. No more than 2 instance variables | ✗ | Entity has 10+. |

---

## Recommended Refactor Priority

1. **First:** Implement Prisma repository (P0) — production-blocking.
2. **Second:** Fix result ranker empty case (P1) — prevents silent failures.
3. **Third:** Add freshness check (P3) — prevents stale pricing.
4. **Fourth:** Strengthen routing policy (P2) — clarifies business logic.
5. **Fifth:** Add idempotency (P4) — prevents duplicate work.
6. **Sixth:** Decompose entity (P5) — improves storage efficiency.
7. **Seventh:** Add source registry (P6) — enables flexible source config.
8. **Eighth:** Add rate limiting (P7) — prevents DOS.

---

## Reference Files

- `/apps/api/src/modules/scraping-agent/domain/entities/price-quote-job.entity.ts`
- `/apps/api/src/modules/scraping-agent/application/use-cases/request-price-quote.use-case.ts`
- `/apps/api/src/modules/scraping-agent/application/use-cases/finalize-quote-job.use-case.ts`
- `/apps/api/src/modules/scraping-agent/domain/services/result-ranker.service.ts`
- `/apps/api/src/modules/scraping-agent/domain/policies/purchase-routing.policy.ts`
- `/apps/api/src/modules/scraping-agent/infrastructure/adapters/flat-rate-source.adapter.ts`
- `/apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts`
