# Widget V2 MVVM + SOLID Refactor — Tasks

## Task Breakdown

### Phase 1: Setup + Abstraction Layer

#### T1.1: Create comment-removal script
**What:** Write `scripts/remove-comments.ts` to remove all `//` comments idempotently.
**Where:** `scripts/remove-comments.ts`
**Depends:** None
**Reuses:** None
**Done when:** Script runs, removes comments, is idempotent
**Tests:** Run twice on test file, verify identical output
**Gate:** `pnpm tsx scripts/remove-comments.ts` succeeds

---

#### T1.2: Create API abstraction layer
**What:** Extract API logic from components into typed clients in `src/api/`.
- `chat-session.ts` — chat message endpoints
- `support.ts` — ticket creation
- `payment.ts` — Stripe confirmation (refactor from direct fetch)

**Where:** 
- `src/api/chat-session.ts` (new)
- `src/api/support.ts` (new)
- `src/api/payment.ts` (new)

**Depends:** T1.1
**Reuses:** `src/api/checkout-session.ts` (types)
**Done when:**
- All three files export typed functions
- No fetch calls in components, only in api/ files
- Types match current usage

**Tests:**
```bash
pnpm typecheck
```

**Gate:** `pnpm typecheck` passes, no unused imports

---

#### T1.3: Create ViewModel interfaces
**What:** Define `viewModels/types.ts` with interfaces for each ViewModel.

**Where:** `src/viewModels/types.ts`

**Interfaces:**
```ts
export interface ChatViewModelInterface { ... }
export interface SupportViewModelInterface { ... }
export interface PaymentViewModelInterface { ... }
```

**Depends:** T1.2
**Reuses:** API types from `src/api/`
**Done when:** All interfaces defined, exported
**Tests:** Compile-time type check
**Gate:** `pnpm typecheck` passes

---

### Phase 2: ViewModel Implementation

#### T2.1: Implement useChatViewModel
**What:** Move ChatPanel business logic to `useChatViewModel` hook.
- Manage message state
- Handle sendMessage action
- Integrate with API
- Error reporting

**Where:** `src/viewModels/useChatViewModel.ts`

**Depends:** T1.2, T1.3
**Reuses:** `chatSessionApi`, store
**Done when:**
- Hook exports and implements ChatViewModelInterface
- No state leakage (closure-safe)
- 100% of ChatPanel fetch calls migrated

**Tests:**
```bash
pnpm test -- useChatViewModel
```

**Gate:** Tests pass, typecheck passes

---

#### T2.2: Implement useSupportViewModel
**What:** Extract SupportPanel's 7 useState + form logic into ViewModel.

**Where:** `src/viewModels/useSupportViewModel.ts`

**Depends:** T1.2, T1.3
**Reuses:** `supportApi`, store
**Done when:**
- Hook exports and implements SupportViewModelInterface
- Form state consolidated
- All fetch calls migrated to supportApi

**Tests:**
```bash
pnpm test -- useSupportViewModel
```

**Gate:** Tests pass, typecheck passes

---

#### T2.3: Implement usePaymentViewModel
**What:** Extract Stripe payment logic from StripeCardPayment into ViewModel.

**Where:** `src/viewModels/usePaymentViewModel.ts`

**Depends:** T1.2, T1.3
**Reuses:** `paymentApi`, store
**Done when:**
- Hook exports and implements PaymentViewModelInterface
- Stripe config injected (no hardcode)
- 100% of fetch calls migrated

**Tests:**
```bash
pnpm test -- usePaymentViewModel
```

**Gate:** Tests pass, typecheck passes

---

### Phase 3: Component Refactor

#### T3.1: Refactor ChatPanel
**What:** Replace internal logic with `useChatViewModel` hook.
- Delete all useState except ViewModel hook
- Delete all fetch/axios
- Update render to use ViewModel props

**Where:** `src/components/ChatPanel.tsx`

**Depends:** T2.1
**Reuses:** useChatViewModel, existing styling
**Done when:**
- Component ≤500 lines
- No fetch/axios in file
- Render logic unchanged (API-compatible)

**Tests:**
```bash
pnpm test -- ChatPanel
```

**Gate:** Tests pass, no breaking changes, typecheck

---

#### T3.2: Refactor SupportPanel
**What:** Same as T3.1, replace with useSupportViewModel.

**Where:** `src/components/SupportPanel.tsx`

**Depends:** T2.2
**Reuses:** useSupportViewModel
**Done when:**
- Component ≤400 lines
- No fetch/axios
- Render logic unchanged

**Tests:**
```bash
pnpm test -- SupportPanel
```

**Gate:** Tests pass, typecheck

---

#### T3.3: Refactor StripeCardPayment
**What:** Same as T3.1, replace with usePaymentViewModel.

**Where:** `src/components/StripeCardPayment.tsx`

**Depends:** T2.3
**Reuses:** usePaymentViewModel
**Done when:**
- No fetch/axios
- Stripe logic encapsulated
- Render only

**Tests:**
```bash
pnpm test -- StripeCardPayment
```

**Gate:** Tests pass, typecheck

---

### Phase 4: Cleanup + Verification

#### T4.1: Remove comments from widget_v2/src
**What:** Run comment-removal script on all src files.

**Where:** `src/**/*.{ts,tsx}`

**Depends:** T1.1, T3.3
**Reuses:** `scripts/remove-comments.ts`
**Done when:** All comments removed, code still valid
**Tests:** `pnpm typecheck`
**Gate:** `pnpm typecheck` passes

---

#### T4.2: Full integration test
**What:** Run all tests, build, typecheck.

**Where:** N/A (validation)

**Depends:** T4.1
**Reuses:** Existing test suite
**Done when:** All tests pass, build succeeds, no TS errors
**Tests:**
```bash
pnpm typecheck
pnpm test
pnpm build
```

**Gate:** 100% pass

---

#### T4.3: Architecture validation audit
**What:** Confirm no SRP/DIP/SOLID violations remain.
- Grep: no fetch in `/components/**/*.tsx`
- Grep: no API imports in `/components/**/*.tsx`
- Manual: review ViewModel interfaces for LSP

**Where:** N/A (validation)

**Depends:** T4.2
**Reuses:** None
**Done when:** All checks pass
**Tests:**
```bash
grep -r "fetch\|axios" src/components/**/*.tsx  # should return 0
grep -r "from.*api" src/components/**/*.tsx | grep -v "types" # should return 0
```

**Gate:** Grep returns 0 matches

---

## Dependencies (DAG)

```
T1.1 (script)
 ↓
T1.2 (api layer) ← T1.3 (interfaces) ← T2.1, T2.2, T2.3 (VMs)
                                        ↓         ↓         ↓
                                      T3.1      T3.2      T3.3
                                        ↓         ↓         ↓
                                      T4.1 (remove comments)
                                        ↓
                                      T4.2 (full test)
                                        ↓
                                      T4.3 (audit)
```

**Critical path:** T1.1 → T1.2 → T1.3 → T2.* → T3.* → T4.*

**Parallelizable:** T2.1, T2.2, T2.3 can run in parallel (once T1.* complete).
T3.1, T3.2, T3.3 can run in parallel (once T2.* complete).

---

## Effort Estimate

| Task | Est. Effort |
|------|-------------|
| T1.1 | 30 min      |
| T1.2 | 1–2 hrs     |
| T1.3 | 30 min      |
| T2.1 | 1–2 hrs     |
| T2.2 | 1 hr        |
| T2.3 | 1 hr        |
| T3.1 | 1–2 hrs     |
| T3.2 | 1 hr        |
| T3.3 | 1 hr        |
| T4.1 | 15 min      |
| T4.2 | 30 min      |
| T4.3 | 30 min      |
| **TOTAL** | **11–14 hrs** |

---

**Status:** Ready for execution  
**Owner:** TBD  
**Last Updated:** 2026-08-29
