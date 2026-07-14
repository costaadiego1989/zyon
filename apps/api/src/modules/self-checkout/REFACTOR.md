# REFACTOR.md - self-checkout Module

## Current State

**Module Size:** 1006 LOC (24 files)
**Architecture:** Clean Architecture with buyer auth + wallet + templates
**Maturity:** Production-ready but in-memory only; PCI pattern applied (P2 fix documented)

**Structure:**
- **Domain:** 5 entities (BuyerUser, BuyerWallet, BuyerSavedAddress, BuyerSavedPaymentMethod, BuyerCheckoutTemplate), 2 policies (consent, template-execution), 4 ports, events
- **Application:** 9 use-cases (Register, AddAddress, RemoveAddress, AddPaymentMethod, DeletePaymentMethod, CreateTemplate, ExecuteTemplate, ListTemplates, UpdateConsent)
- **Infrastructure:** 3 in-memory repositories, StubPaymentTokenizerAdapter (PCI boundary)
- **Presentation:** BuyerAuthController (removed; moved to buyer-account module), BuyerMeController with BuyerAuthGuard
- **Tests:** use-cases spec (420 LOC — comprehensive)

**Key Invariants:**
- Buyer email normalized to lowercase; (merchantId, email) unique
- Templates scoped by buyer_user_id (no IDOR)
- PAN/CVV never cross domain boundary (PCI pattern)
- Consent version validated before execution

---

## Issues

### CRITICAL

1. **In-Memory Repositories Only** [DONE]
   - Implemented PrismaBuyerUserRepository, PrismaBuyerWalletRepository, PrismaBuyerTemplateRepository
   - Module now wires Prisma via PRISMA_CLIENT injection
   - In-memory repos retained as test doubles only
   - **Location:** `infrastructure/repositories/prisma-buyer-*.repository.ts` + `self-checkout.module.ts`

2. **StubPaymentTokenizerAdapter Is Hard-Coded Mock** [TODO: Implement real payment tokenizer]
   - Generates fake tokens (deterministic, not PCI-compliant)
   - Cannot integrate with real payment gateway
   - **Impact:** No real payment flows in production
   - **Location:** `infrastructure/adapters/stub-payment-tokenizer.adapter.ts`

3. **No Atomic Transaction For Wallet + Outbox** [TODO: Wire Prisma transactional outbox]
   - AddSavedPaymentMethodUseCase: save wallet, then append outbox — two awaits
   - If second fails, wallet has payment method but no audit event
   - **Impact:** Payment methods persisted without audit trail
   - **Location:** `application/use-cases/add-saved-payment-method.use-case.ts` lines 30–50

### HIGH

1. **No Prisma Repositories Implemented** [DONE]
   - Prisma repos wired in module via useFactory pattern
   - **Location:** Module file `self-checkout.module.ts`

2. **Optimistic Locking Not Yet Wired** [TODO: Add version check to Prisma repository]
   - SelfCheckoutWallet has `version` field for optimistic locking (ADR noted)
   - But InMemoryBuyerWalletRepository does not check/increment version
   - **Impact:** Concurrent wallet mutations can lose data (last-write-wins)
   - **Location:** `in-memory-buyer-wallet.repository.ts` save() method

3. **Consent Policy Manual Version Bump Required** [TODO: Move to config/env]
   - CURRENT_CONSENT_VERSION = "v1" hard-coded
   - No schema versioning; changing policy requires code change
   - **Impact:** Cannot evolve consent policy without redeployment
   - **Location:** `domain/policies/consent.policy.ts` line 2

4. **Multiple Repositories With Same Pattern** [TODO: Consolidate after Prisma impl]
   - 3 in-memory repos (user, wallet, template)
   - 9 use-cases each inject appropriate repo subset
   - Manual integration tests for cross-tenant, IDOR protection
   - **Impact:** Maintenance burden scales linearly
   - **Location:** All under infrastructure/repositories/

### MEDIUM

1. **ExecuteCheckoutTemplateUseCase Has 3 Repositories + 3 Repos**
   - Wallets + templates + outbox + (no payment tokenizer)
   - 70 LOC orchestration with nested lookups
   - **Impact:** Complex to test; failure modes interleaved
   - **Location:** `application/use-cases/execute-checkout-template.use-case.ts`

2. **Wallet Entity Boundaries Thin**
   - BuyerWalletEntity adds/removes addresses and payment methods
   - Saved addresses/payment methods stored as JSON snapshots inline
   - **Impact:** Diffing is hard; no encapsulation of validation
   - **Location:** `domain/entities/buyer-wallet.entity.ts`

3. **BuyerAuthGuard Hidden in Presentation**
   - Custom JWT validation logic; not in domain
   - Should be a separate concern (auth is security boundary)
   - **Impact:** Mixed presentation/domain concerns
   - **Location:** `presentation/guards/buyer-auth.guard.ts`

4. **BuyerMeController Mixes Auth + Tokenization**
   - addMethod() tokenizes at edge, then delegates to use-case
   - Tokenization is not a use-case concern; OK
   - But controller does both auth + tokenization + orchestration
   - **Impact:** Controller is doing too much
   - **Location:** `presentation/http/buyer-me.controller.ts`

5. **Update Consent Lacks Version Validation** [DONE]
   - UpdateConsentUseCase now validates against CURRENT_CONSENT_VERSION
   - Throws BadRequestException if version mismatch
   - **Location:** `application/use-cases/update-consent.use-case.ts`

6. **No DTO Validation Layer**
   - Controller accepts raw JSON; no class-validator enforcement
   - **Impact:** Invalid inputs pass through to domain; clarity lost
   - **Location:** `presentation/http/buyer-me.controller.ts`

### LOW

1. **RemoveSavedAddressUseCase Lacks Wallet Existence Check**
   - Removes address from wallet; if wallet is empty, silently succeeds
   - **Impact:** No error but no-op behavior
   - **Location:** `application/use-cases/remove-saved-address.use-case.ts`

2. **ListTemplatesForBuyerUseCase Simple But Inconsistent**
   - Returns all templates for buyer; no pagination
   - Likely fine for self-checkout use case but inconsistent with other list ops
   - **Location:** `application/use-cases/list-templates-for-buyer.use-case.ts`

3. **StubPaymentTokenizerAdapter Validation Light**
   - Just assigns token; no card validation (Luhn, expiry check)
   - **Impact:** Invalid cards silently "tokenized"
   - **Location:** `infrastructure/adapters/stub-payment-tokenizer.adapter.ts`

---

## Coupling Map

```
self-checkout
├── domain
│   ├── entities/ (5 entities; wallet has nested JSON)
│   ├── policies/consent.policy (CURRENT version constant)
│   ├── policies/template-execution.policy (validation)
│   └── ports/ (4 contracts; all stubbed)
├── application
│   ├── RegisterBuyerUserUseCase → users + outbox
│   ├── AddSavedAddressUseCase → wallets
│   ├── RemoveSavedAddressUseCase → wallets
│   ├── AddSavedPaymentMethodUseCase → users + wallets + outbox + tokenizer (PCI boundary)
│   ├── DeleteSavedPaymentMethodUseCase → wallets
│   ├── CreateCheckoutTemplateUseCase → wallets + templates + outbox
│   ├── ExecuteCheckoutTemplateUseCase → wallets + templates + outbox
│   ├── ListTemplatesForBuyerUseCase → templates
│   └── UpdateConsentUseCase → users
├── infrastructure
│   ├── InMemoryBuyerUserRepository (no Prisma)
│   ├── InMemoryBuyerWalletRepository (no version check)
│   ├── InMemoryBuyerTemplateRepository (no Prisma)
│   └── StubPaymentTokenizerAdapter (mock)
├── presentation
│   ├── BuyerAuthController (REMOVED; moved to buyer-account)
│   ├── BuyerMeController → use-cases + custom auth guard
│   └── (no DTO layer)
└── module
    ├── imports: (none shown)
    └── exports: use-cases

External:
- @zyon/shared-types
- buyer-account module (auth ownership)
- (no payment gateway integration)
```

---

## Proposed Changes

### P0: Implement Prisma Repositories

**Problem:** All 3 repos in-memory; cannot deploy.

**Solution:**
1. Implement PrismaBuyerUserRepository
2. Implement PrismaBuyerWalletRepository (with optimistic locking on version)
3. Implement PrismaBuyerTemplateRepository
4. Implement PrismaBuyerSavedAddressRepository
5. Implement PrismaBuyerSavedPaymentMethodRepository
6. Wire all in self-checkout.module.ts
7. Add integration test for optimistic locking
8. Add IDOR protection tests at repository level

**Estimate:** 6–8 hours

---

### P1: Implement Real Payment Tokenizer

**Problem:** Stub adapter cannot tokenize real cards.

**Solution:**
1. Add a payment gateway integration (Stripe, Adyen, etc.) module
2. Implement PaymentTokenizerAdapter that delegates to gateway
3. Use @nestjs/config to load gateway credentials
4. Add test with mock gateway responses
5. Document PCI compliance in security review

**Estimate:** 4–6 hours

---

### P2: Atomic Wallet + Outbox Transaction

**Problem:** save + appendOutbox can split-brain.

**Solution:**
1. Use Prisma transaction (when available) to commit wallet + outbox together
2. Add `appendOutbox` to repo interface for transactional commit
3. Add test for atomicity (simulate outbox failure)

**Estimate:** 2–3 hours

---

### P3: Decouple Template Execution

**Problem:** ExecuteCheckoutTemplateUseCase has 3 repos + complex logic.

**Solution:**
1. Extract TemplateValidatorService (checks merchant policy + items in stock)
2. Extract PaymentMethodResolverService (finds + validates saved method)
3. Use-case becomes 30-LOC orchestrator
4. Add unit tests for each service in isolation

**Estimate:** 3 hours

---

### P4: Add DTO Validation Layer

**Problem:** No HTTP input validation.

**Solution:**
1. Create RegisterBuyerDto, AddAddressDto, AddPaymentMethodDto, CreateTemplateDto
2. Use class-validator decorators
3. Wire @Body() DTOs in controller
4. Add validation tests

**Estimate:** 2 hours

---

### P5: Refactor Consent Versioning

**Problem:** Hard-coded version constant.

**Solution:**
1. Move CURRENT_CONSENT_VERSION to config (environment variable)
2. Add migration mechanism: old versions marked deprecated
3. UpdateConsentUseCase validates against current version
4. Add deprecated version handling

**Estimate:** 2 hours

---

### P6: Consolidate Auth Concern

**Problem:** BuyerAuthGuard lives in self-checkout presentation.

**Solution:**
1. Move BuyerAuthGuard to shared/auth or buyer-account module
2. Export JWT validation as a shared concern
3. Self-checkout focuses on business logic
4. Add test that guard is reusable

**Estimate:** 1–2 hours

---

## SOLID Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **S**ingle Responsibility | ⚠ | ExecuteCheckoutTemplateUseCase does too much (validation + payment + address lookup + execution). |
| **O**pen/Closed | ✓ | Policies and ports extensible. |
| **L**iskov Substitution | ✓ | Repositories implement contract; tokenizer adapter is drop-in. |
| **I**nterface Segregation | ⚠ | Some use-cases couple to multiple repos when one larger port would suffice. |
| **D**ependency Inversion | ✓ | All use-cases depend on ports. |

---

## Object Calisthenics

| Rule | Status | Notes |
|------|--------|-------|
| 1. One level of indentation | ⚠ | ExecuteCheckoutTemplateUseCase has nested checks. |
| 2. No `else` | ✓ | Early returns used. |
| 3. Wrap primitives in objects | ✓ | Entities wrap snapshots. |
| 4. First-class collections | ✓ | Addresses and payment methods wrapped. |
| 5. No getters/setters | ⚠ | Public snapshot properties. |
| 6. One dot per line | ✓ | No deep chaining. |
| 7. No abbreviations | ✓ | Clear naming. |
| 8. Keep classes small | ⚠ | Wallet entity mixes 2 collections + wallet metadata. |
| 9. No more than 2 instance variables | ✗ | Wallet entity has many. |

---

## Recommended Refactor Priority

1. **First:** Implement Prisma repositories (P0) — production-blocking.
2. **Second:** Real payment tokenizer (P1) — feature completeness.
3. **Third:** Atomic transactions (P2) — prevents split-brain.
4. **Fourth:** Decompose template execution (P3) — testability.
5. **Fifth:** DTO validation (P4) — HTTP boundary hardening.
6. **Sixth:** Consent versioning (P5) — policy evolution.
7. **Seventh:** Consolidate auth (P6) — clean separation of concerns.

---

## Reference Files

- `/apps/api/src/modules/self-checkout/domain/entities/buyer-user.entity.ts`
- `/apps/api/src/modules/self-checkout/domain/entities/buyer-wallet.entity.ts`
- `/apps/api/src/modules/self-checkout/domain/entities/buyer-checkout-template.entity.ts`
- `/apps/api/src/modules/self-checkout/application/use-cases/execute-checkout-template.use-case.ts`
- `/apps/api/src/modules/self-checkout/application/use-cases/add-saved-payment-method.use-case.ts`
- `/apps/api/src/modules/self-checkout/infrastructure/repositories/in-memory-buyer-wallet.repository.ts`
- `/apps/api/src/modules/self-checkout/infrastructure/adapters/stub-payment-tokenizer.adapter.ts`
- `/apps/api/src/modules/self-checkout/presentation/guards/buyer-auth.guard.ts`
