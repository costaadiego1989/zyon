# Dashboard Frontend Refactor Plan

**Scope:** `apps/dashboard/src/`
**Method:** Static architecture analysis (no code changes applied)
**Date:** 2026-07-14
**Author:** Architecture review

---

## 1. Executive Summary

The dashboard is a single-page React 18 application with Vite, TanStack Query-free data layer, custom auth, and an internal tab-based "router" hand-rolled in `main.tsx`. It works, but the architecture has accumulated four structural debts that, together, make every new page disproportionately expensive:

1. **One god file owns the entire shell** (`main.tsx`, 543 lines: auth UI, tab routing, error boundary, top bar, sidebar, CSS variables).
2. **One god module owns the entire API surface** (`api-client.ts`, 899 lines: 50+ endpoint factories, webhooks mappers, auth refresh, error class).
3. **Pages couple directly to `createDashboardApi()`**, re-instantiating per page, mixing data fetching with view rendering, and duplicating identical patterns (CSV export, error-toast, cursor pagination) per page.
4. **No routing library, no React Query, no design-system primitives** — 78 inline `style={{ ... }}` blocks in `main.tsx` alone, 49 in `support-settings-page.tsx`, 79 in `payment-connections-page.tsx`.

Three of the four issues are **CRITICAL** because they cap team velocity on every PR. The fourth is **HIGH** because it blocks consistent visual evolution.

After refactor, a new page should be roughly: 1 file with view + 1 hook call + 1 component composition. Today a new page is ~400 lines and ~250 of those lines are boilerplate the user did not sign up for.

---

## 2. Current Architecture (Snapshot)

```
apps/dashboard/src/
├── main.tsx                              543 lines  shell + auth + routing + CSS vars + error boundary
├── api-client.ts                         899 lines  50+ endpoints, refresh, error, mappers
├── styles.css                          3,531 lines  global tokens (CSS vars), utility classes
├── components/                           190        LivePreviewPanel, Pagination, save-banner, etc.
└── pages/                             8,696        17 page files (3 over 600 lines, 1 is 1,402)
```

**Stack observed:**
- React 18 + Vite + TypeScript
- Lucide icons
- Native `fetch` (no axios, no react-query)
- `import.meta.env` for runtime config (`VITE_API_BASE_URL`, `VITE_MERCHANT_ID`, `VITE_WIDGET_BUNDLE_URL`)
- Custom `CustomEvent("aacp:session_expired")` for auth-session-fanout
- Per-page `useMemo(() => createDashboardApi({ baseUrl }), [baseUrl])` — repeated 17 times
- No router — tabs are `useState<TabKey>` in `App`
- Tests: Vitest, msal of spec files (Pages + components)

---

## 3. Findings (Severity-Ordered)

### CRITICAL #1 — `main.tsx` is a 543-line god file

**Evidence (`apps/dashboard/src/main.tsx`):**

| Concern | Lines | Notes |
|---|---|---|
| Auth screen markup | 130–306 | 170 lines of `style={{ oklch(...) }}` for split-screen branding |
| PageErrorBoundary class | 91–128 | Co-located, not reusable |
| Sidebar nav, env badge, logout | 429–483 | Inline-styled, hard-coded nav config |
| Top bar, breadcrumb, shell wrapper | 486–507 | Inline CSS-variable dance on a `<div>` |
| Manual tab router (15 ternaries) | 510–535 | `<PageErrorBoundary key={tab}>{tab === "x" ? <X /> : null}` ×15 |
| CSS-variable bootstrap | 427 | All design tokens injected as inline `style={{ "--ink": ..., "--accent": ... }}` |
| API inst + 9 useState hooks | 308–318 | Single component owns: tab, me, authMode, email, password, merchantName, authHint, busy, checkingSession |

**Violations:**
- **SRP:** `App` does auth, routing, shell, theme CSS-var bootstrap, session recovery, AND sign-in error parsing.
- **OCP:** Adding a new tab requires editing `NAV_ITEMS`, the `TabKey` union, the 15-ternary ladder, and the icon import block. No route registration contract.
- **Re-render fanout:** Any auth state change (`authHint`, `busy`, `checkingSession`) re-renders the entire shell including the active page, because every page lives as a child of `App`.
- **`key={tab}` on PageErrorBoundary** (`main.tsx:510`) — clever way to reset on tab change, but it also remounts the whole subtree and abandons in-flight requests, scroll position, and filters. Subtle UX bug.

**Severe child issues:**
- `AuthScreen` (`main.tsx:139–306`) is **167 lines of presentational markup inside the shell file**. It belongs in `features/auth/AuthScreen.tsx`.
- `friendlyAuthError` (`main.tsx:130–137`) — domain mapping inside the shell. Belongs with the auth code that produces the errors.
- Tab state in `App` does not survive a page reload — refreshing on `/audit-log` lands the user back on `/overview`.

---

### CRITICAL #2 — `api-client.ts` is a 899-line god module

**Evidence (`apps/dashboard/src/api-client.ts`):**

| Concern | Lines | Notes |
|---|---|---|
| `createIdempotencyKey`, `stableIdempotencyKey` | 827–837 | HTTP-utility functions embedded |
| `DashboardHttpError` | 22–31 | Error class co-located |
| `dashboardFetch` + `silentRefresh` + `SESSION_EXPIRED_EVENT` | 309–402 | Auth-refresh dance, idempotency injection, fanout event |
| 50+ `createDashboardApi` return-object methods | 411–823 | Auth, merchants, theme, checkout-settings, support, integrations, webhooks, orders, customers, payments, onboarding, billing, payments/connections, audit, agent-rules, negotiation, commerce, installations, embed |
| 70+ lines of type definitions | 53–297 | One type per external concept |
| `mapWebhookEndpoint`, `mapWebhookDelivery` | 868–899 | Adapter layer inside the SDK |
| `CursorPage<T>`, `normalizeApiBase`, `mergeUrl`, `versionedPath` | 18–51, 298–307 | Generics + URL helpers |

**Violations:**
- **SRP:** the module is the SDK, the error class, the auth-refresh controller, the URL builder, and the webhook mapper.
- **OCP:** adding a new endpoint touches this file. Any schema change requires touching this file even if no other file changes.
- **Type duplication:** types like `MerchantProfile`, `EmbedSessionResponse`, `CursorPage<T>` are defined here even though the underlying `shared-types` package already has many of them. The `export type { MerchantTheme, OnboardingStateResponse, OnboardingStepId } from "@zyon/shared-types";` re-export on line 16 confirms the gap — only three types were salvaged.
- **`getCustomers` vs `getCustomersPage`** (lines 623–646): two methods, same endpoint, one unwraps and one does not. Both live; `CustomersPage` uses `getCustomersPage`, others may not. Evidence the API layer grew by accretion.
- **Duplicate URL builders**: `mergeUrl` (`api-client.ts:45`), `normalizeApiBase` (18), `versionedPath` (38), `mergePath` (33) — four helpers for one job (build absolute URL).

---

### CRITICAL #3 — Pages couple directly to `createDashboardApi` and duplicate state-shape logic

**Evidence:** grep for `createDashboardApi` → 21 hits across `main.tsx`, `LivePreviewPanel`, 17 pages, 4 spec files. Every page that calls the API does the same dance:

```tsx
// repeated in 15 places
const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
```

Sample occurrences: `audit-log-page.tsx:95`, `customers-page.tsx:90`, `billing-page.tsx:104`, `commerce-connections-page.tsx:?`, `payment-connections-page.tsx:?`, `overview-demo-page.tsx:?`, `merchant-rules-page.tsx:?`, `theme-page.tsx:?`, `orders-shipments-page.tsx:?`, `onboarding-wizard.tsx:?`.

**Specific DRY violations confirmed by reading 3 pages:**

1. **Cursor pagination** — implemented twice:
   - `audit-log-page.tsx:96–151` (`events`, `nextCursor`, `hasMore`, `loading`, `loadingMore`, `load`, `loadMore`)
   - `customers-page.tsx:91–161` (`rows`, `nextCursor`, `hasMore`, `busy`, `loading`, `loadingMore`, `load`, `loadMore`)
   Plus `Pagination.tsx` (`pagination UX`) and `orders-shipments-page.tsx`. Three implementations of the same pattern.

2. **`text(value): string` fallback helper** — defined in:
   - `customers-page.tsx:35–37`
   - `audit-log-page.tsx:69–75` (`readError`)
   - `billing-page.tsx:?`
   - `main.tsx:130–137` (`friendlyAuthError`)
   Each slightly different (one returns `"-"`, one returns the raw body, one maps auth codes).

3. **CSV export** — `audit-log-page.tsx:77–90` (`exportCsv`) and almost identical blocks in `customers-page.tsx:194+`, `orders-shipments-page.tsx:?`. Different headers, same Blob+URL+anchor pattern.

4. **Page-head + button-row markup** — repeated across every page (`<header className="page-head">`, eyebrow + h1 + `<p className="page-lead">`, action buttons on the right). Visible in `audit-log-page.tsx:169–197`, `customers-page.tsx:?`, `billing-page.tsx:?`. No shared `<PageHeader>` component.

5. **"Skeleton row / empty state" markup** — `audit-log-page.tsx:244–268` and `customers-page.tsx:?` both hand-roll table skeletons. `rules-skeleton.tsx` exists for rules but is not generalized.

6. **`if (!props.me) return <header ... />`** — repeated as the very first guard in every page (`audit-log-page.tsx:154–165`, `customers-page.tsx:??`, `billing-page.tsx:?`, etc.). A `<RequiresAuth>` wrapper would absorb this.

**State management issues:**
- **No data layer.** Every page has its own `useState` zoo: `loading`, `loadingMore`, `busy`, `error`, `data`, `nextCursor`, `hasMore`, `setEvents`, `setError`, etc. Two pages re-fetch on `me` change, others re-fetch on tab switch, others have an `eslint-disable react-hooks/exhaustive-deps`. Stale data on tab switch is common.
- **Prop drilling `me: MerchantProfile | null` through every page component.** `main.tsx:511–535` passes `me` to 15 child pages. Each page re-derives `defaultMerchantId = me.id || DEFAULT_MERCHANT_ID` (line 520). `MerchantProfile` should be in a context, not a prop.
- **Prop drilling `apiBaseUrl` as well.** The API client is recreated on every page (`useMemo`, separate per page), but the same `apiBaseUrl` is plumbed through 15 components. A single context provider would eliminate both.

---

### HIGH #4 — No design system / inline styles everywhere

**Evidence:** inline `style={{ ... }}` counts:

| File | Inline `style` count |
|---|---|
| `main.tsx` | 78 |
| `payment-connections-page.tsx` | 79 |
| `support-settings-page.tsx` | 49 |
| `orders-shipments-page.tsx` | 34 |
| `preview-page.tsx` | 28 |
| `theme-page.tsx` | 20 |
| `LivePreviewPanel.tsx` | 10 |
| `Pagination.tsx` | 6 |

`styles.css` is **3,531 lines**, but pages still reach for inline `style={{ oklch(96% 0.002 145), font: "600 13.5px ..." }}` instead of utility classes or CSS modules. This means:

- Two ways to apply the same color (token vs. raw oklch duplication).
- Hover/active/focus states cannot be expressed inline — they require duplicating markup or two versions of every interactive element.
- Main file defines `--serif`, `--mono`, `--sans` as inline style on `<div>` (line 427) instead of `:root` in `styles.css`. If the body wrapper is removed, the design tokens vanish with it.
- `font:` shorthand appears 35 times in `main.tsx` alone. CSS has `font-weight`, `font-size`, `font-family`, `letter-spacing` as proper properties; the shorthand is meant for combining them — using it inline obscures intent.

**Violations:** KISS (each inline style is a fresh decision), DRY (the same `--ink`, `--accent` colors duplicated 12 times in `AuthScreen`), SRP (markup and presentation are inseparable).

**Accessibility gaps observed while reading markup:**
- `AuthScreen` (`main.tsx:139–306`) uses inline tab buttons with no `role="tab"` / `aria-selected` / keyboard arrow handling. The `role="tablist"` is set, but the buttons are missing tab semantics.
- "Esqueceu a senha?" link (`main.tsx:251`) has `onClick={() => {}}` — stub that does nothing. Will trip a11y audits.
- Sidebar nav items (`main.tsx:456–468`) are `<div onClick>` not buttons or links. No `aria-current`, no `<a href>` fallback.
- `style={{ cursor: "pointer" }}` everywhere instead of semantic interactive elements.
- Decorative SVGs (`main.tsx:187`) have `aria-hidden` not consistently applied.
- `LivePreviewPanel.tsx:175–178` `<iframe>` has `title` — good; but no `aria-label` on the surrounding section, and the "preview" presentation toggle (`floating` / `conversational`) has no `aria-pressed`.

---

### HIGH #5 — `LivePreviewPanel.tsx` does too much for one component

**Evidence (`apps/dashboard/src/components/LivePreviewPanel.tsx`, 190 lines):**

The component is responsible for:
1. Creating its own `createDashboardApi` instance (`useMemo([apiBaseUrl])`).
2. Issuing embed-session tokens (`issueToken`).
3. Composing an `srcdoc` HTML document (`useMemo` with array-joined HTML).
4. Injecting presentation-specific CSS overrides into the iframe source.
5. Wiping stale `srcDoc` when token/presentation change (`key={\`${presentation}:${token}\`}`).
6. Bridging postMessage `THEME_UPDATE` events (via imperative ref).
7. Rendering its own empty/error/loading states.
8. Rendering its own presentation toggle UI.

**Violations:**
- SRP — should be split into: `useEmbedSession`, `buildPreviewSrcDoc(theme, presentation)`, `<WidgetToolbar>`, `<WidgetFrame>`.
- `srcdoc` (`LivePreviewPanel.tsx:101–122`) is the heaviest 22-line function — pure presentation-data generation, untested, and built via array.join with template literals. Extract to a pure module.
- The `// eslint-disable-next-line react-hooks/exhaustive-deps` on `useEffect(() => { void issueToken(); }, [api, me])` (line 86) warns the developer that the linter is right — the dependency on `api` and `me` causes double-issuing when the parent re-renders. The mounted effect should run only on `me?.id` change.

---

### HIGH #6 — No router means no shareable URLs, lost scroll, and ad-hoc navigation

**Evidence:** `TabKey` union in `main.tsx:52–68`, `NAV_ITEMS` in `main.tsx:72–89`, tab state held in `App` at `main.tsx:310`. Navigation is `setTab(item.key)` (line 459). `<OnboardingWizard onNavigate={(target) => setTab(target)} />` (line 515).

**Consequences:**
- Refreshing `/audit-log` returns user to `/overview` (default tab).
- Cannot deep-link to `/audit-log?action=delete`.
- Browser back/forward does nothing.
- `OnboardingWizard.onNavigate` is a callback prop, not a real API. It must be passed through the only thing that owns tabs.

**Action:** install `react-router-dom` v6+. Map each `TabKey` to a route. Persist onboarding-resume via route guard, not mounted-effect.

---

### MEDIUM #7 — No global error handling fanout

**Evidence:** `PageErrorBoundary` in `main.tsx:91–128` covers tab subtree. There is no:
- Top-level error boundary for the auth screen — a throw in `AuthScreen` bricks the app.
- `window.onerror` / `unhandledrejection` listener.
- Network-error retry policy (one bad 503 → user sees stale UI forever).
- Sentry / OTEL hook.

`useEffect(() => { window.addEventListener(SESSION_EXPIRED_EVENT, ...) }, [])` in `main.tsx:353–361` is the only global side-effect. That same pattern should be used for `window.onerror` and the network-status event.

---

### MEDIUM #8 — `LivePreviewPanel` postMessage uses `targetOrigin: "*"`

**Evidence** (`LivePreviewPanel.tsx:97`): `postMessage(payload, "*")` sends theme updates to the iframe with a wildcard origin. Acceptable here (the iframe content is trusted widget bundle), but the design abstracts `theme: unknown` — no runtime validation. A malformed theme object will fail silently inside the widget.

---

### MEDIUM #9 — Bundle / lazy-loading

`main.tsx:31–46` statically imports every page. None of the 17 pages are lazy. Result: the initial dashboard bundle carries OnboardingWizard (1,402 LoC) and CheckoutSettingsPage (1,163 LoC) even for a merchant who already completed onboarding. Convert each page to `React.lazy(() => import(...))` and split per route.

---

### MEDIUM #10 — `refreshSession` setTab race (subtle UX bug)

**Evidence** (`main.tsx:326–328`):
```ts
try {
  const onboarding = await api.getOnboardingState();
  if (!onboarding.completed && checkingSession) setTab("onboarding");
} catch { /* swallow */ }
```

`setTab("onboarding")` runs **after** `setMe`, but inside the same `try/catch`. If the user clicked a tab between `setMe` and `setTab("onboarding")`, the forced resume overrides their click. The guard `&& checkingSession` only protects during the initial mount; later re-calls (e.g. after a failed `refreshSession`) re-enter this branch.

---

### MEDIUM #11 — `eslint-disable react-hooks/exhaustive-deps` appears in multiple pages

**Evidence:** at least `audit-log-page.tsx:117`, `customers-page.tsx:111`, `LivePreviewPanel.tsx:86`. These are silent debt markers — every one is a code smell where `useEffect` deps lie. After introducing React Query or a typed data hook, all three disappear.

---

### MEDIUM #12 — Test coverage gap

**Observed:** Every page has a co-located `*.spec.ts(x)`. However:
- `main.tsx` has **zero tests** for the shell, auth flow, tab routing, error boundary, session-expired listener, or logout. The most-coupled file in the codebase is untested.
- `api-client.ts` has only a single spec file for P0/P1 endpoints (`api-client.spec.ts`, `api-client-p0p1.spec.ts`). The other 40+ endpoints are uncovered.
- `LivePreviewPanel` — no spec for srcdoc composition (the pure function that is the highest-risk part of the file).

---

### LOW #13 — `DEFAULT_MERCHANT_ID = "mrc_demo"` as fallback

**Evidence** (`main.tsx:50`): when `me.id` is falsy the dashboard falls back to a demo merchant id. This will silently route live operator requests to a demo merchant if the profile response shape ever drops the `id` field. Better: surface the error.

---

### LOW #14 — `index.ts` re-export barrel in `pages/checkout-settings/`

**Evidence** (`apps/dashboard/src/pages/checkout-settings/index.ts`): barrel re-exports. Generally fine — but combined with `import { CheckoutSettingsPage } from "./pages/checkout-settings/index.js";` (in `main.tsx:33`), it normalizes the heavy-import path. After refactor, move to `pages/checkout-settings/CheckoutSettingsPage.tsx` and let TS path resolution handle it.

---

### LOW #15 — `useMemo` over-rotation

Every page does `useMemo(() => createDashboardApi({ baseUrl }), [apiBaseUrl])`. After moving the API client into a single React Context (CRITICAL #3 fix), this disappears along with the prop-drilling issue.

---

## 4. Proposed Architecture (Target)

```
apps/dashboard/src/
├── main.tsx                                  <200   mounts providers + router + shell
├── app/
│   ├── providers/
│   │   ├── QueryProvider.tsx                 React Query root
│   │   ├── ApiProvider.tsx                   single createDashboardApi() instance + context
│   │   ├── AuthProvider.tsx                  me state, refreshSession, SESSION_EXPIRED_EVENT
│   │   └── ThemeProvider.tsx                 design-token CSS variables on :root via styles.css
│   ├── shell/
│   │   ├── ShellLayout.tsx                   sidebar + topbar + Outlet
│   │   ├── Sidebar.tsx                       NavGroup + NavItem primitives
│   │   ├── TopBar.tsx                        breadcrumb from route
│   │   ├── ErrorBoundary.tsx                 reusable, with telemetry hook
│   │   └── routes.tsx                        React Router config, lazy per route
│   └── routes/
│       ├── overview/OverviewPage.tsx         lazy
│       ├── audit/AuditLogPage.tsx            lazy
│       ├── ... (one folder per page)
│
├── features/                                 vertical slices
│   ├── auth/
│   │   ├── AuthScreen.tsx                    split-screen, no inline styles
│   │   ├── useAuth.ts                        login/register/logout + friendlyAuthError
│   │   └── auth-error.ts                     error-string mapper (extracted)
│   ├── audit/
│   │   ├── AuditLogPage.tsx                  view only
│   │   ├── useAuditEvents.ts                 cursor-paginated query hook
│   │   ├── actionBadges.ts                   actionBadgeCategory + actionBadgeClass
│   │   └── exportCsv.ts                      pure helper, unit-tested
│   ├── customers/                            same pattern: page + hook + helpers
│   ├── checkout/                             ...
│   ├── negotiation/                          ...
│   └── widget/
│       ├── LivePreviewPanel.tsx              composition root only
│       ├── useEmbedSession.ts                token-issue + retry
│       ├── buildPreviewSrcDoc.ts            pure function, fully tested
│       ├── PresentationToggle.tsx            a11y-correct toggle
│       └── WidgetFrame.tsx                   iframe + postMessage bridge
│
├── api/
│   ├── http/
│   │   ├── http-client.ts                    fetch + refresh + idempotency + 401 fanout
│   │   ├── DashboardHttpError.ts
│   │   ├── url.ts                            mergeUrl, normalizeApiBase, versionedPath
│   │   └── idempotency.ts
│   ├── endpoints/
│   │   ├── auth.ts                           login, register, logout, refresh
│   │   ├── merchants.ts                      profile, rules, theme
│   │   ├── checkout-settings.ts
│   │   ├── support.ts
│   │   ├── integrations.ts                   api-keys, webhook-endpoints, webhook-deliveries
│   │   ├── orders.ts
│   │   ├── customers.ts
│   │   ├── payments.ts                       payments + connections + crypto
│   │   ├── audit.ts
│   │   ├── agent-rules.ts
│   │   ├── negotiation.ts                    policy + sessions + stats + evaluate
│   │   ├── commerce.ts                       connections + sync + test
│   │   ├── installations.ts
│   │   ├── billing.ts
│   │   ├── onboarding.ts
│   │   └── embed.ts
│   ├── adapters/
│   │   └── webhook-mappers.ts                mapWebhookEndpoint, mapWebhookDelivery
│   └── index.ts                              createDashboardApi = compose(endpoints, http-client)
│
├── ui/                                       design-system primitives
│   ├── Button.tsx, IconButton.tsx
│   ├── Field.tsx, Input.tsx, Select.tsx
│   ├── Panel.tsx, PageHeader.tsx, EmptyState.tsx
│   ├── SkeletonRow.tsx, Table.tsx, Pagination.tsx
│   ├── Toast.tsx, SaveFeedbackBanner.tsx
│   └── theme.ts                              CSS-variable names + types
│
├── styles/
│   ├── tokens.css                            :root CSS vars (replaces inline in main.tsx:427)
│   ├── reset.css
│   ├── layout.css                            .app, .panel, .stacked
│   └── components.css                        .btn-primary, .badge, etc. (already in styles.css)
│
└── routes/__tests__/
    ├── auth-flow.spec.tsx
    ├── tab-routing.spec.tsx
    └── session-expired-fanout.spec.tsx
```

**Why this shape:**
- `api/` is a vertical module per resource — adding a new endpoint is one new file, not one new method in a 900-line god object.
- `features/` are vertical slices — a new page is one folder, not 4 file edits in 3 directories.
- `ui/` is the design-system boundary that absorbs inline styles and gives every page `PageHeader`, `EmptyState`, `Pagination` for free.
- `app/providers/` and `app/shell/` remove the `main.tsx` god-file smell.

---

## 5. Refactor Backlog (Ordered)

### Phase A — Stop the bleeding (one PR each, ~½ day)

| # | Action | Effort | Severity unlocked |
|---|---|---|---|
| A1 | Wrap App in `<ErrorBoundary>` from a library (or split `PageErrorBoundary` + `<AppErrorBoundary>`) and add `unhandledrejection` listener | S | M-7 |
| A2 | Extract `AuthScreen` to `features/auth/AuthScreen.tsx` and `friendlyAuthError` to `features/auth/auth-error.ts` | S | (C-1 partial) |
| A3 | Move `--ink/--accent/...` inline CSS-var block from `main.tsx:427` into `styles/tokens.css` as `:root { --ink: ...; }` | S | H-4 partial |
| A4 | Fix `setTab("onboarding")` race in `main.tsx:326–328` — only resume on initial mount, not on every `refreshSession()` | S | M-10 |

### Phase B — Reactive data layer (1 PR, ~1 day)

| # | Action | Effort | Severity unlocked |
|---|---|---|---|
| B1 | Install `@tanstack/react-query`; wrap `<App>` in `<QueryClientProvider>` | S | M-9 indirectly |
| B2 | Move `createDashboardApi()` instantiation out of pages and into `ApiProvider` (single instance) | S | C-3 partial |
| B3 | Convert each page's hand-rolled loading/error states into `useQuery` / `useInfiniteQuery` hooks co-located under `features/<x>/use<X>.ts` | M | C-3, M-11 |
| B4 | Extract `CursorPage<T>` pagination into a `useCursorPagination` helper if 3+ callers converge on it | S | C-3 partial |

### Phase C — API layer split (1 PR, ~½ day)

| # | Action | Effort | Severity unlocked |
|---|---|---|---|
| C1 | Split `api-client.ts` into `api/http/*`, `api/endpoints/*`, `api/adapters/*` | M | C-2 |
| C2 | Replace duplicate URL helpers (mergeUrl, versionedPath, mergePath, normalizeApiBase) with one `buildUrl(base, path, query)` | S | C-2 |
| C3 | Move webhook mappers out of `api-client.ts` | S | C-2 |
| C4 | Delete `getCustomers` (alias of `getCustomersPage`) | S | C-2 |

### Phase D — Routing (1 PR, ~½ day)

| # | Action | Effort | Severity unlocked |
|---|---|---|---|
| D1 | Add `react-router-dom` v6; map each `TabKey` to a route under `app/routes/` | M | H-6 |
| D2 | Convert each page import to `React.lazy()` and `<Suspense>` | S | M-9 |
| D3 | Move `OnboardingWizard.onNavigate` callback prop to `useNavigate()` | S | H-6 partial |

### Phase E — Design system + a11y (1 PR each, ~½ day)

| # | Action | Effort | Severity unlocked |
|---|---|---|---|
| E1 | Audit all inline `style={{}}` in pages; promote to `<ui/Panel>`, `<ui/Button>`, etc. with CSS Module or class names | M | H-4 |
| E2 | Replace `font:` shorthand usages with `fontWeight`/`fontSize`/`fontFamily`/etc. (35 in main.tsx) | S | H-4 partial |
| E3 | Promote `<PageHeader>`, `<EmptyState>`, `<SkeletonRow>`, `<Pagination>` and use across all pages | M | C-3 partial |
| E4 | Replace sidebar `<div onClick>` with `<a href>` (or `<NavLink>` from router); add `aria-current` | S | a11y |
| E5 | Replace AuthScreen tab buttons with proper `role="tab"` / `aria-selected` and arrow-key handling | S | a11y |
| E6 | Wrap logout/refresh/login buttons in proper `<button type>` (already done) and add visible focus rings | S | a11y |
| E7 | Replace `LivePreviewPanel` srcdoc injection magic with a tested `buildPreviewSrcDoc()` pure function | M | H-5 |
| E8 | Split `LivePreviewPanel` into `useEmbedSession` + `PresentationToggle` + `WidgetFrame` | M | H-5 |

### Phase F — Main.tsx god-file teardown (1 PR, ~½ day)

| # | Action | Effort | Severity unlocked |
|---|---|---|---|
| F1 | Move auth state (9 `useState` hooks in App) to `AuthProvider` | S | C-1 |
| F2 | Move `me` out of prop drilling into a context consumed by pages | S | C-3 |
| F3 | Split App into `ShellLayout` + `RoutedApp` | S | C-1 |
| F4 | Add top-level `<AppErrorBoundary>` wrapping the router | S | M-7 |
| F5 | Add a unit test for the shell (Tab → Page mapping, logout flow, session-expired event handler) | M | M-12 |

### Phase G — Observability + smoke tests (1 PR, ~½ day)

| # | Action | Effort | Severity unlocked |
|---|---|---|---|
| G1 | Hook `ErrorBoundary.componentDidCatch` to a logger (Sentry or console-only stub) | S | M-7 |
| G2 | Add `__tests__/auth-flow.spec.tsx`, `__tests__/tab-routing.spec.tsx`, `__tests__/session-expired-fanout.spec.tsx` | M | M-12 |
| G3 | Add Vitest coverage for the previously-untouched endpoints (webhooks, audit, billing, crypto-payments) | M | M-12 |

---

## 6. Acceptance Criteria

A refactor phase is "done" when:

1. `main.tsx` is **< 200 lines** and contains only: imports, providers, router mount, root render.
2. `api-client.ts` is **deleted** (folder-replaced by `api/*`).
3. Inline `style={{}}` count in `main.tsx` is **0**.
4. Inline `style={{}}` count across `pages/` is **< 10/100 lines** (down from current ~30).
5. `createDashboardApi()` is instantiated **once** (in `ApiProvider`).
6. Tab navigation produces a real URL (`/audit-log`, `/customers`) that survives reload.
7. Every `// eslint-disable react-hooks/exhaustive-deps` is **gone**.
8. New page work fits in **one folder**: a view file + a feature hook + a route entry.
9. Keyboard-only user can: log in, navigate via Tab/Arrow, expand audit rows, change presentation toggles. (a11y bar — vitest-axe or manual.)
10. CI is green: `pnpm --filter dashboard typecheck && pnpm --filter dashboard test`.

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hidden coupling between `App` state and tabs — splitting providers breaks an undocumented "magic" behavior | M | M | Wrap extraction in a feature-flagged dev build; ship behind a query param before cutting over |
| Splitting `api-client.ts` breaks import cycles from `api-client.spec.ts` | L | M | Do C1 last among `api/*` splits; the existing tests pin behavior |
| `react-router` deep-link migration breaks embedded iframes that relied on tab state | L | M | Provide `/legacy-tab?key=...` redirect as a stop-gap |
| Error-boundary teardown hides errors that used to surface | L | H | Always log inside `componentDidCatch`; add Sentry hook before removing the inline boundary |
| Long migration — devs continue adding features in old style | M | M | Lock new-feature PRs to a refactored file pattern via CONTRIBUTING note in PR template |

---

## 8. Out of Scope (Intentionally)

- **Backend contract changes** — refactor is frontend-only.
- **i18n** — strings stay Portuguese; no `i18next` migration in this round.
- **Storybook** — would be a natural follow-up after `ui/` primitives stabilize but is not a prerequisite.
- **Visual redesign** — tokens already exist; pure refactor preserves current look.

---

## 9. Quick-Win Summary (one afternoon)

If only one afternoon is available:

1. Extract `AuthScreen` from `main.tsx` (A2).
2. Move tokens to `styles/tokens.css` (A3).
3. Add `ApiProvider` context and a single `useApi()` hook; remove the per-page `useMemo(createDashboardApi)` (B2).
4. Install React Query and convert **one** page (`audit-log-page`) end-to-end (B3).
5. Add `<AppErrorBoundary>` + `unhandledrejection` listener (A1).

Five small PRs, none blocking the others. After this afternoon the codebase has a 30-line reduction in `main.tsx`, a real data-fetching primitive, and global error capture — enough to de-risk Phases C–G.
