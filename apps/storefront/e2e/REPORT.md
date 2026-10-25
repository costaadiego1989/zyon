# Storefront E2E Test Report

**Date:** 2026-08-16  
**Runner:** Playwright (Chromium)  
**Duration:** 20.2s  
**URL tested:** http://localhost:3001/store/demo

---

## Summary

| Metric | Value |
|--------|-------|
| **Total tests** | 35 |
| **Passed** | 25 (71%) |
| **Failed** | 10 (29%) |
| **Skipped** | 0 |

---

## By Category

### ✅ Chat Interaction (7/9 pass)

| Test | Status | Notes |
|------|--------|-------|
| typing and sending message creates user bubble | ❌ FAIL | Locator not finding user bubble after send |
| pressing Enter sends message | ❌ FAIL | Same — bubble locator issue |
| message appears in chat thread | ✅ PASS | |
| message history accumulates in thread | ✅ PASS | |
| compose form remains visible during interaction | ✅ PASS | |
| send button disabled when input is empty | ✅ PASS | |
| scroll area contains chat messages | ✅ PASS | |
| input placeholder text visible | ✅ PASS | |
| send button has icon | ✅ PASS | |

### ✅ Components (12/17 pass)

| Test | Status | Notes |
|------|--------|-------|
| intro screen shows before chat mode | ❌ FAIL | Intro screen locator mismatch (no role/label) |
| header renders after entering chat mode | ✅ PASS | |
| header contains Online badge in chat mode | ❌ FAIL | Badge text "Online" not found by getByText |
| theme toggle button visible in header | ✅ PASS | |
| channel toggle button visible in header | ❌ FAIL | Timeout — button locator using wrong selector |
| support button visible in header | ✅ PASS | |
| buyer hub trigger button visible in header | ✅ PASS | |
| intro screen shows PulseAgentOrb | ✅ PASS | |
| welcome state shows agent greeting | ❌ FAIL | Greeting text locator doesn't match dynamic name |
| quick reply buttons visible in intro state | ❌ FAIL | Locator expects intro mode but page auto-enters chat |
| chat mode button visible and clickable | ✅ PASS | |
| voice mode button visible and clickable | ✅ PASS | |
| chat composer visible and functional | ✅ PASS | |
| theme toggle switches between dark and light | ✅ PASS | |
| StoriesRow structure present in chat mode | ✅ PASS | |
| footer with policies renders in chat mode | ✅ PASS | |

### ✅ Quick Replies (6/9 pass)

| Test | Status | Notes |
|------|--------|-------|
| "Ver Produtos" renders product carousel | ❌ FAIL | LLM didn't call search_products (same issue as Ofertas was) |
| "Encontrar Produto" gets agent response | ✅ PASS | |
| "Categorias" triggers category carousel | ✅ PASS | |
| "Prazo de Entrega" asks for CEP | ❌ FAIL | LLM response didn't match CEP pattern in time |
| "Trocas e Devoluções" renders policy text | ✅ PASS | |
| "Rastrear Pedido" asks for order ID | ✅ PASS | |
| "Meus Dados" renders buyer profile or login | ✅ PASS | |
| "Ofertas" triggers product carousel (deterministic) | ✅ PASS ✨ | Deterministic bypass works! |
| quick replies render initially in welcome state | ❌ FAIL | Page auto-saves channel pref → skips intro |
| clicking quick reply disables input briefly | ✅ PASS | |

---

## Root Cause Analysis

### Category 1: Locator mismatches (5 failures)

**Tests:** intro screen, Online badge, channel toggle, agent greeting, quick reply buttons in intro

**Root cause:** Tests assume specific selectors (`getByText("Online")`, `getByRole("button", { name: /chat|voz/i })`) but the component uses custom inline styles without accessible labels in some cases. Also, the app auto-saves channel preference in localStorage — returning visitors skip intro entirely.

**Fix:**
- Add `aria-label` to Online badge, channel toggle buttons
- Clear localStorage in test `beforeEach`
- Use more resilient locators (data-testid or CSS selectors)

### Category 2: User bubble locator (2 failures)

**Tests:** typing creates user bubble, Enter sends message

**Root cause:** The test looks for a user bubble element after sending but the locator doesn't match the actual DOM structure of user messages (no role="listitem" or specific class — inline styles only).

**Fix:**
- Add `data-testid="user-message"` to user message bubbles in ConversationShell
- Or use `page.locator('[style*="align-self: flex-end"]')` as fallback

### Category 3: LLM tool-calling inconsistency (2 failures)

**Tests:** "Ver Produtos" carousel, "Prazo de Entrega" CEP

**Root cause:** Same issue as "Ofertas" had before the fix — the LLM (llama 3.1:8b) sometimes responds with text only and doesn't call the expected tool (`search_products`, etc).

**Fix:**
- Add deterministic bypasses for "Ver Produtos" (call `search_products` with `query: '*'` directly)
- Add bypass for "Prazo de Entrega" (respond with CEP prompt deterministically)
- Same pattern as the "Ofertas" fix already implemented

### Category 4: Intro state detection (1 failure)

**Test:** quick replies render initially in welcome state

**Root cause:** Page restores `channel` from localStorage. If previous test session set it, the page skips intro and goes straight to chat mode.

**Fix:**
- Add `await page.evaluate(() => localStorage.clear())` in `beforeEach`
- Or navigate with `?reset=true` param

---

## Improvement Recommendations

### High Priority

1. **Add deterministic bypasses for remaining quick replies** — "Ver Produtos" and "Prazo de Entrega" should not depend on LLM tool-calling. Same pattern as "Ofertas" fix.

2. **Add data-testid attributes** to key components:
   - User message bubble: `data-testid="user-msg"`
   - Agent message bubble: `data-testid="agent-msg"`
   - Quick reply buttons wrapper: `data-testid="quick-replies"`
   - Online badge: `data-testid="online-badge"`
   - Channel toggle: `data-testid="channel-toggle"`

3. **Clear localStorage in test setup** — prevents state leakage between tests.

### Medium Priority

4. **Increase LLM timeout to 45s** for non-deterministic quick reply tests — llama is slow on first call.

5. **Add retry logic in playwright config** — `retries: 1` for LLM-dependent tests.

6. **StoriesRow test** — currently passes but only checks DOM structure. Add visual regression test with screenshot comparison.

### Low Priority

7. **Cart FAB test** — add test verifying CartFAB renders above the composer (position check).

8. **Theme persistence test** — verify theme survives page reload.

9. **Voice mode test** — verify microphone permission prompt appears.

---

## What's Working Well

- **Ofertas deterministic bypass** — 100% reliable, fast (3.6s)
- **Component structure** — StoriesRow, footer, composer, theme toggle all render correctly
- **Chat flow** — messages accumulate, composer stays visible, send button state correct
- **Quick replies** — most LLM-dependent ones work (Categorias, Trocas, Rastrear, Meus Dados, Encontrar Produto)

---

## Next Steps

1. Fix the 5 locator issues (add aria-labels + data-testid)
2. Add "Ver Produtos" deterministic bypass
3. Add localStorage.clear() to test setup
4. Re-run → target 32/35 pass (91%)
