# REFACTOR.md - agent-rules Module

## Current State

**Module Size:** 793 LOC (14 files)
**Architecture:** Clean Architecture (domain → application → infrastructure → presentation)
**Maturity:** Production-ready; working in dashboard

**Structure:**
- **Domain:** AgentRulesEntity (117 LOC), types, ports (2), guardrail invariants
- **Application:** 3 use-cases (Get, Update, GetContext) + repository dependency
- **Infrastructure:** PrismaAgentRulesRepository (80 LOC), InMemoryAgentRulesRepository (26 LOC), CheckoutSettingsContextAdapter (13 LOC)
- **Presentation:** Controller (63 LOC), DTO (159 LOC with extensive validation), module (34 LOC)
- **Test coverage:** Good (use-case spec, entity spec, controller spec, E2E spec)

**Key Invariants:**
- Safety guardrails (forbidUnauthorizedDiscounts, forbidUnauthorizedFreeShipping) cannot be disabled
- Default rules created in-memory if not persisted (side-effect-free GET)
- Agent identity, capabilities, guardrails, checkout settings all validated
- Scoped by merchantId + agentId or merchantId + userId

---

## Issues

### CRITICAL

None identified. The module is well-designed.

### HIGH

1. **Nested GetCheckoutSettingsContextUseCase Dependency**
   - GetAgentContextUseCase optionally injects CheckoutSettingsContextAdapter (optional dependency)
   - This creates subtle coupling: if adapter is not bound, context lacks checkout settings with no obvious indication
   - **Impact:** Silent degradation; tests may pass but production missing data
   - **Location:** `GetAgentContextUseCase` constructor, `withCheckoutContext` method

2. **DTO Patch Validation Incomplete**
   - AgentRulesPatchDto validates individual fields but not cross-field rules (e.g., can agentName be null if persona is defined?)
   - Guardrail toggle interdependencies not validated at DTO level
   - **Impact:** Invalid patches accepted at HTTP boundary, caught later in domain
   - **Location:** `dto/agent-rules-patch.dto.ts`

3. **Controller Parameter Extraction Fragile**
   - `currentUser(request as { user?: unknown })` uses cast; no type guard
   - If `request.user` is missing, control flow is undefined
   - **Impact:** Potential null ref if auth context malformed
   - **Location:** `agent-rules.controller.ts` all routes

### MEDIUM

1. **PrismaAgentRulesRepository toUpdate/toCreate Converters Hidden**
   - JSON serialization/deserialization of nested objects (identity, capabilities, guardrails) happens implicitly
   - No explicit transformer or validator on read-back
   - **Impact:** Silent type loss if Prisma JSON schema drifts; hard to debug
   - **Location:** `infrastructure/prisma-agent-rules.repository.ts` lines 40–60

2. **Module Exports Single Use-Case Only**
   - Only `GetAgentContextUseCase` exported; other use-cases internal
   - Limits composition from other modules
   - **Location:** `agent-rules.module.ts` exports array

3. **E2E Test Uses Direct Entity Instead of DTO**
   - E2E spec patches raw entity snapshot; doesn't validate DTO path
   - **Impact:** DTO validation bugs may not surface in E2E
   - **Location:** `agent-rules.prisma-e2e-spec.ts`

### LOW

1. **InMemoryAgentRulesRepository Production Wiring**
   - Not a code defect, but if ever wired to production by mistake, all state is volatile
   - **Mitigation:** Documented in CLAUDE.md (in-memory repos are test doubles only)

---

## Coupling Map

```
agent-rules
├── domain
│   ├── AgentRulesEntity (pure; no dependencies)
│   ├── agent-rules.types (re-exports from @zyon/shared-types)
│   └── ports/
│       ├── agent-rules-repository.port (defines contract)
│       └── checkout-settings-context.port (optional; couples to checkout-settings)
├── application
│   ├── GetAgentRulesUseCase → repository (strong)
│   ├── UpdateAgentRulesUseCase → repository (strong)
│   └── GetAgentContextUseCase → repository + checkout-settings (optional)
├── infrastructure
│   ├── PrismaAgentRulesRepository → Prisma (strong)
│   ├── InMemoryAgentRulesRepository → (no deps; test double)
│   └── CheckoutSettingsContextAdapter → checkout-settings.GetCheckoutSettingsContextUseCase (strong)
├── presentation
│   ├── AgentRulesController → use-cases (strong)
│   ├── AgentRulesPatchDto → class-validator (strong)
│   └── auth.guard (strong)
└── module
    ├── imports: [AuthModule, CheckoutSettingsModule]
    └── exports: [GetAgentContextUseCase]

External:
- @zyon/shared-types (AgentIdentity, AgentCapabilities, etc.)
- @nestjs/common (decorators, exceptions)
```

**Coupling Issues:**
- GetAgentContextUseCase couples to checkout-settings via optional adapter (implicit)
- DTO validation does not match domain constraints fully

---

## Proposed Changes

### P0: Fix Optional Dependency Coupling (GetAgentContextUseCase)

**Problem:** Optional checkout-settings adapter creates silent degradation.

**Solution:**
1. Make the adapter required (not @Optional)
2. If checkout-settings context is unavailable, throw NotFoundException or return a safe default with explicit fields marked as unavailable
3. Update DTO or response type to clarify which fields are conditional

**Estimate:** 1–2 hours

---

### P1: Strengthen DTO Validation

**Problem:** Patch DTO allows structurally valid but semantically invalid payloads.

**Solution:**
1. Add cross-field validation to AgentRulesPatchDto using class-validator decorators or custom validator
2. Ensure guardrail toggles cannot conflict with each other
3. Add integration test that tries invalid patch and confirms rejection at HTTP level

**Estimate:** 2–3 hours

---

### P2: Explicit JSON Converters in Repository

**Problem:** Prisma JSON storage is implicit; no explicit transformer.

**Solution:**
1. Extract `toCreate`, `toUpdate`, `toAgentRules` into a separate `converters.ts` file
2. Add type guards and explicit JSON schema validation on read
3. Add test that verifies round-trip integrity (write → read → write produces identical JSON)

**Estimate:** 2–3 hours

---

### P3: Type-Safe Request Extraction in Controller

**Problem:** `currentUser` cast is unsafe; no runtime guard.

**Solution:**
1. Add a guard function that validates `request.user` is defined before calling use-cases
2. Throw 401 if user context is missing
3. Extract guard into a reusable HTTP decorator (already exists in other modules; reuse if present)

**Estimate:** 1 hour

---

## SOLID Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **S**ingle Responsibility | ✓ | Each use-case has one job. Entity handles invariants. Adapter wraps external service. |
| **O**pen/Closed | ⚠ | Repository ports are extensible, but DTO validation is closed to cross-field rules. |
| **L**iskov Substitution | ✓ | Both repositories implement the same contract correctly. Adapter is drop-in. |
| **I**nterface Segregation | ⚠ | CheckoutSettingsContextPort is minimal (1 method), but GetAgentContextUseCase depends on both repository AND optional adapter—could split into a separate port. |
| **D**ependency Inversion | ✓ | All use-cases and adapters depend on abstractions (ports), not concrete implementations. |

**To Fix Interface Segregation:** Break out `CheckoutSettingsContextPort` as a required dependency explicitly, or provide a no-op adapter in agent-rules if checkout-settings is unavailable.

---

## Object Calisthenics

| Rule | Status | Notes |
|------|--------|-------|
| 1. One level of indentation | ✓ | Methods are well-factored. |
| 2. No `else` | ✓ | Controller and use-cases use early returns. |
| 3. Wrap primitives in objects | ✓ | AgentRulesEntity wraps the snapshot. Scope, mode, tone are enums/strings in types. |
| 4. First-class collections | ✓ | blockedPhrases, escalationTriggers are wrapped in entity. |
| 5. No getters/setters | ⚠ | Entity uses getters (id, merchant_id). Consider making immutable and using factory methods only. |
| 6. One dot per line | ✓ | No deep chaining. |
| 7. No abbreviations | ✓ | Names are clear (forbidUnauthorizedDiscounts, not forbidUnAuth). |
| 8. Keep classes small | ✓ | AgentRulesEntity is 117 LOC, which is reasonable for a rich domain object. |
| 9. No more than 2 instance variables | ✗ | AgentRulesEntity stores entire snapshot (12+ fields). This is acceptable for an aggregate root, but could be decomposed if needed. |

**To Improve Rule 5:** Consider making entity properties private and using only factory/rehydrate methods, forcing external code to use entity methods rather than direct property access.

---

## Recommended Refactor Priority

1. **First:** Fix optional checkout-settings dependency (P0) — eliminates silent failures.
2. **Second:** Add explicit JSON converters (P2) — hardens data layer.
3. **Third:** Strengthen DTO validation (P1) — catches more bugs earlier.
4. **Fourth:** Refactor request extraction (P3) — standardizes HTTP contract safety.

---

## Reference Files

- `/apps/api/src/modules/agent-rules/domain/entities/agent-rules.entity.ts`
- `/apps/api/src/modules/agent-rules/application/agent-rules.use-cases.ts`
- `/apps/api/src/modules/agent-rules/infrastructure/prisma-agent-rules.repository.ts`
- `/apps/api/src/modules/agent-rules/infrastructure/checkout-settings-context.adapter.ts`
- `/apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts`
- `/apps/api/src/modules/agent-rules/presentation/http/dto/agent-rules-patch.dto.ts`
