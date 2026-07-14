# REFACTOR.md - coupons Module

## Current State

**Module Size:** 954 LOC (18 files)
**Architecture:** Clean Architecture with event-driven persistence
**Maturity:** Production-ready; coupon CRUD, apply, redemption, archive flows

**Structure:**
- **Domain:** CouponEntity (67 LOC), CouponRedemptionEntity (67 LOC), 3 policies (calculator, limit, validity), 2 ports (repository, rules-engine), domain event envelope
- **Application:** 5 use-cases (Create, Apply, Redeem, Archive, implied List via controller inject)
- **Infrastructure:** 2 in-memory repositories, RulesEngineDiscountAdapter, OnOrderCompletedHandler (event subscription)
- **Presentation:** MerchantCouponsController, WidgetCouponsController; no DTO (body structs inline in use-case signatures)
- **Tests:** Apply spec (210 LOC), policies spec (134 LOC), use-cases spec with cross-tenant assertions

**Key Invariants:**
- Coupon code normalized to uppercase; merchant_id + code is unique
- Discount must pass rules-engine authorization (margin check, max discount %)
- Redemption recorded once per session per coupon (@@unique constraint)
- Cross-tenant isolation: findById requires merchantId scoping (P2 fix documented)

---

## Issues

### CRITICAL

1. **Implicit Repository Injection in Controller**
   - WidgetCouponsController injects COUPON_REPOSITORY directly and calls findByCode synchronously in @Post apply
   - No dto validation layer before repository call
   - **Impact:** If repository is slow or throws, response stalls; no graceful fallback
   - **Location:** `widget-coupons.controller.ts:apply` method

2. **Redemption Event Handler Silently Consumes Errors**
   - CouponsOnOrderCompletedHandler.handle catches no errors; if redeem fails, event is silently lost
   - **Impact:** Order completes but coupon redemption is lost with no audit trail
   - **Location:** `on-order-completed.handler.ts` line 20–30

### HIGH

1. **No Repository Prisma Implementation**
   - CLAUDE.md requires Prisma as the only runtime persistence
   - CouponsModule wires InMemoryCouponRepository + InMemoryCouponRedemptionRepository as providers
   - **Impact:** Production state volatile; no persistence across restarts
   - **Location:** `coupons.module.ts` lines 30–35

2. **Missing Coupon Expiry Check in Apply**
   - ApplyCouponUseCase validates coupon.status and time window but does not re-check starts_at/ends_at at apply time
   - Race: coupon valid at check, expires between check and apply\n   - **Impact:** Expired coupon applied after expiry window; discount counted against merchant
   - **Location:** `apply-coupon.use-case.ts` line 30–40, missing validateCoupon re-call before redemption

3. **Unchecked OUTBOX_REPOSITORY Injection**
   - ApplyCouponUseCase and RedeemCouponUseCase both inject OUTBOX_REPOSITORY without checking if available
   - If not wired, events silently fail to persist
   - **Impact:** No audit trail for coupon applications; business intelligence gap
   - **Location:** Both use-cases; module provides no OUTBOX implementation

4. **DiscountRulesEnginePort Authorization Result Ignored in Archive**
   - ArchiveCouponUseCase does not check if coupon can be archived (no active redemptions)\n   - Can archive a coupon mid-redemption window\n   - **Impact:** Merchant can orphan active coupon redemptions\n   - **Location:** `archive-coupon.use-case.ts` line 15

### MEDIUM

1. **ApplyCouponUseCase Too Complex**\n   - 100 LOC; orchestrates validation, authorization, entity creation, session update, outbox append
   - Six injected dependencies\n   - **Impact:** Hard to test; multiple failure modes; unclear which step failed\n   - **Location:** `apply-coupon.use-case.ts` lines 1–100

2. **WidgetCouponsController Builds Experience Inline**\n   - Constructs buildExperienceFromSession response manually instead of delegating to checkout module\n   - Duplicates logic; coupling to checkout internals\n   - **Location:** `widget-coupons.controller.ts` line 50–70

3. **Coupon Policies Lack Composition**\n   - validateCoupon, checkCouponLimits, calculateCouponDiscount are standalone functions\n   - No shared context or composite validator\n   - **Impact:** Caller must know order of checks; no single point to add cross-policy rules\n   - **Location:** `domain/policies/*.ts`

4. **No Conflict Detection with Cross-Sell Promotions**\n   - If cross-sell discount + coupon both apply, no stacking policy enforced\n   - **Impact:** Margin could go negative; no visibility into stacked discount total\n   - **Location:** No interaction; silently stacks in checkout session\n   - **Blocked by:** Cross-sell module (see cross-sell REFACTOR.md)\n\n### LOW\n\n1. **CreateCouponUseCase Uses Inline Defaults**\n   - allowed_skus, blocked_skus, etc. default to empty arrays inline\n   - Could be constants in entity or domain object\n   - **Location:** `create-coupon.use-case.ts` line 20\n\n2. **InMemoryCouponRepository Key Collision Risk**\n   - Stores by merchantId:couponId; concurrent writes could collide\n   - Not a thread-safety issue (JS is single-threaded per event loop) but fragile for future\n   - **Location:** `in-memory-coupon.repository.ts` line 12\n\n---\n\n## Coupling Map\n\n```\ncoupons\n├── domain\n│   ├── CouponEntity (pure)\n│   ├── CouponRedemptionEntity (pure)\n│   ├── policies/ (pure; no deps)\n│   └── ports/\n│       ├── coupon-repository.port (contract)\n│       ├── coupon-redemption-repository.port (contract)\n│       └── discount-rules-engine.port (couples to rules-engine module)\n├── application\n│   ├── CreateCouponUseCase → repository\n│   ├── ApplyCouponUseCase → coupon-repo + redemption-repo + rules-engine + outbox + checkout (STRONG)\n│   ├── RedeemCouponUseCase → coupon-repo + redemption-repo + outbox\n│   ├── ArchiveCouponUseCase → coupon-repo\n│   └── (List via controller inject + repository)\n├── infrastructure\n│   ├── InMemoryCouponRepository (test double)\n│   ├── InMemoryCouponRedemptionRepository (test double)\n│   ├── RulesEngineDiscountAdapter → @zyon/rules-engine\n│   └── CouponsOnOrderCompletedHandler → checkout (event subscription)\n├── presentation\n│   ├── MerchantCouponsController → use-cases + auth\n│   ├── WidgetCouponsController → apply-use-case + embed-auth + checkout-session + merchant\n│   └── (no DTO layer)\n└── module\n    ├── imports: [EmbedModule, CheckoutModule, MerchantModule, AuthModule]\n    ├── providers: use-cases + adapters + in-memory repos\n    └── no Prisma repo wired (P1 BLOCKER)\n\nExternal:\n- @zyon/shared-types (Cart, MerchantRules)\n- @zyon/rules-engine (evaluateDiscountOffer)\n- @nestjs/common\n```\n\n**Coupling Hot Spots:**\n- ApplyCouponUseCase couples to 6 providers (too many)\n- WidgetCouponsController couples to checkout-session, merchant, and experience builder (tight)\n- No DTO layer between HTTP and use-case (validation boundary missing)\n\n---\n\n## Proposed Changes\n\n### P0: Implement Prisma Coupon Repository\n\n**Problem:** In-memory repositories violate CLAUDE.md; no production persistence.\n\n**Solution:**\n1. Implement PrismaCouponRepository and PrismaCouponRedemptionRepository\n2. Wire in coupons.module.ts instead of in-memory\n3. Add integration test for repository cross-tenant isolation\n4. Run existing test suite against Prisma repos\n\n**Estimate:** 4–5 hours\n\n---\n\n### P1: Fix Event Handler Error Handling\n\n**Problem:** CouponsOnOrderCompletedHandler silently loses errors.\n\n**Solution:**\n1. Wrap handle() in try-catch\n2. Log error with correlation_id and order_id\n3. Append error event to outbox or raise domain event for audit\n4. Add test that simulates failed redemption and confirms error is logged\n\n**Estimate:** 1–2 hours\n\n---\n\n### P2: Add Coupon Expiry Re-Check in Apply\n\n**Problem:** Race condition: coupon valid during check, expired during apply.\n\n**Solution:**\n1. Call validateCoupon again immediately before applying discount\n2. If expired, throw validation error (do not redeem)\n3. Add test that simulates expiry between validations\n\n**Estimate:** 1 hour\n\n---\n\n### P3: Decompose ApplyCouponUseCase\n\n**Problem:** 100 LOC; 6 dependencies; orchestrates too many concerns.\n\n**Solution:**\n1. Extract authorization step into CouponAuthorizerService (validates + checks rules-engine)\n2. Extract session update into CheckoutSessionUpdater (delegated to checkout module)\n3. Extract redemption recording into CouponRedemptionRecorder (applies, records, appends event)\n4. Reduce ApplyCouponUseCase to orchestration only (20–30 LOC)\n\n**Estimate:** 3–4 hours\n\n---\n\n### P4: Add Stacking Policy\n\n**Problem:** No visibility into stacked discount + cross-sell promotion totals.\n\n**Solution:**\n1. Create StackingPolicy similar to cross-sell.stacking.policy\n2. Validate totalDiscount (coupon + cross-sell) does not violate margin before apply\n3. Pass stacking context through checkout flow\n4. Add test that confirms margin check with stacked offers\n\n**Estimate:** 2–3 hours (blocked until cross-sell P3)\n\n---\n\n### P5: Add DTO Validation Layer\n\n**Problem:** No HTTP input validation; controller accepts raw JSON directly to use-case.\n\n**Solution:**\n1. Create CreateCouponDto, ApplyCouponDto with class-validator decorators\n2. Add @Body() DTO to controller methods\n3. Add validation tests for each DTO\n\n**Estimate:** 2 hours\n\n---\n\n## SOLID Compliance\n\n| Principle | Status | Notes |\n|-----------|--------|-------|\n| **S**ingle Responsibility | ⚠ | ApplyCouponUseCase does too much (authorize + apply + record + event). Policies are single-purpose but scattered. |\n| **O**pen/Closed | ⚠ | Repository ports are extensible, but validation logic is hard-coded in use-cases. |\n| **L**iskov Substitution | ✓ | Both repositories implement contract correctly. Adapter is drop-in. |\n| **I**nterface Segregation | ⚠ | ApplyCouponUseCase injects 6 dependencies; could split into smaller interfaces. |\n| **D**ependency Inversion | ✓ | Use-cases depend on ports, not concrete implementations. |\n\n**To Improve:** Extract sub-services (authorizer, recorder) so each use-case has 2–3 dependencies.\n\n---\n\n## Object Calisthenics\n\n| Rule | Status | Notes |\n|------|--------|-------|\n| 1. One level of indentation | ⚠ | ApplyCouponUseCase has nested validation checks (2+ levels). |\n| 2. No `else` | ⚠ | Some methods use if-else chains instead of early returns. |\n| 3. Wrap primitives in objects | ✓ | CouponEntity wraps snapshot. |\n| 4. First-class collections | ✓ | blockedSkus, allowedRegions wrapped in entity. |\n| 5. No getters/setters | ⚠ | Entity uses public properties on snapshot. |\n| 6. One dot per line | ✓ | No deep chaining. |\n| 7. No abbreviations | ✓ | Names are clear. |\n| 8. Keep classes small | ⚠ | ApplyCouponUseCase is 100 LOC. |\n| 9. No more than 2 instance variables | ✗ | ApplyCouponUseCase has 6. |\n\n**To Improve:** Decompose ApplyCouponUseCase into services (P3 above).\n\n---\n\n## Recommended Refactor Priority\n\n1. **First:** Implement Prisma repository (P0) — unblocks production deployment.\n2. **Second:** Fix event handler errors (P1) — prevents silent audit failures.\n3. **Third:** Re-check expiry (P2) — closes race condition.\n4. **Fourth:** Decompose ApplyCouponUseCase (P3) — improves testability and maintainability.\n5. **Fifth:** Add stacking policy (P4) — requires cross-sell collaboration.\n6. **Sixth:** Add DTO layer (P5) — hardens HTTP boundary.\n\n---\n\n## Reference Files\n\n- `/apps/api/src/modules/coupons/domain/entities/coupon.entity.ts`\n- `/apps/api/src/modules/coupons/domain/entities/coupon-redemption.entity.ts`\n- `/apps/api/src/modules/coupons/application/use-cases/apply-coupon.use-case.ts`\n- `/apps/api/src/modules/coupons/infrastructure/repositories/in-memory-coupon.repository.ts`\n- `/apps/api/src/modules/coupons/infrastructure/adapters/rules-engine-discount.adapter.ts`\n- `/apps/api/src/modules/coupons/infrastructure/event-handlers/on-order-completed.handler.ts`\n- `/apps/api/src/modules/coupons/presentation/http/widget-coupons.controller.ts`\n"}}