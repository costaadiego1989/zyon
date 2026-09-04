# Widget V2 MVVM + SOLID Refactor

**Status:** Specify  
**Complexity:** Large (multi-file architecture refactor)

## Objectives

1. **MVVM Architecture** — separate View (Components) → ViewModel (stores/hooks) → Model (API)
2. **SOLID Compliance** — SRP (no business logic in components), DIP (inject dependencies), OCP (extend, don't modify)
3. **Remove Comments** — all inline `//` comments deleted via automated script
4. **Code Standardization** — consistent naming, import paths, error handling patterns

## Current State (Violations Found)

### SRP Breaches
- **ChatPanel.tsx** — 18 useState, contains fetch() calls, API imports
- **SupportPanel.tsx** — 7 useState, contains fetch() calls
- **StripeCardPayment.tsx** — contains fetch() calls

### DIP Breaches
- Components directly import from `@/api/checkout-session`
- No abstraction layer (ViewModel/service)
- Hard-coded API paths

### MVVM Violations
- No explicit ViewModel layer
- State logic scattered across components
- Store (checkout-store.ts) mixed with component state

## Requirements

### R1: MVVM Layer
- Create `viewModels/` folder with verb-named classes (e.g., `useChatViewModel`)
- Move business logic from components to ViewModels
- ViewModels encapsulate state + derived state + actions
- Components only render and delegate to ViewModel

### R2: Remove Comments
- Automated script removes all `// comment` lines
- Preserve JSDoc blocks (`/** */`) for type hints
- Verify no logic-critical comments are removed

### R3: Standardize Architecture
- **Folder layout:**
  ```
  src/
    api/           → API clients (ports)
    viewModels/    → MVVM logic (use-case handlers)
    components/    → Pure render functions
    layouts/       → Page compositions
    store/         → Global state (Zustand)
    lib/           → Utilities
  ```
- **Import paths:** absolute `@/` only, no relative `../../../`
- **Naming:** camelCase for functions, PascalCase for components
- **Error handling:** centralized, no inline `console.error`

### R4: SOLID Enforcement
- **S:** Each file ≤300 lines, single responsibility
- **O:** Use composition over inheritance
- **L:** Replace if-else chains with polymorphic dispatchers
- **I:** Components depend on minimal interfaces
- **D:** Inject API clients + stores, don't hardcode

## Acceptance Criteria

- ✅ No fetch/axios in component files (all delegated to ViewModels)
- ✅ All `//` comments removed
- ✅ ChatPanel, SupportPanel, StripeCardPayment use ViewModels
- ✅ viewModels/ folder with 3+ ViewModel exports
- ✅ Zero SRP violations (analyzed via linter or manual audit)
- ✅ TypeScript strict mode passes
- ✅ Existing tests pass (or updated)
- ✅ No breaking changes to component APIs (for dependents)

## Deliverables

1. `.specs/features/widget-v2-refactor/design.md` — architecture diagram + component contracts
2. `.specs/features/widget-v2-refactor/tasks.md` — atomic tasks with dependencies
3. Script: `scripts/remove-comments.ts` — idempotent comment removal tool
4. Implementation: refactored files + new ViewModels
5. Verification: typecheck + test report

---

**Owner:** TBD  
**Priority:** High (debt reduction + maintainability)  
**Effort Estimate:** 3–5 days
