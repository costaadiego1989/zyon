# P0 Production Readiness — Parallel Tasks

**Orchestration:** 7 parallel subagents, minimal handoff. Each task is independent.

---

## Task 001: Healthcheck Endpoint [P]

**What:** Add `/health` (liveness) + `/ready` (readiness) endpoints.  
**Where:** `apps/api/src/shared/health/` (new module)  
**Depends on:** None  
**Reuses:** Prisma client (existing)  
**Done when:** Endpoints respond 200 with correct JSON, tests pass  
**Tests:** Unit + e2e  
**Gate:** `pnpm --filter @aacp/api test` passes

---

## Task 002: Structured Logging [P]

**What:** Implement pino + nestjs-pino + correlation ID middleware.  
**Where:** `apps/api/src/shared/logger/` (new module)  
**Depends on:** None  
**Reuses:** AsyncLocalStorage (Node builtin)  
**Done when:** Logger service exportable, main.ts uses logger, JSON output confirmed  
**Tests:** Unit for middleware + service  
**Gate:** `pnpm --filter @aacp/api test` passes, manual log inspection

---

## Task 003: Dockerfile [P]

**What:** Multi-stage Dockerfile for API.  
**Where:** Root `/Dockerfile` or `apps/api/Dockerfile`  
**Depends on:** Successful build (pre-verified)  
**Reuses:** None  
**Done when:** File exists, builds, runs on 3001, responds to `/health`  
**Tests:** Manual docker build + run  
**Gate:** `docker build . && docker run -p 3001:3001` works

---

## Task 004: CI/CD Pipeline [P]

**What:** GitHub Actions workflow (lint → typecheck → test → build).  
**Where:** `.github/workflows/ci.yml`  
**Depends on:** All code changes (P0-001 through P0-007) complete  
**Reuses:** Existing pnpm commands, eslint config  
**Done when:** Workflow file exists, runs on push/PR, all gates pass  
**Tests:** Manual trigger via mock PR  
**Gate:** Workflow completes successfully

---

## Task 005: .env.example [P]

**What:** Create documented `.env.example`.  
**Where:** `apps/api/.env.example`  
**Depends on:** None  
**Reuses:** `PRODUCTION_REQUIRED_SECRETS` list from code  
**Done when:** File created, all required vars documented, no secrets in file  
**Tests:** Manual review  
**Gate:** File exists, readable, matches code requirements

---

## Task 006: Test rules-engine [P]

**What:** Write unit tests for discount authorization (100% coverage target).  
**Where:** `packages/rules-engine/src/*.spec.ts`  
**Depends on:** None  
**Reuses:** Existing rules-engine exports  
**Done when:** All functions tested, coverage ≥ 80%, tests pass  
**Tests:** Jest/vitest unit  
**Gate:** `pnpm --filter @aacp/rules-engine test` passes

---

## Task 007: Test decision-engine [P]

**What:** Write unit tests for checkout orchestration (100% coverage target).  
**Where:** `packages/decision-engine/src/*.spec.ts`  
**Depends on:** None  
**Reuses:** Existing decision-engine exports  
**Done when:** All functions tested, coverage ≥ 80%, tests pass  
**Tests:** Jest/vitest unit  
**Gate:** `pnpm --filter @aacp/decision-engine test` passes

---

## Aggregation (sequential, after all [P] complete)

- Verify all gates pass
- Update STATE.md with completion status
- Commit all changes with conventional commit messages
- Report summary to main thread
