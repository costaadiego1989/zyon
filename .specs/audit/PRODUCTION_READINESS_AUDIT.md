# Production Readiness Audit

> Date: 2026-07-16 | Branch: feat/checkout-journey-both-channels

---

## 1. Executive Summary

| Area | Status | Risk |
|------|--------|------|
| API unit test coverage | 24% (131 specs / 543 source) | 🔴 HIGH |
| Widget unit test coverage | ~33% (45 specs centralized in `__tests__/`) | 🟡 MEDIUM |
| Dashboard unit test coverage | 42% (27 specs / 59 source) | 🟡 MEDIUM |
| Widget E2E coverage | 26 specs (mocked + realapi) | 🟢 OK |
| Dashboard E2E coverage | 16 specs | 🟡 MEDIUM |
| Packages test coverage | Mixed (0-100%) | 🟡 MEDIUM |
| CI/CD pipeline | ❌ Missing | 🔴 CRITICAL |
| Dockerfile / deploy infra | ❌ Missing | 🔴 CRITICAL |
| Healthcheck endpoint | ❌ Missing | 🔴 CRITICAL |
| Structured logging | ❌ Missing | 🔴 HIGH |
| Observability (APM/metrics) | Partial (module exists, details TBD) | 🟡 MEDIUM |
| .env sample / secrets management | ❌ No `.env.example` | 🟡 MEDIUM |
| Prisma migrations | ✅ 30 migrations applied | 🟢 OK |
| Security headers | ✅ Configured in main.ts | 🟢 OK |
| CORS config | ✅ Configured | 🟢 OK |
| Validation pipe | ✅ whitelist + forbidNonWhitelisted | 🟢 OK |
| OpenAPI docs | ✅ /docs endpoint | 🟢 OK |
| Secret assertion (prod) | ✅ `assertRequiredSecretsInProduction` | 🟢 OK |

---

## 2. API Modules — Test Coverage Per Module

| Module | Source | Specs | Coverage | Risk |
|--------|--------|-------|----------|------|
| checkout | 79 | 32 | 41% | 🟡 Core module |
| buyer-account | 55 | 12 | 22% | 🟡 |
| payment | 47 | 12 | 26% | 🔴 Financial |
| self-checkout | 32 | 2 | 6% | 🔴 |
| commerce | 28 | 8 | 29% | 🟡 |
| integrations | 28 | 5 | 18% | 🔴 |
| cross-sell | 24 | 2 | 8% | 🔴 |
| support | 24 | 3 | 13% | 🔴 |
| coupons | 23 | 3 | 13% | 🔴 |
| auth | 23 | 8 | 35% | 🟡 |
| negotiation | 17 | 9 | 53% | 🟢 |
| scraping-agent | 17 | 2 | 12% | 🔴 |
| shipping | 17 | 1 | 6% | 🔴 |
| merchant | 17 | 4 | 24% | 🟡 |
| fulfillment | 15 | 2 | 13% | 🔴 |
| buyer-purchase-history | 14 | 4 | 29% | 🟡 |
| agent-rules | 13 | 3 | 23% | 🟡 |
| catalog | 13 | 2 | 15% | 🔴 |
| embed | 11 | 6 | 55% | 🟢 |
| audit | 11 | 2 | 18% | 🟡 |
| checkout-settings | 10 | 4 | 40% | 🟡 |
| operations | 9 | 2 | 22% | 🟡 |
| onboarding | 8 | 1 | 13% | 🔴 |
| installations | 6 | 1 | 17% | 🟡 |
| **TOTAL** | **543** | **131** | **24%** | **🔴** |

### Critical modules needing specs ASAP (financial + core):
1. **payment** — 26% on financial operations. Risk of billing bugs.
2. **self-checkout** — 6% on customer-facing checkout flow.
3. **shipping** — 6% on delivery cost calculations.
4. **cross-sell** — 8% on revenue upsell logic.
5. **coupons** — 13% on discount application logic.
6. **support** — 13% on customer support flows.

---

## 3. Packages — Test Coverage

| Package | Source | Specs | Coverage | Risk |
|---------|--------|-------|----------|------|
| conversation-engine | 14 | 12 | 86% | 🟢 |
| shipping-engine | 3 | 3 | 100% | 🟢 |
| negotiation-engine | 1 | 1 | 100% | 🟢 |
| agentic-checkout-js | 4 | 3 | 75% | 🟢 |
| commerce-adapters | 14 | 6 | 43% | 🟡 |
| **contracts** | **1** | **0** | **0%** | 🔴 |
| **decision-engine** | **1** | **0** | **0%** | 🔴 |
| **payments-stellar** | **4** | **0** | **0%** | 🔴 |
| **rules-engine** | **1** | **0** | **0%** | 🔴 |
| **shared-types** | **2** | **0** | **0%** | 🟡 (interfaces only) |
| discovery-engine | 0 | 0 | scaffold | ⚪ |
| learning-engine | 0 | 0 | scaffold | ⚪ |
| recomendation-engine | 0 | 0 | scaffold | ⚪ |

### Critical:
- **rules-engine** (0%) — per CLAUDE.md, discount approval ONLY comes from this engine. MUST be tested.
- **decision-engine** (0%) — orchestrates checkout decisions.
- **payments-stellar** (0%) — crypto payment integration without tests.

---

## 4. Widget — Test Coverage

| Directory | Source | Specs | Notes |
|-----------|--------|-------|-------|
| components | 33 | 0 | All specs in root `__tests__/` |
| features | 37 | 0 | Specs in root `__tests__/` |
| presentation | 30 | 0 | Specs in root `__tests__/` |
| hooks | 21 | 0 | Specs in root `__tests__/` |
| lib | 13 | 0 | Specs in root `__tests__/` |
| app | 2 | 0 | |
| design-system | 1 | 0 | |
| `__tests__/` (root) | - | 45 | Centralized specs |

**Pattern:** Widget uses centralized `src/__tests__/` rather than co-located specs.  
**E2E:** 26 Playwright specs (mocked + realapi projects).  
**Threshold:** vitest coverage at 70% (`pnpm test:coverage`).  

### Gaps:
- No specs for `design-system/` components
- `app/` entry points untested
- Voice features (`lib/voice/`) unclear if covered by `__tests__/voice/`

---

## 5. Dashboard — Test Coverage

| Area | Source | Specs |
|------|--------|-------|
| src/ | 59 | 27 |
| e2e/ | - | 16 Playwright specs |

**Coverage:** 42% unit + 16 e2e specs.  
**Gaps:**
- `api/http/` layer (client, error handling, idempotency) — untested
- `auth/` module — no unit specs
- `hooks/` — no unit specs
- `shell/` — no specs
- `utils/` — no specs

---

## 6. Production Infrastructure — MISSING

### 🔴 CRITICAL: No CI/CD
- No `.github/workflows/` found
- No Dockerfile found
- No deployment config (fly.toml, vercel.json, render.yaml, Procfile)

### 🔴 CRITICAL: No Healthcheck Endpoint
- `main.ts` boots NestJS but no `/health` or `/ready` route
- Required for: load balancers, K8s probes, uptime monitoring

### 🔴 HIGH: No Structured Logging
- No logger service found (no `*logger*` files)
- `console.log` in `main.ts` — not production-grade
- Need: pino/winston with JSON output, request correlation IDs

### 🟡 MEDIUM: Partial Observability
- `shared/observability/observability.module.ts` exists — needs inspection
- No metrics endpoint found (Prometheus/StatsD)
- No APM integration visible (Sentry, Datadog, etc.)

### 🟡 MEDIUM: No .env.example
- No `.env.example` or `.env.sample` — onboarding friction
- `PRODUCTION_REQUIRED_SECRETS` in code provides partial documentation

### 🟢 Present:
- Docker Compose for local Postgres (port 55432, healthcheck)
- Secret assertion in production mode
- Security headers middleware
- CORS configuration
- OpenAPI documentation
- Validation pipeline (whitelist, transform)
- 30 Prisma migrations

---

## 7. Integration Seams — Assessment

### shared-types
- Exports: `CartItem`, `Cart`, `ShippingContext`, `CheckoutEventName`, `CustomerAddress`, `CustomerHints`, `CurrencyCode`, `PackageDimensions`
- Used by: api, widget, dashboard
- Risk: Changes here ripple to all apps — **no tests** to validate contracts

### commerce-adapters
- Adapters: Shopify, Nuvemshop, Tray, WooCommerce
- Integration test: `__integration__/webhook-verification.spec.ts`
- 43% coverage — webhook handling is critical path

### conversation-engine
- 86% coverage — best tested package
- Includes: LangGraph agent, safety validator, cost tracker, context manager
- Config context system with document builder + regeneration

### agentic-checkout-js
- Embed client + UMD bundle + checkout API
- 75% coverage — good

---

## 8. Modules Without ANY E2E / Integration Coverage

These API modules have no integration-level testing:
- `self-checkout`
- `fulfillment`
- `cross-sell`
- `scraping-agent`
- `operations`
- `onboarding`
- `installations`

---

## 9. Architecture Observations

### ✅ Good:
- Clean Architecture + Modular DDD consistently applied
- Each module: domain/application/infrastructure/presentation layers
- `REFACTOR.md` files per module indicate active maintainability
- Packages are framework-free (no NestJS imports)
- Tenant boundary (`merchant_id`) enforced architecturally
- E2E composition root separated from production `AppModule`

### ⚠️ Concerns:
- `apps/web/` exists but not in CLAUDE.md layout — unclear role
- `woocommerce/` at root — plugin scaffold, not integrated into monorepo build
- `plugins/` directory at root — not documented
- `fake-commerce-api/` — test fixture or deprecated?
- 3 scaffold packages (discovery-engine, learning-engine, recomendation-engine) — empty, unclear roadmap
- `payments-stellar` — crypto payments with 0% test coverage

---

## 10. Priority Action Plan

### P0 — Before Production (blocking)
1. **Add healthcheck endpoint** (`/health` + `/ready` with DB ping)
2. **Add structured logging** (pino + request ID correlation)
3. **Create Dockerfile** for API (multi-stage build)
4. **Create CI/CD pipeline** (lint → typecheck → test → build → deploy)
5. **Add `.env.example`** with all required vars documented
6. **Test rules-engine** — safety-critical for discount approval
7. **Test decision-engine** — orchestrates checkout flow

### P1 — High Priority (first 2 weeks)
8. Test payment module (financial operations)
9. Test self-checkout module (customer-facing)
10. Test shipping module (delivery cost accuracy)
11. Test coupons module (discount logic)
12. Test payments-stellar if going live with crypto
13. Add Sentry/error tracking integration
14. Add rate limiting (already have `login-rate-limiter`, extend to API-wide)

### P2 — Medium Priority (month 1)
15. Test cross-sell, support, fulfillment, scraping-agent
16. Add Prometheus metrics endpoint
17. Add shared-types contract tests (breaking change detection)
18. Dashboard: test api/http layer, auth, hooks
19. Widget: validate 70% threshold passes (`pnpm test:coverage`)
20. Clean up scaffold packages or document roadmap

### P3 — Nice to Have
21. Co-locate widget specs with source (convention alignment)
22. Add integration tests for all commerce adapters (beyond webhook-verification)
23. Performance tests for checkout critical path
24. Chaos testing for payment webhook idempotency
25. SBOM / dependency audit automation

---

## 11. Files Generated

- `.specs/audit/PRODUCTION_READINESS_AUDIT.md` — this report
- `.specs/audit/api-missing-specs.txt` — (to be generated)
- `.specs/audit/widget-missing-specs.txt` — (to be generated)
- `.specs/audit/dashboard-missing-specs.txt` — (to be generated)
