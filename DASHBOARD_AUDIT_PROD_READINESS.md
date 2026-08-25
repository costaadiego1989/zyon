# Dashboard Production Readiness Audit — CHECKOUT & INTELIGÊNCIA IA

**Date:** 2026-08-24  
**Scope:** 12 dashboard pages (8 CHECKOUT, 4 INTELIGÊNCIA IA)  
**Status:** IN PROGRESS — Multiple findings, P1 issues detected

---

## Executive Summary

Dashboard pages are **PARTIALLY MVVM-compliant** but exhibit critical data shape mismatches between API contracts and frontend expectations, stub endpoints, missing type safety, and auth/direct-fetch bypasses. Several pages cannot function correctly in production without fixes.

**Critical Blockers:** 3  
**Major Issues:** 8  
**Minor Issues:** 15+

---

## CHECKOUT SECTION

### 1. CheckoutSettingsPage ✅ MOSTLY READY

**MVVM:** Yes — Component + useCheckoutSettingsPage hook + checkoutSettingsEndpoints API layer  
**Hook:** useCheckoutSettingsPage.ts (proper MVVM)  
**API layer:** checkoutSettingsEndpoints (separate file)  
**Data:** Real API — calls `GET /checkout-settings`, `PUT /checkout-settings`  
**Loading state:** Yes — SettingsSkeleton component  
**Error state:** Yes — error banner with message  
**Empty state:** No (settings-only page)  
**Pagination:** N/A  
**Form validation:** Yes — validate() function checks min/max discounts  

**Issues:**
- ID: DASH-CK-001 | P2 | UX_GAP  
  Duplicate getStoreSettings method in merchants.ts (lines 73-79 and 133-135)

- ID: DASH-CK-002 | P2 | ARCHITECTURE  
  ETag lookup adds extra GET call on every save (line 14 useCheckoutSettingsPage.ts) — consider caching or server-provided ETag in response

- ID: DASH-CK-003 | P3 | CODE_QUALITY  
  Type-unsafe `any` types in API signatures should be CheckoutSettingsPatch

---

### 2. AgentConfigPage ⏳ PENDING AGENT AUDIT

Status: Awaiting detailed agent analysis.

---

### 3. CrossSellPage ⚠️ PARTIAL

**MVVM:** Yes — Component + useCrossSellPage hook  
**Hook:** useCrossSellPage.ts  
**API layer:** Inlined in merchants.ts (NOT separate file)  
**Data:** Real API — calls `GET /merchants/me/cross-sell-config`, `PUT /merchants/me/cross-sell-config`  
**Loading state:** Plain text "Carregando..." (NOT skeleton UI) — inconsistent with CheckoutSettingsPage  
**Error state:** No visible error UI — only toast (transient)  
**Empty state:** No  
**Pagination:** N/A  
**Form validation:** No — number inputs use Math.max/Math.min clamping only  

**Issues:**
- ID: DASH-CK-004 | P2 | ARCHITECTURE  
  API methods in merchants.ts typed as `Promise<any>` — no type safety for CrossSellConfig

- ID: DASH-CK-005 | P2 | UX_GAP  
  No persistent error state display — errors shown only as transient toast  

- ID: DASH-CK-006 | P2 | UX_GAP  
  No "dirty" state tracking — can't detect unsaved changes (unlike CheckoutSettingsPage which tracks dirty state)

- ID: DASH-CK-007 | P3 | UX_GAP  
  Missing "Discard Changes" button and "Restore Defaults" button (CheckoutSettingsPage has both)

- ID: DASH-CK-008 | P3 | ARCH  
  No ETag/If-Match optimistic locking (CheckoutSettingsPage implements this)

---

### 4. FunnelPage ⚠️ CRITICAL

**MVVM:** Yes — FunnelPage + useFunnelPage hook + funnel.ts API layer  
**Hook:** useFunnelPage.ts (474 lines)  
**API layer:** funnel.ts (separate file)  
**Data:** Real API — calls `GET /checkout/funnel/:merchantId`, `GET /storefront/funnel/:merchantId`, etc.  
**Loading state:** Yes — "Carregando sessoes..." text for sessions list  
**Error state:** **CAPTURED IN HOOK BUT NEVER RENDERED** — vm.error exists but FunnelPage.tsx has NO error UI  
**Empty state:** Partial — zeroed funnel structure shown + DataPanel empty state for sessions  
**Pagination:** Yes — client-side, PAGE_SIZE=10 for sessions  

**Issues:**
- ID: DASH-CK-009 | **P1** | **BUG** | **CRITICAL**  
  Error state captured but NEVER rendered — users see empty zeroed funnel with no explanation when API fails

- ID: DASH-CK-010 | P2 | BUG  
  Stale closure in useFunnelPage line 399 — `if (!data)` uses outer scope, making fallback condition unreachable on first error

- ID: DASH-CK-011 | P2 | UX_GAP  
  FunnelFilters component defined but NOT used — page inlines period+breakdown controls, leaving FunnelFilters.tsx as dead code

- ID: DASH-CK-012 | P2 | PERF  
  30s polling for sessions without Page Visibility API check — expensive when page is hidden

- ID: DASH-CK-013 | P3 | UX_GAP  
  No skeleton/shimmer for funnel data (only sessions show loading text)

---

### 5. ExperimentsPage ⚠️ MAJOR GAPS

**MVVM:** Yes — ExperimentsPage + useExperimentsPage hook + useExperimentForm hook + experiments.ts API layer  
**Hooks:** useExperimentsPage.ts + useExperimentForm.ts  
**API layer:** experiments.ts (separate file)  
**Data:** Real API — 10 endpoints defined and all match backend routes  
**Loading state:** Yes — "Carregando experimentos..." panel  
**Error state:** Yes — toast notifications on failures  
**Empty state:** Yes — EmptyState component + empty detail panel  
**Pagination:** No — experiments list scrolls without pagination (maxHeight + overflowY)  
**Form validation:** Yes — name (required, ≤255), variants (min 2, max 10), sample_size (10-1M)  

**Issues:**
- ID: DASH-CK-014 | **P1** | **BUG** | **NON-FUNCTIONAL**  
  autoEnabled toggle (line 44 useExperimentsPage.ts) is local state ONLY — NOT persisted to backend. Toggling does nothing.

- ID: DASH-CK-015 | P2 | BUG  
  ExperimentCard receives metrics prop but ExperimentsPage NEVER passes it — metrics always undefined, card falls back to `experiment.sample_size` for "Sessions" and "--" for conversion/revenue

- ID: DASH-CK-016 | P2 | UX_GAP  
  sortBy state tracked but NEVER exposed to UI — no sort controls rendered

- ID: DASH-CK-017 | P2 | UX_GAP  
  No confirmation dialog before archiving (destructive action fires immediately)

- ID: DASH-CK-018 | P2 | BUG  
  handlePromoteVariant checks confidence_level < 95 but if results are stale or API returns different confidence, guard may be wrong

- ID: DASH-CK-019 | P2 | UX_GAP  
  List doesn't auto-refresh after create/start/stop — only local state updates. Stale if another user modifies.

- ID: DASH-CK-020 | P3 | UX_GAP  
  ExperimentForm has UTF-8 encoding issues (mojibake in placeholders like "Ã©") — file encoding or build misconfiguration

---

### 6. NegotiationPolicyPage ⚠️ INCOMPLETE

(Full details in agent audit)

**Key Issues:**
- CRITICAL: attempts array initialized but NEVER populated — no loadAll logic to fetch them
- Missing: setExpandedAttempt state unused despite expandable UI in table
- Incomplete: getNegotiationSessions() endpoint exists but hook doesn't call it
- Incomplete: getNegotiationStats() endpoint exists but hook doesn't call it

---

### 7. CheckoutProgramavelPage (M2M Agents) ⚠️ STUBS

(Full details in agent audit)

**Key Issues:**
- Incomplete: AuditTab referenced but never implemented — imported, rendered, but no audit data in hook
- Missing: No refresh mechanism after agent create/suspend operations
- Missing: No loading state during create/suspend actions (setSaving exists but not used)

---

### 8. CouponsPage 🔴 SEVERE SHAPE MISMATCH

(Full details in agent audit)

**Key Issues:**
- **CRITICAL: Data shape mismatch** — hook returns `{id, code, type, value, isActive}` but page uses `{id, code, discountType, discountValue, minCartValue, maxUses, usedCount, startsAt, expiresAt, productId, categoryId, isActive, createdAt}`
- Missing API type conversion layer
- Form validation type inconsistency (discountValue stored as string but compared as number)
- Missing: No update/edit coupon functionality (create + toggle + delete, but no edit)
- Product/category IDs: API stores as comma-separated strings but page treats as string[] — serialization mismatch

---

## INTELIGÊNCIA IA SECTION

### 9. RevenueManagerPage 🔴 **CRITICAL SHAPE MISMATCH**

(Full details in agent audit output above)

**Key Issues:**
- **CRITICAL: Observations shape mismatch**  
  Frontend expects: `{ date, conversion_rate, top_objection, sessions_count }`  
  Backend returns: `{ id, merchant_id, observation_window_start, observation_window_end, funnel, abandonment, objections, cross_sell, current_experiment, cohorts, revenue, ai_costs_cents, created_at }`  
  **Result:** Frontend will render nothing or crash on `.conversion_rate` access

- **CRITICAL: Strategy-lessons field mismatch**  
  Frontend expects: `{ experiment_id, actual_winner, lift_percent, lesson, learned_at }`  
  Backend returns: `{ id, merchant_id, experiment_id, hypothesis_id, hypothesis_text, actual_winner, hypothesis_was_correct, control_conversion_rate, challenger_conversion_rate, conversion_lift_percent, sessions_per_variant, statistical_confidence, insights, generator_feedback, recorded_at }`  
  **Field names:** `lift_percent` ≠ `conversion_lift_percent`, `learned_at` ≠ `recorded_at`

- Missing error state UI — if initial load fails, user sees empty lists with no feedback

- Reject reason hardcoded to "Nao relevante" — user cannot provide real reason (UX issue, but backend accepts it)

---

### 10. CartRecoveryPage 🔴 **STUB ENDPOINT + AUTH BYPASS**

(Full details in agent audit output above)

**Key Issues:**
- **CRITICAL: GET /dashboard/cart-recovery/attempts is a STUB**  
  Returns: `{ merchantId, status, limit, offset, message }`  
  Expected: `CartRecoveryAttempt[]`  
  **Result:** Array.isArray(res) = false, table always empty

- **CRITICAL: Direct fetch() bypasses auth headers**  
  handleSendTest() uses raw `fetch(props.apiBaseUrl + "/cart-recovery/test-send")` instead of api layer  
  Skips JWT token, error normalization, interceptors  
  Request likely fails with 401 unless endpoint is unguarded

- CRITICAL: Hardcoded phone number "21993001883" in production code — dev phone hardcoded

- Cross-module dependency risk: Hook calls api.listCoupons() and api.getCheckoutSettings() from other modules  
  If those endpoints change, this page breaks silently

---

### 11. IntentMemoryPage ⏳ PENDING AGENT AUDIT

Status: Awaiting detailed agent analysis.

---

### 12. RevenueLiftPage ⏳ PENDING AGENT AUDIT

Status: Awaiting detailed agent analysis.

---

## ARCHITECTURAL PATTERNS OBSERVED

### API Layer Organization

**Good:**
- Dedicated endpoint files: checkoutSettingsEndpoints, revenueManagerEndpoints, funnel, experiments, cartRecoveryEndpoints, revenueLiftEndpoints
- Proper dashboardJson() wrapper with error handling
- Optional chaining on API calls is defensive (though sometimes unnecessary)

**Bad:**
- Cross-sell API inlined in merchants.ts with `any` types (should be separate cross-sell.ts)
- Coupons API inlined in integration.ts (should be separate coupons.ts)
- Intent-memory appears to have no dedicated endpoint file (needs investigation)
- M2M agents API in m2m-management.ts (acceptable but check for completeness)

### MVVM Compliance

**All 12 pages have useXxxxPage hooks** — this is good structural practice.  
**Issue:** Inconsistent implementation quality:
- CheckoutSettingsPage: Excellent (validation, error states, dirty tracking, ETag)
- CrossSellPage: Minimal (no error UI, no dirty tracking)
- RevenueManagerPage: Assumes API contract matches frontend shape (shapes are completely different)
- CartRecoveryPage: Mixed (some parts real API, some parts hardcoded/stubs)

### Error Handling

**Inconsistent:**
- FunnelPage: Captures error in hook but never renders it
- RevenueManagerPage: Catches errors but doesn't display them in UI
- CheckoutSettingsPage: Proper error banner with message
- CrossSellPage: Only transient toast (disappears immediately)

### Form Validation

**Present in:** CheckoutSettingsPage, ExperimentsPage  
**Missing in:** CrossSellPage, CouponsPage, NegotiationPolicyPage

---

## SECURITY FINDINGS

1. Direct fetch() in CartRecoveryPage bypasses auth headers — **P1 FIX REQUIRED**
2. Hardcoded phone numbers and test credentials should not exist in production code — **P1 FIX REQUIRED**

---

## PRODUCTION READINESS SCORECARD

| Page | MVVM | Data Shape | API Match | Error Handling | Form Val | Auth | Ready? |
|------|------|-----------|-----------|----------------|----------|------|--------|
| CheckoutSettings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟨 Minor |
| AgentConfig | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| CrossSell | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | 🔴 Needs Work |
| Funnel | ✅ | ✅ | ✅ | 🔴 Missing UI | N/A | ✅ | 🔴 Critical |
| Experiments | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟨 Bugs |
| NegotiationPolicy | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟨 Incomplete |
| CheckoutProgramavel | ✅ | ✅ | ✅ | ⚠️ Partial | ⚠️ Partial | ✅ | 🟨 Stubs |
| Coupons | ✅ | 🔴 Mismatch | 🔴 Mismatch | ✅ | ⚠️ Types | ✅ | 🔴 Broken |
| RevenueManager | ✅ | 🔴 Mismatch | ❌ Different | ⚠️ Missing | N/A | ✅ | 🔴 Broken |
| CartRecovery | ✅ | 🔴 Stub | 🔴 Stub | ✅ | N/A | 🔴 Bypass | 🔴 Broken |
| IntentMemory | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| RevenueLift | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |

---

## CRITICAL PATH FIXES (P1)

1. **RevenueManagerPage** — Fix observations/strategy-lessons shape mismatches
2. **CartRecoveryPage** — Implement actual /attempts endpoint, remove direct fetch() auth bypass, remove hardcoded phone
3. **FunnelPage** — Add error UI rendering (line: component should check vm.error)
4. **CouponsPage** — Add API type conversion layer, fix data shape mapping
5. **ExperimentsPage** — Remove autoEnabled toggle or implement persistence to backend

---

## FILES PENDING AGENT COMPLETION

- AgentConfigPage audit
- IntentMemoryPage audit
- RevenueLiftPage audit

Waiting for agent results to provide complete findings.

---

**Audit Timestamp:** 2026-08-24 21:30 BRT  
**Status:** AWAITING FINAL AGENT RESULTS (3 pages still in progress)
