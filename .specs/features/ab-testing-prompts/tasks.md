# A/B Testing de Prompts — Tasks

## Phase Overview

Implementação em 5 fases com gates bem definidos. Total estimado: **3-4 semanas**.

---

## Phase 1: Data Layer

### [P1.1] Prisma Schema + Migration

**What:** Add 3 models (PromptExperiment, PromptVariant, PromptVariantResult). Modify CheckoutSession com promptVariantId.

**Where:**
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/`

**Depends on:** Nothing

**Done when:**
- [ ] Schema compila
- [ ] Migration created
- [ ] Migration up/down works
- [ ] No typecheck errors

**Tests:**
- Migration applies successfully
- Relationships validated
- Indexes present

**Gate:** `pnpm typecheck` passes, `pnpm prisma generate` succeeds

---

### [P1.2] Experiment Entity + Repository

**What:** Domain entity PromptExperiment + PromptVariant. Prisma repo.

**Where:**
- `apps/api/src/modules/experiments/domain/entities/prompt-experiment.entity.ts`
- `apps/api/src/modules/experiments/domain/entities/prompt-variant.entity.ts`
- `apps/api/src/modules/experiments/domain/ports/experiment-repository.port.ts`
- `apps/api/src/modules/experiments/infrastructure/repositories/prisma-experiment.repository.ts`

**Depends on:** P1.1

**Done when:**
- [ ] Entities validate status transitions (draft → running → completed)
- [ ] Repo: create, read, update, list, findRunning
- [ ] Soft-delete support

**Tests:**
- Create experiment ✓
- List by merchant ✓
- Status transitions ✓
- Findrunning returns only running ✓

**Gate:** All tests pass, 70%+ coverage

---

## Phase 2: Core Logic

### [P2.1] Experiment Router Service

**What:** Weighted random selection. selectVariant(merchantId) → PromptVariant | null.

**Where:**
- `apps/api/src/modules/experiments/domain/services/experiment-router.service.ts`

**Depends on:** P1.2

**Done when:**
- [ ] Algorithm implemented (weighted random)
- [ ] Distribution tested (mock random)
- [ ] Cache 5min implemented
- [ ] Null handling (no experiment running)

**Tests:**
- Distribution with weight=[1,1,1] → each 33% ±5%
- Single variant → always selected
- Null returned when no running experiment ✓

**Gate:** Statistical tests pass

---

### [P2.2] Significance Calculator

**What:** Z-test for conversion rates. calculateConfidence() → {winnerId, confidence: 0..1, isSignificant, needsMore}.

**Where:**
- `apps/api/src/modules/experiments/domain/services/significance-calculator.service.ts`

**Depends on:** Nothing

**Done when:**
- [ ] Z-test algorithm correct
- [ ] Confidence 0..1 mapped (z → CDF)
- [ ] Min samples check (100 per variant)
- [ ] Chi-squared optional (z-test sufficient)

**Tests:**
- Known dataset → known confidence value ✓
- p1=0.3, p2=0.2 (100 samples each) → confidence ~85%
- Insufficient samples → needsMore=true ✓

**Gate:** Tests pass with reference values verified

---

### [P2.3] Prompt Injection Validator

**What:** Regex blocklist. validateVariantPrompt() → boolean.

**Where:**
- `apps/api/src/modules/experiments/domain/services/prompt-validator.service.ts`

**Depends on:** Nothing

**Done when:**
- [ ] Blocklist patterns registered (ignore instructions, you are now, etc)
- [ ] False positives minimal (can contain "new" or "instructions" in normal context)

**Tests:**
- Malicious pattern detected ✓
- Normal prompt passes ✓
- Case-insensitive matching ✓

**Gate:** All patterns blocked, no false positives on legit prompts

---

## Phase 3: Application Layer

### [P3.1] Experiment CRUD Use Cases

**What:** CreateExperiment, UpdateExperiment, StartExperiment, StopExperiment, ArchiveExperiment, DeleteExperiment.

**Where:**
- `apps/api/src/modules/experiments/application/use-cases/create-experiment.use-case.ts`
- `apps/api/src/modules/experiments/application/use-cases/update-experiment.use-case.ts`
- `apps/api/src/modules/experiments/application/use-cases/start-experiment.use-case.ts`
- `apps/api/src/modules/experiments/application/use-cases/stop-experiment.use-case.ts`
- `apps/api/src/modules/experiments/application/use-cases/archive-experiment.use-case.ts`

**Depends on:** P2.1, P2.3

**Done when:**
- [ ] Create: valida prompt (blocklist), verifica max 1 running
- [ ] Start: draft → running, iniciates cron jobs
- [ ] Stop: running → completed, calcula significance
- [ ] Promoção de winner: only possible em stop ou manual
- [ ] Events emitted (experiment.created, started, completed)

**Tests:**
- Create with valid variants ✓
- Reject create with injection pattern ✓
- Cannot start if already running ✓
- Can update only in draft ✓

**Gate:** All CRUD ops work, merchant boundary enforced

---

### [P3.2] Result Tracking Use Cases

**What:** AssignVariantToSession, RecordExperimentResult.

**Where:**
- `apps/api/src/modules/experiments/application/use-cases/assign-variant-to-session.use-case.ts`
- `apps/api/src/modules/experiments/application/use-cases/record-experiment-result.use-case.ts`

**Depends on:** P3.1

**Done when:**
- [ ] Assign: session recebe variantId (determinístico por session)
- [ ] Record: resultado (converted, revenue, offers) persisted
- [ ] Dedup: (variantId, sessionId) unique constraint prevents double-count

**Tests:**
- Assign variant to session ✓
- Record result converted=true ✓
- Record result converted=false ✓
- Duplicate record rejected ✓

**Gate:** Results tracked accurately

---

### [P3.3] Winner Promotion Use Cases

**What:** PromoteWinner, AutoPromoteIfSignificant.

**Where:**
- `apps/api/src/modules/experiments/application/use-cases/promote-winner.use-case.ts`
- `apps/api/src/modules/experiments/application/use-cases/auto-promote-if-significant.use-case.ts`

**Depends on:** P2.2, P3.1

**Done when:**
- [ ] Manual: merchant clicks promote → winner selected, experiment closed
- [ ] Auto: only if confidence ≥95% AND >100 sessions/variante
- [ ] Agent identity updated with winner prompt
- [ ] Event emitted (winner.promoted)

**Tests:**
- Promote winner updates agent identity ✓
- Auto-promote only at 95% confidence ✓

**Gate:** Promotion works, agent identity reflects change

---

### [P3.4] Get Results Use Case

**What:** GetExperimentResults. Retorna métricas agregadas por variante.

**Where:**
- `apps/api/src/modules/experiments/application/use-cases/get-experiment-results.use-case.ts`

**Depends on:** P2.2

**Done when:**
- [ ] Query retorna: sessions, converted, revenue, offers per variante
- [ ] Calcula: conversionRate, avgRevenue, acceptanceRate, avgDuration
- [ ] Calcula: significance (confidence, winnerId, isSignificant, needsMore)

**Tests:**
- Results aggregated correctly ✓
- Significance calculated ✓

**Gate:** Dashboard data endpoint working

---

## Phase 4: Infrastructure + Integration

### [P4.1] Experiments HTTP Controller

**What:** Endpoints REST para CRUD + results.

**Where:**
- `apps/api/src/modules/experiments/presentation/http/experiments.controller.ts`

**Depends on:** P3.1-P3.4

**Done when:**
- [ ] POST/PUT/GET/DELETE wired
- [ ] Auth guard: merchant-scoped
- [ ] Validation on request body

**Tests:**
- POST /experiments creates ✓
- GET /experiments lists ✓
- PUT /experiments/:id updates (draft only) ✓
- GET /experiments/:id/results returns metrics ✓

**Gate:** All endpoints respond 200/201/204

---

### [P4.2] Checkout Integration

**What:** Modificar CheckoutExperienceService pra usar ExperimentRouter. AssignVariantToSession no buildAgentContext.

**Where:**
- `apps/api/src/modules/checkout/application/services/checkout-experience.service.ts` (modify)

**Depends on:** P4.1

**Done when:**
- [ ] ExperimentRouter chamado ao montar context
- [ ] VaraintId salvo na session
- [ ] Prompt da variante injetado
- [ ] Null case: usa prompt default

**Tests:**
- Session com experimento → recebe variante ✓
- Session sem experimento → usa default ✓
- Prompt da variante injetado ✓

**Gate:** Checkout tests still pass, no regression

---

### [P4.3] Complete Order Integration

**What:** Modificar CompleteOrder pra chamar RecordExperimentResult.

**Where:**
- `apps/api/src/modules/checkout/application/use-cases/complete-order.use-case.ts` (modify)

**Depends on:** P4.2

**Done when:**
- [ ] RecordResult chamado se session tem variantId
- [ ] Revenue e offers passados ao record

**Tests:**
- Order completes → result recorded ✓
- No variant → no record ✓

**Gate:** Complete order tests still pass

---

### [P4.4] Background Jobs

**What:** Cron jobs: ExpireSessionsJob (24h), AutoPromoteJob (6h).

**Where:**
- `apps/api/src/modules/experiments/infrastructure/jobs/expire-sessions.job.ts`
- `apps/api/src/modules/experiments/infrastructure/jobs/auto-promote-winner.job.ts`

**Depends on:** P4.3

**Done when:**
- [ ] ExpireSessions: mark sessions >24h sem complete como converted=false
- [ ] AutoPromote: check significance, promote if ≥95% + >100 samples
- [ ] Both jobs scheduled (via Bull/scheduler existing)

**Tests:**
- ExpireSessions marks old sessions ✓
- AutoPromote promotes at correct threshold ✓

**Gate:** Jobs execute without errors

---

### [P4.5] Experiments Module Registration

**What:** Wire module. Register providers, controllers, jobs.

**Where:**
- `apps/api/src/modules/experiments/experiments.module.ts`

**Depends on:** All P4.x

**Done when:**
- [ ] Module imports successfully
- [ ] Providers injectable
- [ ] Controllers registered
- [ ] Jobs scheduled

**Tests:**
- Module compiles ✓

**Gate:** `pnpm typecheck` passes

---

## Phase 5: Dashboard + Testing

### [P5.1] Dashboard Tab (Frontend)

**What:** New tab "Testes A/B" em Configurações de IA. Components:
- ExperimentList
- CreateExperiment
- ExperimentResults
- PromoteWinner

**Where:**
- `apps/dashboard/src/pages/settings/ai-experiments.tsx` (ou similar)
- Components em `src/components/experiments/`

**Depends on:** P4.1

**Done when:**
- [ ] List experiments (name, status, winner, dates)
- [ ] Create form (name, variants with prompts)
- [ ] Results view (table, chart, confidence indicator)
- [ ] Promote button (disabled se confidence <95%)
- [ ] Real-time or manual refresh

**Tests:**
- UI renders ✓
- API calls working ✓
- Form validation ✓

**Gate:** Dashboard accessible, no errors

---

### [P5.2] E2E Test Suite

**What:** Full flow tests:
1. Create experiment com 3 variantes
2. Simulate 300 sessions (mock random)
3. Verify distribution (±5% cada variante)
4. Verify results recorded
5. Verify significance calculated
6. Verify winner promoted
7. Verify agent identity updated

**Where:**
- `apps/api/src/modules/experiments/__tests__/experiments.e2e.spec.ts`

**Depends on:** All phases

**Done when:**
- [ ] Test covers happy path (start → complete → promote)
- [ ] Test covers edge case (insufficient data)
- [ ] Test verifies distribution
- [ ] Test verifies safety (variant prompt doesn't bypass gates)

**Tests:**
- E2E: create → run → complete → promote ✓
- Distribution: 1000 sessions → each ≈33% ±5% ✓
- Safety: variant with injection pattern → rejected ✓

**Gate:** All E2E tests pass

---

### [P5.3] Documentation

**What:** API docs, architecture diagram, prompt guidelines pra merchants.

**Where:**
- README em module
- Inline comments
- Architecture doc em `.specs/`

**Done when:**
- [ ] Each endpoint documented
- [ ] Workflow diagram
- [ ] Prompt best practices
- [ ] FAQ: "Por que meu experimento não termina?"

**Gate:** Documented, no broken references

---

## Gate Summary

| Phase | Gate |
|---|---|
| P1 | Schema compiles, migration works |
| P2 | Core services tested, router distribution valid |
| P3 | All use-cases work, merchant boundary enforced |
| P4 | Checkout integration works, jobs scheduled |
| P5 | Dashboard renders, E2E passes |

---

## Timeline Estimate

| Phase | Tasks | Effort | Sprint |
|---|---|---|---|
| P1 | Schema + repo | 1.5 days | Wk 1 |
| P2 | Router + Sig Calc + Validator | 2 days | Wk 1 |
| P3 | CRUD + result tracking + promote | 3 days | Wk 2 |
| P4 | Controllers + integration + jobs | 3 days | Wk 2 |
| P5 | Dashboard + E2E + docs | 3 days | Wk 3 |
| **Total** | **17 tasks** | **~3 weeks** | |

---

## Parallel Execution

- P1 e P2 podem rodar em paralelo (data layer vs service layer)
- P3 espera P2 (precisa services)
- P4 espera P3 (precisa use-cases)
- P5 espera P4 (integração + API)

**Recomendação:** 2 engineers, P1+P2 paralelo, depois sequencial P3-P5.

