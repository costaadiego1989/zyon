# Production Readiness Audit — Consolidated Report

**Date:** 2026-08-05
**Scope:** API, Dashboard, Widget, WooCommerce Plugin

---

## TIER 1 — BLOCKERS (Must fix before production)

| # | App | Gap | Detail |
|---|-----|-----|--------|
| 1 | **Widget** | Demo mode always enabled | `allowDemoFallbacks` hardcoded `true` → fake PIX/orders appear real in production |
| 2 | **Widget** | No fetch timeout | API calls hang indefinitely on slow network; no AbortController |
| 3 | **Widget** | No ErrorBoundary | Unhandled render error crashes entire widget permanently |
| 4 | **API** | No graceful shutdown | `app.enableShutdownHooks()` never called → in-flight requests lost on deploy |
| 5 | **API** | Rate limiter in-memory only | Multi-replica deploys multiply attacker budget by replica count |
| 6 | **Dashboard** | Billing + Payment pages missing | Cannot monetize; no Stripe/Asaas connection UI |
| 7 | **Plugin** | CartSync no CSRF/nonce | Public AJAX endpoint accepts unauthenticated requests without nonce verification |

---

## TIER 2 — HIGH RISK (Fix within first sprint)

| # | App | Gap | Detail |
|---|-----|-----|--------|
| 8 | **API** | No Dockerfile HEALTHCHECK | Orchestrator can't probe liveness without external config |
| 9 | **API** | Health check doesn't probe Redis | Dead BullMQ/Redis undetected |
| 10 | **API** | 5 modules nearly untested | installations, onboarding, catalog, operations, audit |
| 11 | **API** | No README | Zero onboarding docs for devs/ops |
| 12 | **Widget** | Voice TTS/STT not wired | Button visible but clicking does nothing |
| 13 | **Widget** | Crypto payment stubbed | UI shows but always falls back to demo |
| 14 | **Widget** | Payment errors not surfaced | User taps Pay → no response feedback |
| 15 | **Widget** | Focus trap missing on auth modal | WCAG 2.1.2 violation |
| 16 | **Widget** | Token in localStorage (XSS risk) | Acceptable for short-lived only |
| 17 | **Dashboard** | No global error boundary | Unhandled error crashes SPA |
| 18 | **Dashboard** | Build verification missing in deploy | Silent fail if dist not built |
| 19 | **Dashboard** | nginx missing security headers | No CSP, HSTS, X-Frame-Options |
| 20 | **Plugin** | No API retry/circuit breaker | If API down, every checkout wastes 10s timeout |
| 21 | **Plugin** | Webhook processing no retry | Failed order sync silently lost |

---

## TIER 3 — MEDIUM (Fix within 2-3 sprints)

| # | App | Gap |
|---|-----|-----|
| 22 | API | No distributed tracing (OpenTelemetry) |
| 23 | API | No Helmet (HSTS missing) |
| 24 | API | No request body size limit |
| 25 | API | No per-request timeout middleware |
| 26 | API | Missing indexes on several FK columns |
| 27 | API | OpenAPI docs exposed in production |
| 28 | API | Dead modules (scraping-agent, self-checkout) in source |
| 29 | Widget | No code-split for voice/crypto (40KB wasted) |
| 30 | Widget | No memoization on expensive selectors |
| 31 | Widget | localStorage write failures not caught |
| 32 | Widget | PIX polling timeout not surfaced to user |
| 33 | Widget | No Sentry/error tracking |
| 34 | Widget | TypeScript not strict mode |
| 35 | Widget | 70% coverage threshold low for payment paths |
| 36 | Dashboard | Password reset flow missing |
| 37 | Dashboard | No RBAC/multi-user |
| 38 | Plugin | Settings page needs "Test Connection" button |
| 39 | Plugin | CartSync lacks unit tests |
| 40 | Plugin | No CI/CD for plugin tests |
| 41 | Plugin | uninstall.php doesn't clean order meta |

---

## TIER 4 — LOW (Tech debt / polish)

| # | App | Gap |
|---|-----|-----|
| 42 | API | pino-pretty in production deps (+2MB) |
| 43 | API | 15+ REFACTOR.md files = untracked debt |
| 44 | API | No API changelog/versioning strategy doc |
| 45 | Widget | Inline style objects (GC pressure) |
| 46 | Widget | Bundle size not measured (no visualizer) |
| 47 | Plugin | Missing WordPress.org asset banners |
| 48 | Plugin | Magic strings for webhook event names |
| 49 | Plugin | No tested WooCommerce version matrix |
| 50 | Dashboard | No request retry/backoff strategy |

---

## SUMMARY BY APP

| App | Critical | High | Medium | Low | Overall |
|-----|----------|------|--------|-----|--------|
| API | 2 | 4 | 7 | 4 | 🟡 Conditional |
| Widget | 3 | 5 | 8 | 2 | 🟡 Conditional |
| Dashboard | 1 | 3 | 4 | 1 | 🟠 Not ready |
| Plugin | 1 | 2 | 4 | 3 | 🟡 Conditional |

**Verdict:** Ship after TIER 1 fixes (7 items). TIER 2 within first sprint post-launch.

---

## WHAT'S ALREADY GOOD ✓

**API:**
- RFC 7807 error responses
- Transactional outbox + DLQ
- Idempotency decorator
- PII encryption (AES-256-GCM)
- Correlation IDs
- Prometheus metrics + Sentry
- Strict CORS + security headers (custom)
- Production secret validation at boot
- 57-model Prisma schema with proper migrations

**Widget:**
- 47 unit test files + 27 Playwright e2e specs
- Auth persistence with expiry validation
- Safe URL sanitization (safeExternalUrl)
- Luhn + expiry validation on cards
- Structured viewmodel/selector pattern
- 70% coverage thresholds enforced

**Dashboard:**
- Auto-refresh on 401
- Idempotency key injection
- 17 Playwright e2e test files
- Custom HTTP error classes

**Plugin:**
- HMAC webhook signature verification
- Proper WordPress.org readme.txt
- Settings sanitization (secrets as password fields)
- Dev mode URL validation bypass
- Clean PSR-4 structure
- No OAuth install flow exists yet.
- No database migration layer exists yet.
