# Widget V2 Full MVVM Professional Completion

**Status:** Specify  
**Complexity:** Large/Complex (MVVM hooks + error handling + patterns)  
**Phase:** 2 (continuation of widget-v2-refactor)

## Vision

Transform widget_v2 from **API-client abstraction** (DIP fixed) to **full professional MVVM** with:
- Extracted ViewModel hooks (useChatViewModel, useSupportViewModel, usePaymentViewModel)
- Components as **pure render-only** (no business logic)
- **Centralized error handling** (reportError service)
- Professional patterns: dependency injection, composability, testability
- **Sub-100-line components** (ChatPanel current 1706 → 3 files ≤150 lines each)

## Current State (After Phase 1)

✅ API clients exist (`api/payment.ts`, `api/support.ts`)  
✅ Comments removed  
✅ DIP + SRP partially fixed (fetch moved)  
❌ ChatPanel: 1706 lines, 18 useState, **still god-component**  
❌ SupportPanel: 635 lines, 7 useState  
❌ StripeCardPayment: 129 lines, 3 useState (OK size but state-heavy logic)  
❌ No ViewModel layer  
❌ No centralized error handling  

## Requirements (MVVM)

### R1: ViewModel Hooks Layer
Create `src/viewModels/` with:
- `useChatViewModel()` — message state, send logic, crypto flow
- `useSupportViewModel()` — faq, chat, socket handling
- `usePaymentViewModel()` — stripe confirmation, state
- Each exports **typed interface** (ChatViewModelInterface, etc.)
- Each manages **derived state** (selectors, computed props)
- **Dependency injection:** store passed as arg, not global

### R2: Component Refactoring
- **ChatPanel** → split into 3 files max (ChatPanel + ChatMessages + ChatInput)
- **SupportPanel** → 2 files (SupportPanel + SupportMessages)
- **StripeCardPayment** → keep monolithic (small)
- All ≤150 lines per file
- Zero business logic in render (event handlers delegate to VM)
- Props = VM data + VM actions only

### R3: Error Handling Service
Create `src/lib/error-handler.ts`:
- `reportError(error, context?)` — centralized logging + UI feedback
- Network errors → user-friendly messages + retry
- Parse API error payloads → specific messages
- No scattered console.error() in components

### R4: Professional Patterns
- **Interface segregation:** VM interfaces minimal (only what component needs)
- **Composition over inheritance:** hooks compose other hooks
- **Memoization:** useMemo for derived state, useCallback for handlers
- **TypeScript strict:** all types explicit, no any
- **Constants:** magic strings in one place (API paths, error codes)

### R5: Testability Setup
- ViewModel hooks testable in isolation (jest + @testing-library/react-hooks)
- Mock store + API clients injected
- Components render with mocked VMs
- E2E tests remain (playwright)

## Acceptance Criteria

- ✅ ChatPanel ≤150 lines, zero business logic
- ✅ SupportPanel ≤150 lines, zero business logic
- ✅ `src/viewModels/` exists with 3 hooks + types
- ✅ `src/lib/error-handler.ts` exists, used in all VMs
- ✅ TypeScript strict + all tests pass
- ✅ Build passes, bundle size ≤260 KiB (gzip ≤55 KiB)
- ✅ Zero fetch/axios in component files
- ✅ All error paths use `reportError()`

## Risk & Decisions

### Risk: Large refactor, many touch points
**Mitigation:** Sub-agent parallel execution (VMs in parallel, components sequential once VMs done).

### Decision: Socket.io in ViewModel?
**Choice:** YES. SupportViewModel owns socket lifecycle (connect/cleanup). Component is pure consumer.

### Decision: Zustand store vs local state?
**Choice:** Global store for session data (sessionId, merchantId, api). Local state in VM for UI state (input, loading). Clear boundary.

## Deliverables

1. **Spec.md** (this file) — requirements + decisions
2. **Design.md** — architecture diagram, ViewModel contracts, error flow
3. **Tasks.md** — 15+ atomic tasks with dependencies
4. **ViewModel hooks** — 3 files in `src/viewModels/`
5. **Error handler** — `src/lib/error-handler.ts`
6. **Refactored components** — ChatPanel split, SupportPanel split
7. **Tests** — unit + E2E verification

---

**Owner:** TBD  
**Priority:** High (foundation for future features)  
**Effort Estimate:** 3–5 days (full team) or 2–3 days (parallel sub-agents)  
**Baseline Commits:** 5 (from Phase 1)  
**Target Commits:** +12–15 (Phase 2)
