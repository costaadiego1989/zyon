# Widget V2 Full MVVM Professional — Tasks

## Task Breakdown (Parallelizable)

### Phase 1: Setup + Foundations

#### T1: Create error-handler service
**What:** `src/lib/error-handler.ts` — parseErrorMessage, reportError, showErrorNotification
**Where:** `src/lib/error-handler.ts` (new)
**Depends:** None
**Reuses:** None
**Done when:** Service exports typed functions, handles all error codes
**Tests:** parseErrorMessage maps error codes → user messages correctly
**Gate:** `pnpm typecheck` passes

---

#### T2: Create ViewModel types + index
**What:** `src/viewModels/types.ts` + `src/viewModels/index.ts`
- ChatViewModelInterface
- SupportViewModelInterface
- PaymentViewModelInterface
- Reusable interfaces (Message, FaqItem, etc.)

**Where:** `src/viewModels/types.ts`, `src/viewModels/index.ts`
**Depends:** None
**Reuses:** `src/api/checkout-session` types
**Done when:** All interfaces exported, typed
**Tests:** Compile-time check
**Gate:** `pnpm typecheck` passes

---

### Phase 2: ViewModel Implementation [PARALLEL]

#### T3: Implement useChatViewModel [P]
**What:** Extract ChatPanel logic → `src/viewModels/useChatViewModel.ts`
- Messages state + actions (sendMessage, clearHistory)
- Crypto flow (connectWallet, confirmCryptoPayment, setStep, wallet)
- Derived state (canSend, isProcessing)
- Error handling via reportError
- **Current ChatPanel has:** 18 useState → consolidate to 5-6 in VM

**Where:** `src/viewModels/useChatViewModel.ts`
**Depends:** T1, T2
**Reuses:** useCheckoutStore, confirmCryptoPayment API client
**Done when:**
- Implements ChatViewModelInterface
- All ChatPanel useState logic moved
- No fetch calls (delegated to api clients)
- reportError called on every catch

**Tests:**
```bash
# Unit test (if setup exists, else skip)
pnpm test -- useChatViewModel
```

**Gate:** `pnpm typecheck` passes

---

#### T4: Implement useSupportViewModel [P]
**What:** Extract SupportPanel logic → `src/viewModels/useSupportViewModel.ts`
- FAQ load + chat state (messages, input, view, faqItems, ticketId)
- Socket.io lifecycle (connect on chat, cleanup)
- Actions (loadFaq, sendMessage, switchToChat)
- Error handling via reportError

**Where:** `src/viewModels/useSupportViewModel.ts`
**Depends:** T1, T2
**Reuses:** useCheckoutStore, fetchPublicFaq + sendSupportChat API clients
**Done when:**
- Implements SupportViewModelInterface
- All SupportPanel useState + socket logic moved
- reportError used consistently
- Socket cleanup in useEffect return

**Tests:** (same as T3)

**Gate:** `pnpm typecheck` passes

---

#### T5: Implement usePaymentViewModel [P]
**What:** Extract StripeCardPayment logic → `src/viewModels/usePaymentViewModel.ts`
- Processing, error, success state
- confirmStripePayment action
- Error handling via reportError

**Where:** `src/viewModels/usePaymentViewModel.ts`
**Depends:** T1, T2
**Reuses:** useCheckoutStore, confirmStripePayment API client
**Done when:**
- Implements PaymentViewModelInterface
- All payment state moved
- reportError on failure

**Tests:** (same as T3)

**Gate:** `pnpm typecheck` passes

---

### Phase 3: Component Refactoring (Sequential, once VMs done)

#### T6: Refactor ChatPanel (split into 3 files)
**What:**
- `ChatPanel.tsx` (≤100 lines) — orchestrator, useChatViewModel hook
- `ChatMessages.tsx` (≤60 lines) — pure render, props = {messages, loading, error}
- `ChatInput.tsx` (≤50 lines) — pure input + send button, props = {input, onInput, onSend}

**Where:**
- `src/components/ChatPanel.tsx` (refactored)
- `src/components/ChatMessages.tsx` (new)
- `src/components/ChatInput.tsx` (new)

**Depends:** T3 (useChatViewModel must exist)
**Reuses:** Existing render logic (no new UX)
**Done when:**
- All 3 files ≤100 lines each
- Zero business logic in components
- Prop types match ViewModel interface
- Crypto flow (wallet connect, tx confirm) works end-to-end

**Tests:**
```bash
pnpm build  # verify bundle still works
pnpm e2e -- --grep @chat  # existing E2E tests pass
```

**Gate:** Tests pass, component files ≤100 lines each, typecheck

---

#### T7: Refactor SupportPanel (split into 2 files)
**What:**
- `SupportPanel.tsx` (≤90 lines) — orchestrator
- `SupportMessages.tsx` (≤70 lines) — pure render + faq list

**Where:**
- `src/components/SupportPanel.tsx` (refactored)
- `src/components/SupportMessages.tsx` (new)

**Depends:** T4
**Reuses:** Existing render logic
**Done when:**
- Both files ≤90 lines
- Socket handling in ViewModel only
- FAQs + chat messages render correctly
- No fetch in component

**Tests:**
```bash
pnpm build
pnpm e2e -- --grep @support
```

**Gate:** Tests pass, ≤90 lines, typecheck

---

#### T8: Refactor StripeCardPayment
**What:**
- Keep monolithic (already 129 lines after phase 1)
- Replace inline state with usePaymentViewModel hook
- Simplify error handling

**Where:** `src/components/StripeCardPayment.tsx`

**Depends:** T5
**Reuses:** Stripe Elements + @stripe/react-stripe-js (unchanged)
**Done when:**
- Uses usePaymentViewModel
- Delegates confirmStripePayment to VM
- No inline error handling (uses reportError)
- ≤120 lines

**Tests:**
```bash
pnpm build
pnpm e2e -- --grep @payment
```

**Gate:** Tests pass, typecheck

---

### Phase 4: Validation

#### T9: Full typecheck + build
**What:** Verify entire project compiles, no new errors

**Where:** N/A (validation)

**Depends:** T6, T7, T8
**Done when:** `pnpm typecheck` + `pnpm build` both pass
**Gate:** 0 errors, 0 warnings (ignore pre-existing SupportFAB + shippingOptions)

---

#### T10: Architecture audit
**What:** Verify:
- Zero fetch/axios in `/components/**/*.tsx`
- All error paths use reportError
- ViewModel interfaces minimal + correct
- Component prop types match VM contracts

**Where:** N/A (validation)

**Depends:** T9
**Done when:** All checks pass
**Tests:**
```bash
grep -r "fetch\|axios" src/components/**/*.tsx  # should return 0
grep -r "console\.error" src/components/**/*.tsx  # should return 0
```

**Gate:** All checks pass

---

## Dependencies (DAG)

```
T1 (error-handler) ──┐
                     ├→ T3, T4, T5 [PARALLEL]
T2 (types) ──────────┤
                     ├→ T6, T7, T8 (seq, once VMs done)
                     │
                     ├→ T9 (full build)
                     │
                     └→ T10 (audit)
```

**Critical path:** T1 → T2 → T3/T4/T5 (parallel) → T6/T7/T8 (seq) → T9 → T10

**Parallelizable:** T3, T4, T5 (independent, no cross-deps)  
T6, T7 can start after T3/T4 respectively (T8 waits for T5).

---

## Effort Estimate

| Task | Type | Est. |
|------|------|------|
| T1 | error-handler | 30 min |
| T2 | types | 30 min |
| T3 | useChatViewModel [P] | 1.5 hrs |
| T4 | useSupportViewModel [P] | 1.5 hrs |
| T5 | usePaymentViewModel [P] | 45 min |
| T6 | ChatPanel split | 1.5 hrs |
| T7 | SupportPanel split | 1 hr |
| T8 | StripeCardPayment refactor | 45 min |
| T9 | Build + typecheck | 15 min |
| T10 | Audit | 30 min |
| **TOTAL** | | **9–10 hrs** (seq) / **6–7 hrs** (parallel) |

---

**Status:** Ready for execution  
**Sub-Agent Work:** T3, T4, T5 can run in parallel (3 agents, 2 hrs wall-clock)  
**Sequential:** T6→T7→T8→T9→T10 (4 hrs after VMs)
