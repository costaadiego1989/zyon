# CHECKOUT Module Refactor Plan

## Current State

**Module Size:** 104 TypeScript files (~5.5K LOC non-spec)
**Largest Layer:** Infrastructure (Prisma repository 735 LOC + tests)
**Services:** 4 application services + domain utility functions
**Use Cases:** 9 primary operations exported, ~200 avg LOC per case
**Port Count:** 11 distinct ports; legacy god-port (CheckoutRepository) still in use
**Invariants:** Offer authorization guards exist; tentative merchant_id scoping throughout

---

## Architecture Issues by Severity

### CRITICAL

#### [DONE] 1. CheckoutCustomerService: God Service (460 LOC, 70+ if statements)
**Finding:** Single service handling customer extraction, OTP validation, email capture notification, returning buyer hydration, buyer account persistence, profile merging, address merging, address validation, and scoring.

**Violations:**
- Single Responsibility (SRP): Handles 8+ distinct concerns
- Object Calisthenics: >5 methods mutating customer profile across multiple phases
- Temporal coupling: OTP generation/validation/resend interleaved; easy to miss edge cases

**Example of bloat:**
```typescript
// Lines 33-117: processCustomerInput
// - OTP validation error handling
// - Email capture + notification
// - Phone OTP generation
// - Buyer account persistence logic
// - Global user ID resolution across multiple sources
// All in one method; 85 LOC, 20+ decisions
```

**Impact:** High mutation risk, difficult to test (8 constructor deps), low reusability.

**Recommended Fix:**
- Extract `OtpService` (generation, validation, resend)
- Extract `BuyerRecognitionService` (find returning buyer, merge profile, resolve global ID)
- Extract `BuyerAccountPersistenceService` (ensure account exists, update profile)
- Keep CheckoutCustomerService as thin orchestrator

---

#### [DONE] 2. SendChatMessageUseCase: Orchestration God (208 LOC, 5 constructor deps)
**Finding:** Single use-case chaining 4 services in sequence with custom cross-sell and action routing.

**Flow:**
1. Load session
2. Customer input processing (OTP, extraction)
3. Shipping state processing
4. Offer authorization (rules-engine evaluation)
5. Conversation reply (LLM or deterministic)
6. Chat turn append + experience rebuild
7. Cross-sell queries
8. Conditional action building

**Violations:**
- God object orchestration: all application flow routes through this single entry point
- Temporal coupling: each step assumes prior step's side effects (session mutations)
- Try/catch around OTP only; other errors propagate unhandled

**Code smell:**
```typescript
// Lines 54-106: OTP error handling
// Catches OtpValidationError, rebuilds experience with custom quick_replies
// Other errors (cross-sell, conversation) swallowed silently (lines 172-174)
// Inconsistent error recovery paths
```

**Impact:** High cognitive load, difficult to unit-test, hard to add new stages without refactoring.

**Recommended Fix:**
- Extract checkout orchestration pipeline as a service
- Separate cross-sell logic into isolated handler
- Use Result<T, E> or structured error types instead of try/catch
- Make each service idempotent (checkpoint-and-resume friendly)

---

#### 3. CompleteOrderUseCase: Implicit Transactionality (215 LOC, 8 deps, nested closures)
**Finding:** Order commit and outbox events must be atomic. Implementation uses optional TransactionRunner, with complex fallback logic and implicit callback patterns.

**Violations:**
- SOLID/DIP: TransactionRunner is optional; caller must understand fallback semantics
- Callback hell: `commit` closure captures 9 variables; hard to reason about
- Side effects after transaction: WhatsApp + purchase history updates run outside tx boundaries
- Silent failures: BubbleWhats HTTP errors logged but order already committed

**Code smell:**
```typescript
// Lines 81-129: commit callback with nested conditionals
// Lines 134-164: side effects outside transaction (WhatsApp, purchase history)
// Risk: if WhatsApp fails, no rollback; order inconsistent with messaging record
```

**Impact:** Difficult to reason about consistency; hard to add new outbox events without duplicating pattern.

**Recommended Fix:**
- Explicit transaction manager or event sourcing
- Outbox events as part of order aggregate
- Separate idempotent post-commit handlers for WhatsApp + analytics
- Use typed Result<T, E> instead of thrown exceptions

---

#### 4. CheckoutShippingService: Hidden Complexity (348 LOC, 6 nested private methods)
**Finding:** Shipping state machine sprawled across tryFillPostal → tryParseNumbers → tryEnsureOptions → trySelectOption, each with regex validation and stateful guards.

**Violations:**
- KISS: 6 regex patterns inline; hard to maintain
- Object Calisthenics: each try* method mutates session; no clear phase boundaries
- String parsing logic brittle (accent normalization, regex overfitting)

**Example:**
```typescript
// Lines 241-262: selectShippingOption
// 3 regex patterns for 1st/2nd/numbered shipping option detection
// Hard-coded in method; not externalized or tested separately
// Accent-aware normalization repeated in looksLikeAddressComplement (lines 265-273)
```

**Impact:** Difficult to extend to new shipping flows; NFC normalization fragile across locales.

**Recommended Fix:**
- Extract ShippingParser service (regex + extraction)
- Extract ShippingStateMachine (define phases explicitly: postal → confirm → options → select)
- Move regex patterns to constants or config
- Add unit tests for each regex pattern independently

---

#### [DONE] 5. Offer Authorization Flow: Missing Invariant Enforcement
**Finding:** LLM never authorizes offers (CLAUDE.md invariant); rules-engine + shipping-engine approve. But `CheckoutOfferService.authorizeOffer()` calls engine directly, bypassing validation of generated messages.

**Violations:**
- Critical invariant (LLM never authorizes): not enforced in type system
- Unsafe generated messages not validated against `isSafeGeneratedMessage` (CLAUDE.md)
- No explicit separation between conversation copy (unsafe) and authorization decision (safe)

**Code smell:**
```typescript
// app/use-cases/send-chat-message.use-case.ts, lines 122-134
// reply.message from conversation port used directly; no validation
// Conversation port may generate unsafe text (e.g., "I'm giving you 50% off!")
// AuthorizedOffer.approved is trusted to come from rules-engine only
```

**Impact:** Risk of LLM-generated authorization claims reaching buyer, violating guarantee.

**Recommended Fix:**
- Explicit type: `SafeAuthorizedOffer extends AuthorizedOffer` with validation
- Implement `isSafeGeneratedMessage()` validator (from CLAUDE.md)
- Add compile-time check: conversation replies cannot be source of auth decisions

---

### HIGH

#### 6. TrackCheckoutEventUseCase: Tangled Decision Flow (185 LOC, 3 private methods)
**Finding:** Event tracking → abandonment scoring → trigger agent decision → intervention ledger gate → outbox events. Multiple side effects on single session load.

**Violations:**
- Lack of temporal cohesion: applyOperationalSettings and applyInterventionLedgerGate both fetch + mutate session
- Magic numbers: CHECKOUT_TRIGGER_THRESHOLD = 0.55 (line 4); evaluateDiscountOffer called again inside (line 100)
- Outbox events chained conditionally; no explicit event dependency tracking

**Code smell:**
```typescript
// Lines 45-49: session fetched once, then passed through 2 filter methods
// Each may re-fetch settings; could be deduplicated
// Lines 82-119: WhatsApp message event includes evaluateDiscountOffer call
// Duplicates offer evaluation logic from CheckoutOfferService; no DRY
```

**Impact:** Difficult to reason about scoring/triggering; easy to diverge evaluation logic.

**Recommended Fix:**
- Extract CheckoutScoringService (handles abandonment + trigger decision)
- Extract CheckoutInterventionGate (cooldown + max count logic)
- Use explicit event dependency graph (avoid redoing offer evaluation)

---

#### 7. Module Dependency Injection: Port Multiplicity (11 ports + god-port)
**Finding:** checkout.module.ts exports deprecated god-port; split ports mostly wired correctly but some use-cases still reference old symbols.

**Violations:**
- SOLID/ISP: CHECKOUT_REPOSITORY used as alias for 5 distinct concerns
- Migration debt: Ports refactored in Wave 2 but old interface not fully removed
- Type safety: CheckoutRepository.transaction confused with TransactionRunner in CompleteOrderUseCase

**Code smell:**
```typescript
// checkout.module.ts, lines 91-98
// { provide: CHECKOUT_SESSION_REPOSITORY, useExisting: CHECKOUT_REPOSITORY }
// Alias hides fact that CHECKOUT_REPOSITORY is god port
// Clients can't tell if they're using split port or god port
```

**Impact:** Difficult to enforce layer boundaries; new code might use deprecated paths.

**Recommended Fix:**
- Remove god-port exports entirely; force all clients onto split ports
- Ensure all 11 split ports are wired in module root
- Update transition docs to guide Wave 2 migration

---

#### [DONE] 8. Tenant Isolation: merchant_id Scoping Inconsistent
**Finding:** merchant_id boundary enforced in queries but NOT in cached agent contexts or offer validations.

**Violations:**
- Cross-session reuse check in ApplyOfferUseCase (line 33) only checks sessionId, not merchantId
- Agent context lookup (SendChatMessageUseCase, line 115) may return wrong merchant's agent if cache is shared
- Shipping quote cache (CheckoutShippingService, line 124) not scoped to merchant

**Code smell:**
```typescript
// apply-offer.use-case.ts, lines 29-33
// Checks: offer.sessionId !== input.session_id
// Missing: offer.merchantId !== input.merchant_id (should be early guard)
// Could result in cross-tenant offer reuse
```

**Impact:** Data leakage risk; multi-tenant isolation violation.

**Recommended Fix:**
- Add explicit tenant boundary guards: assert merchantId in every cross-aggregate lookup
- Scope all caches to (merchantId, key) tuple
- Add test: fuzz cross-tenant offer + session combinations

---

#### 9. Prisma Repository: God Adapter (735 LOC)
**Finding:** Single Prisma repository implements 4 split ports + god port; contains all SQL mapping and JSON schema unpacking.

**Violations:**
- SOLID/SRP: Maps 15+ Prisma models to domain types
- Type safety: `as any` casts on lines 72-73 (CheckoutSession mapping)
- Mutation risk: Schema changes ripple across 40+ methods

**Code smell:**
```typescript
// infrastructure/prisma/prisma-checkout.repository.ts, lines 72-74
// toCheckoutSessionCreate(session) as any
// Hides type error; could silently drop fields on schema mismatch
```

**Impact:** Difficult to test; high blast radius on schema changes.

**Recommended Fix:**
- Separate into 4 focused repositories:
  - PrismaCheckoutSessionRepository
  - PrismaOfferRepository
  - PrismaOrderRepository
  - PrismaIdentityRepository
- Explicit type guards instead of `as any`
- Unit test each mapper independently

---

### MEDIUM

#### 10. CheckoutExperienceService: Presentation Logic Scattered (260 LOC)
**Finding:** buildCheckoutExperience + buildExperienceFromSession mix domain state derivation with UI presentation.

**Violations:**
- SOLID/SRP: Mixes chat stage derivation, missing field calculation, quick reply generation, and JSON serialization
- Hard-coded defaults: PLATFORM_FEE_BRL from process.env; no injection
- Locale hardcoded: pt-BR; no parameterization

**Code smell:**
```typescript
// lines 116-120: readPlatformServiceFee
// process.env.PLATFORM_FEE_BRL read directly in function
// No DI; must be injected at module level if ever needed elsewhere
```

**Impact:** Difficult to reuse in different contexts (mobile app, email template); brittle on env changes.

**Recommended Fix:**
- Extract ExperienceBuildingService (pure data transform, testable)
- Inject PlatformFeeConfig, LocaleConfig at module level
- Move quick_replies generation to separate strategy pattern (easy to test different rules)

---

#### 11. Checkout Session Entity: Minimal Logic (66 LOC)
**Finding:** Entity thin; most business logic lives in services. Entity.create() is factory, not aggregate.

**Violations:**
- KISS overapplied: Aggregate not enforcing invariants (e.g., cart.total must be non-negative)
- Update methods shallow: updateScore() returns new entity, but no validation
- Abandoned: old Abandoned.rehydrate() pattern (line 37) unused in new code

**Impact:** Invariants not enforced at boundary; bugs slip into persistence.

**Recommended Fix:**
- Add factory methods for common state transitions (startDataCollection, startShipping, startPayment)
- Enforce invariants: cart.total > 0, totalDiscount <= cart.total, etc.
- Add scoring update guards (no score decrease without reason)

---

#### 12. Object Calisthenics: Pervasive Violations
**Finding:** Deep nesting (CheckoutCustomerService), mutable loops (Cart item updates), primitive obsession (strings for field names).

**Examples:**
- CheckoutCustomerService.buildCustomerPatch(): 50+ lines with nested if/else
- UpdateCartUseCase.execute() lines 45-62: Manual map-based mutation
- Offer types: string literals ("discount_percent", "shipping_free") instead of discriminated union

**Recommended Fix:**
- Extract CustomerPatchBuilder value object
- Use immutable collection updates (no intermediate bySku map mutations)
- Create OfferType discriminated union: type OfferType = DiscountPercent | ShippingFree | ...

---

## Coupling Map

```
                           PRESENTATION (checkout.controller)
                                  |
                 ┌────────────────┼────────────────┐
                 |                |                |
          StartCheckout     SendChatMessage    CompleteOrder
            (102 LOC)        (208 LOC)            (215 LOC)
                 |                |                |
                 └────────────────┼────────────────┘
                          |
         ┌────────────────┼────────────────┐
         |                |                |
    Customer          Shipping           Offer
    Service           Service           Service
  (460 LOC)          (348 LOC)          (81 LOC)
    (BLOAT)          (COMPLEXITY)       (THIN)
         |                |                |
         └────────────────┼────────────────┘
                  |
         CheckoutRepository (GOD PORT)
         └─ Prisma adapter (735 LOC)
            └─ 15+ DB models
```

**Strengths:**
- Conversation port isolated (good)
- Rules-engine + shipping-engine gated behind ports (good)
- Offer factory generic and reusable (good)

**Weaknesses:**
- Services couple tightly to repository (CheckoutCustomerService.repository.save called 6 times)
- No event bus for cross-aggregate events (WhatsApp, analytics)
- Orchestration logic hardcoded in use-cases; no pipeline abstraction

---

## SOLID Analysis

### SRP Violations
| File | Responsibility Count | Recommended Extract |
|------|----------------------|---------------------|
| CheckoutCustomerService | 8 | OtpService, BuyerRecognitionService, BuyerAccountPersistenceService |
| SendChatMessageUseCase | 6 | CheckoutOrchestrationPipeline, CrossSellHandler |
| CompleteOrderUseCase | 4 | TransactionManager, PostCommitEventHandler |
| CheckoutShippingService | 6 | ShippingParser, ShippingStateMachine |

### DIP Violations
| Abstraction | Issue |
|-------------|-------|
| CheckoutRepository (god port) | Optional parameters; unclear which contracts are required |
| TransactionRunner (optional) | CompleteOrderUseCase must handle absence; no interface for required behavior |
| BuyerEmailNotifier | Optional @Inject; hard to test; global side effect |

### ISP Violations
| Port | Too Broad | Reason |
|------|-----------|--------|
| CHECKOUT_REPOSITORY | 74 LOC interface | Maps 5 distinct concerns (session, offer, order, identity, dashboard) |
| ConversationPort | Input sprawl | 9 parameters (cart, history, stage, missingFields, deliverySummary, shippingOptions, ...) |

### OCP Violations
| Scenario | Blocker |
|----------|---------|
| Add new OTP provider | Must change CheckoutCustomerService directly |
| Add new stage (e.g., review) | Must refactor deriveChatStage() + missingFieldsForStage() hardcoded stages |
| Add new validation rule | Must modify CheckoutShippingService regex patterns inline |

---

## Object Calisthenics

### Violations

#### 1. More Than 3 Fields per Class
- CheckoutCustomerService: 4 @Inject + 3 @Optional = 7 constructor params
- SendChatMessageUseCase: 6 @Inject + 4 @Optional = 10 constructor params
- CompleteOrderUseCase: 6 @Inject + 3 @Optional = 9 constructor params

**Fix:** Use named configuration object; split into specialized services.

#### 2. Methods with Multiple Responsibilities
- CheckoutCustomerService.processCustomerInput(): OTP validation + email capture + buyer recognition + account persistence (85 LOC)
- SendChatMessageUseCase.execute(): Customer input + shipping state + offer authorization + conversation reply + cross-sell (162 LOC)

**Fix:** Extract helper services; use pipeline pattern.

#### 3. Primitive Obsession
- Stage names: hardcoded strings "data_collection", "shipping", "payment", "completed"
- Offer types: "discount_percent", "shipping_free", "shipping_discount_fixed", "discount_fixed"
- Event names: TrackCheckoutEventUseCase input.event: CheckoutEventName (string)

**Fix:** Discriminated union types for stages/offers; enum for events.

#### 4. Deep Nesting
- CheckoutShippingService.tryParseAddressNumbers(): 20 LOC with 4-level if nesting
- CheckoutCustomerService.buildCustomerPatch(): 70 LOC with interspersed if/else for OTP vs. email vs. phone flows

**Fix:** Extract state machines; use early returns; use guard clauses.

#### 5. Mutable Collections
- UpdateCartUseCase.execute() lines 45-62: bySku.set() mutations in loop; Cart items updated in place
- CheckoutShippingService.trySelectShippingOption(): options array iterated with mutation risk

**Fix:** Use immutable update patterns; map/filter instead of imperative loops.

---

## Proposed Changes

### Phase 1: Extract God Services (HIGH priority, low risk)
1. Create `OtpService` (generation, validation, resend logic)
   - Takes: email/phone, rules
   - Returns: OtpCode, or throws OtpValidationError
   - Unit-testable independently

2. Create `BuyerRecognitionService` (find returning buyer, merge profile)
   - Takes: email, merchant_id
   - Returns: Recognized profile with resolved global_user_id
   - Replaces duplicated logic across CheckoutCustomerService

3. Create `BuyerAccountPersistenceService` (ensure account, update)
   - Takes: session, customer hints
   - Returns: persisted account or null
   - Isolated from session mutation

4. Refactor `CheckoutCustomerService` as thin orchestrator
   - Delegates OTP to OtpService
   - Delegates recognition to BuyerRecognitionService
   - Delegates persistence to BuyerAccountPersistenceService
   - Reduced from 460 LOC → ~150 LOC

### Phase 2: Fix Offer Authorization Invariant (CRITICAL)
1. Introduce `SafeAuthorizedOffer` type (phantom type over AuthorizedOffer)
2. Implement `isSafeGeneratedMessage()` validator
3. Update `CheckoutOfferService.authorizeOffer()` to return SafeAuthorizedOffer only
4. Add compile-time assertion: conversation replies cannot be used for authorization
5. Add integration test: LLM output cannot bypass rules-engine

### Phase 3: Extract Checkout Pipeline (HIGH priority)
1. Create `CheckoutMessagePipeline` service:
   ```typescript
   interface PipelineStage {
     execute(session: CheckoutSession, message: string): Promise<{
       session: CheckoutSession;
       error?: Error;
       checkpoint: string;
     }>;
   }
   ```
2. Stages: CustomerInput → ShippingState → OfferAuth → ConversationReply → Experience
3. Each stage checkpointable (resume on crash)
4. Simplify SendChatMessageUseCase to: load → pipeline.execute() → return

### Phase 4: Split Prisma Repository (MEDIUM priority, moderate risk)
1. Create 4 focused repositories:
   - PrismaCheckoutSessionRepository (sessions only)
   - PrismaOfferRepository (authorized + accepted offers)
   - PrismaOrderRepository (completed orders)
   - PrismaIdentityRepository (buyer identities)
2. Each ~150-200 LOC; single responsibility
3. Remove `as any` casts; add explicit type guards

### Phase 5: Extract Shipping State Machine (MEDIUM priority)
1. Create `ShippingStateExtractor` (zip → postal lookup → address confirmation)
2. Create `ShippingOptionSelector` (regex-based option selection)
3. Create `AddressDetailParser` (number + complement extraction)
4. CheckoutShippingService becomes orchestrator calling these

### Phase 6: Tenant Isolation Hardening (HIGH priority)
1. Add `TenantBoundaryGuard` utility:
   ```typescript
   assert.merchantIdMatches(offer.merchantId, expectedMerchantId);
   ```
2. Use in all cross-aggregate lookups: ApplyOfferUseCase, SendChatMessage, etc.
3. Add fuzz test: 100 random cross-tenant combinations; all must fail
4. Add unit test matrix: (merchantId_A, sessionId_A, offerId_B) → 403

### Phase 7: Decouple from BuyerEmailNotifier (MEDIUM priority)
1. Create `EmailNotificationPort` interface (not optional)
2. Implement deterministic test double
3. Make notifications part of outbox event stream
4. Remove @Optional() @Inject pattern

---

## Key Invariants to Enforce

| Invariant | Current Check | Gap |
|-----------|---------------|-----|
| LLM never authorizes offers | Conversation port separated; offer comes from rules-engine | No type system enforcement; easy to accidentally use reply.message as authorization |
| merchant_id scoping | Query filters in repository | Cached agent contexts not scoped; cross-session offer check missing merchantId |
| Offer math deterministic | evaluateDiscountOffer hard-caps maxDiscountPercent | Called twice in different places; could diverge |
| OTP code not logged | Code output to console.log (lines 191, 199, 239, 244, 247) | Visible in production logs; must be removed |
| Session immutable in transit | Entity is not; mutations via repository.saveSession() | Easy to mutate during orchestration; no rollback |
| Cart.total never includes discount | Comments in code (update-cart.use-case.ts line 18) | No type system guard; could be violated by new code |

---

## Implementation Roadmap

1. **Week 1:** Extract OtpService, BuyerRecognitionService, BuyerAccountPersistenceService (Phase 1)
   - Impact: CheckoutCustomerService -66% LOC; easier to test
   - Risk: Low (pure extraction, no behavior change)

2. **Week 2:** Fix offer authorization invariant (Phase 2)
   - Impact: Prevents LLM-generated offer claims
   - Risk: Medium (requires type system work; may break tests)

3. **Week 3:** Extract CheckoutMessagePipeline (Phase 3)
   - Impact: SendChatMessageUseCase -60% LOC; clearer flow
   - Risk: Medium (refactors core orchestration)

4. **Week 4:** Split Prisma repository (Phase 4)
   - Impact: Repository -70% LOC per file; easier to change schema
   - Risk: Medium (large refactor; must verify all queries)

5. **Week 5:** Extract shipping state machine (Phase 5)
   - Impact: CheckoutShippingService -50% LOC; regex patterns testable
   - Risk: Low (isolated, many unit tests exist)

6. **Week 6:** Tenant isolation hardening + decouple notifications (Phases 6, 7)
   - Impact: Cross-tenant security guarantee
   - Risk: Low (guardrails; can add incrementally)

---

## Testing Strategy

1. **Unit Tests (Per Service):**
   - OtpService: generation, validation, resend edge cases
   - BuyerRecognitionService: email lookup, global ID resolution
   - ShippingStateExtractor: zip → address → confirm flow
   - CheckoutMessagePipeline: stage chaining + error recovery

2. **Integration Tests:**
   - Full chat flow: start → messages → decision → order (existing; keep)
   - Cross-tenant rejection: offer/session from different merchants
   - Tenant isolation: 10x random (merchantId_A, sessionId_B) lookups → all 404/403

3. **Property Tests:**
   - Offer math: for all sessions, `evaluateDiscountOffer(cart, rules, max%)` deterministic
   - Cart totals: never negative, discount ≤ subtotal, shipping ≥ 0
   - OTP codes: always 6 digits, not in logs, not derivable from session

4. **Regression Tests:**
   - Existing e2e specs (checkout.full-purchase-flow, checkout.agentic-journey)
   - No behavior change expected; all should pass after refactor

---

## Summary

**GOD OBJECTS (Refactor):**
- CheckoutCustomerService (460 LOC) → 4 focused services
- SendChatMessageUseCase (208 LOC) → Pipeline + handlers
- PrismaCheckoutRepository (735 LOC) → 4 repositories

**CRITICAL BUGS (Fix):**
- Offer authorization not guarded against LLM-generated claims
- OTP codes logged to production console
- Tenant isolation gaps in offer reuse + agent context caching

**TECHNICAL DEBT (Reduce):**
- Port multiplicity: god-port still exported; use split ports
- Implicit transactionality: no clear boundaries for atomic operations
- Primitive obsession: stage/offer/event names as strings; use types

**ESTIMATED EFFORT:** 80 hours (6 weeks at 2 eng FTE)
**RISK:** Medium (large module; many tests; careful integration needed)
**PAYOFF:** 40% LOC reduction; 60% testability gain; critical security fixes; easier to add new stages/rules
