# REFACTOR.md — Onboarding Module

## Summary

The onboarding module tracks merchant progress through a state machine (account → checkout_config → embed → publish). It is a read-heavy module with append-only event publishing and lazy persistence (no write-on-read). Architecture is solid; remaining work is minor cleanup and edge case handling.

---

## Current State

```
apps/api/src/modules/onboarding/
  onboarding.module.ts
  domain/
    entities/
      onboarding-state.entity.ts              # State machine (ONBOARDING_STEP_ORDER immutable)
    ports/
      onboarding-state.repository.port.ts     # findByMerchant, save
  application/
    get-onboarding-state.use-case.ts          # Read returns in-memory default (no persist)
    complete-onboarding-step.use-case.ts      # State transition + event publish
  infrastructure/
    prisma-onboarding-state.repository.ts     # Upsert by merchantId
    in-memory-onboarding-state.repository.ts  # Test double
  presentation/
    http/
      onboarding.controller.ts                # GET /onboarding, POST /onboarding/steps/:step/complete
```

---

## Findings

### CRITICAL

(none)

---

### HIGH

#### ONB-H1 — CompleteOnboardingStepUseCase does not validate that merchant exists before state mutation

- **File:** `application/complete-onboarding-step.use-case.ts` (`execute()`)
- **Category:** Safety / Invariant Violation
- **Description:** The use-case accepts any merchantId string. It reads the state (or creates a default), mutates it, persists it, and publishes events. If a malicious actor submits a fake merchantId (not registered), the onboarding state is created and events are published for a non-existent merchant.
- **Impact:** Garbage rows in the database; events for fake merchants clutter the event log.
- **Remediation:** Inject `MerchantRepository` and validate `merchant.exists(merchantId)` before mutating state. Throw `NotFoundException` early.

#### ONB-H2 — withAccount() mutates state in-place before persistence

- **File:** `application/complete-onboarding-step.use-case.ts` (`withAccount()`)
- **Category:** Consistency
- **Description:** When `CompleteOnboardingStepUseCase` reads a null state, it calls `withAccount(state)`, which mutates the entity by calling `state.completeStep(\"account\")`. This happens before `save()`. If the caller retains a reference to the state and an error occurs during save, they see a mutated state that was not persisted.
- **Impact:** Subtle inconsistency in partial failure scenarios.
- **Remediation:** Do not mutate the input entity. Instead, return `state.completeStep(\"account\").toSnapshot()` and create a fresh entity from that snapshot before saving.

#### ONB-H3 — Event IDs are generated with randomUUID, not deterministic

- **File:** `application/complete-onboarding-step.use-case.ts` (`onboardingEvent()`)
- **Category:** Idempotency
- **Description:** Each call to `onboardingEvent()` generates a new `event_id: evt_${randomUUID()}`. If the use-case is retried (e.g., due to a timeout), the event is duplicated with a different ID. The event bus may deduplicate on `(merchantId, eventType, occurredAt)` but the ID suggests this is a new event.
- **Impact:** On retry, a duplicate event is published (though deduplication may catch it).
- **Remediation:** Derive event_id deterministically from `(merchantId + step + occurredAt)` or accept an idempotency key from the caller.

#### ONB-H4 — No validation that merchant has completed account step before other steps

- **File:** `application/complete-onboarding-step.use-case.ts`
- **Category:** State Machine Invariant
- **Description:** The use-case enforces that all predecessors in `ONBOARDING_STEP_ORDER` are completed. However, it does not explicitly validate that the merchant has registered (account step should always be done). If a merchant is created via non-standard flows (bulk import, admin action), they might skip the account step.
- **Impact:** Inconsistent state.
- **Remediation:** Document that all merchants MUST have the account step completed. On first read, auto-complete it (already done); on write, validate it's done.

---

### MEDIUM

#### ONB-M1 — GetOnboardingStateUseCase mutates entity passed to caller

- **File:** `application/get-onboarding-state.use-case.ts` (`execute()`)
- **Category:** Consistency / Immutability
- **Description:** When a fresh state is created, the use-case calls `created.completeStep(\"account\")` which mutates the entity. The caller receives this mutated entity, but it's not persisted. If the caller later calls `completeStep(\"account\")` again (idempotent operation), they see it's already done and skip persistence.
- **Impact:** Subtle state inconsistency if the caller expects the in-memory state to match persisted state.
- **Remediation:** Return the response directly without mutating the entity. `OnboardingStateEntity` should support a constructor option to pre-populate steps.

#### ONB-M2 — OnboardingStateEntity.rehydrate() silently backfills missing steps

- **File:** `domain/entities/onboarding-state.entity.ts` (`rehydrate()`)
- **Category:** Forward Compatibility / Defensive Programming
- **Description:** If a stored snapshot is missing a step (e.g., old migration didn't set `checkout_config`), rehydrate creates it with `status: \"pending\"`. This is good for forward compatibility, but it masks data corruption if a step is accidentally deleted from the schema.
- **Impact:** Silent recovery; no alert to operators.
- **Remediation:** Acceptable as-is (defensive); consider adding a log WARNING if any step was backfilled.

#### ONB-M3 — No per-step metadata or timestamps

- **File:** `domain/entities/onboarding-state.entity.ts` (`OnboardingStepSnapshot`)
- **Category:** Observability
- **Description:** Each step has `status` and optional `completedAt`. There is no `startedAt`, `attempts`, or `error` info. If a merchant gets stuck on a step (e.g., waiting for callback), operators cannot see how long they've been waiting.
- **Impact:** No visibility into merchant progress.
- **Remediation:** Add optional fields: `startedAt`, `durationSeconds`, `lastError?`. This is a schema change; acceptable as future work.

#### ONB-M4 — Controller uses loose request casting

- **File:** `presentation/http/onboarding.controller.ts`
- **Category:** Type Safety
- **Description:** `@Req() request: unknown` then `currentUser(request as { user?: unknown }).merchantId`.
- **Impact:** Loose types; easy to miss validations.
- **Remediation:** Same as MERC-H2: use @CurrentMerchant decorator.

#### ONB-M5 — OutboxRepository injected but not checked for null

- **File:** `application/complete-onboarding-step.use-case.ts`
- **Category:** Dependency Injection
- **Description:** The use-case injects `OUTBOX_REPOSITORY`. If the module is misconfigured (outbox not provided), a null error happens at runtime.
- **Impact:** Startup may fail cryptically.
- **Remediation:** Either (a) throw a descriptive error in OnModuleInit if OUTBOX_REPOSITORY is not provided, or (b) make outbox optional with `@Optional()` and skip publishing if missing.

#### ONB-M6 — No rollback if event publish fails

- **File:** `application/complete-onboarding-step.use-case.ts` (`execute()`)
- **Category:** Consistency
- **Description:** The use-case persists state, then publishes events. If `outbox.appendOutbox()` fails after `repository.save()` succeeds, the state is persisted but the event is not. A caller retrying the step sees it's already done and does not re-publish.
- **Impact:** Silent event loss.
- **Remediation:** Acceptable as-is if events are not critical for downstream (they are for notifications/analytics). Document the semantics: "Events are best-effort; state transitions are atomic."

#### ONB-M7 — ONBOARDING_STEP_ORDER is read-only array constant

- **File:** `domain/entities/onboarding-state.entity.ts`
- **Category:** Extensibility
- **Description:** `ONBOARDING_STEP_ORDER` is a hardcoded array. Adding new steps requires code changes.
- **Impact:** New steps require releases; no runtime configuration.
- **Remediation:** Acceptable for now (steps are domain logic, not configuration). If steps vary by merchant, this becomes a port.

---

### LOW

#### ONB-L1 — `completedAt()` returns the last step's completedAt, not final onboarding completion time

- **File:** `domain/entities/onboarding-state.entity.ts` (`completedAt()`)
- **Category:** Clarity
- **Description:** Method returns `ONBOARDING_STEP_ORDER.map(...).sort().at(-1)` — the latest timestamp of all completed steps. This is the time of the last step, not the time onboarding finished (which should be the same, but the intent is unclear).
- **Impact:** Confusing API.
- **Remediation:** Rename to `finalStepCompletedAt()` or add `onboardingCompletedAt()` that returns the timestamp of the publish step.

#### ONB-L2 — `nextStep()` returns undefined when complete, but `toResponse()` returns null

- **File:** `domain/entities/onboarding-state.entity.ts` (`toResponse()` and `nextStep()`)
- **Category:** Consistency
- **Description:** `nextStep()` returns `undefined` when all steps are done. `toResponse()` maps this to `next_step: undefined` (JSON serialized as `null`). The API returns `next_step: null` for completed merchants, which is correct, but the internal representation differs.
- **Impact:** Minor; acceptable nullability handling.
- **Remediation:** Consistent; no change needed.

#### ONB-L3 — No maximum attempts or timeout for step completion

- **File:** `domain/entities/onboarding-state.entity.ts`
- **Category:** Robustness
- **Description:** A merchant can be stuck on a step indefinitely. There is no "timeout" or "max attempts" field.
- **Impact:** Stuck merchants are not surfaced.
- **Remediation:** Add optional `timeoutSeconds` and `maxAttempts` fields (future work for observability).

#### ONB-L4 — Prisma repo uses `upsert` which may not backfill missing steps on existing records

- **File:** `infrastructure/prisma-onboarding-state.repository.ts` (`save()`)
- **Category:** Data Quality
- **Description:** `upsert` only updates the `steps` field. If a new step is added to ONBOARDING_STEP_ORDER, existing rows won't have it until they are updated.
- **Impact:** Inconsistent state until update.
- **Remediation:** `rehydrate()` already handles missing steps; acceptable (forward-compatible).

---

## Coupling Map

```
onboarding
  ← auth (AuthGuard import in controller)
  ← shared/messaging (OutboxRepository for event publish)
  ← shared-types (OnboardingStateResponse, OnboardingStepId types)
  → no outbound except shared-types ✓
```

Coupling is minimal and appropriate. No cross-module dependencies (good isolation).

---

## Proposed Changes

1. **Add merchant existence validation** in CompleteOnboardingStepUseCase
2. **Fix withAccount() mutation** — create fresh entity after calling completeStep
3. **Derive event_id deterministically** or document retry semantics
4. **Fix GetOnboardingStateUseCase mutation** — return response without mutating entity
5. **Add @Optional OutboxRepository** with graceful degradation
6. **Document event publish semantics** (best-effort vs. atomic)
7. **Use @CurrentMerchant decorator** in controller
8. **Log when backfilling missing steps** in rehydrate
9. **Add test for concurrent step completion** (idempotency)
10. **Consider adding timestamps** for observability (startedAt, lastError)

---

## SOLID Alignment

- **SRP:** Each use-case has one responsibility. CompleteOnboardingStep combines state mutation + event publishing; acceptable.
- **OCP:** Adding a new step requires updating ONBOARDING_STEP_ORDER (constant) and schema. This is acceptable (domain logic, not policy).
- **LSP:** Repositories implement the same interface (good).
- **ISP:** Port is minimal (good).
- **DIP:** Use-cases inject repositories via symbols (good). No violation.

---

## Object Calisthenics

- **One level of indentation:** Methods are mostly flat. `complete-onboarding-step.use-case.ts` has 2 nested loops (for validation, for event creation); acceptable.
- **No ELSE:** Early returns used (good).
- **Short methods:** Use-cases are 15-30 lines (good).
- **Wrap primitives:** Step IDs are strings (acceptable for enums).
- **Keep it DRY:** No duplication; constants are reused.

---

## Priority Execution Order

1. **ONB-H1** — Add merchant existence validation
2. **ONB-H2** — Fix withAccount() mutation
3. **ONB-M1** — Fix GetOnboardingState mutation
4. **ONB-H3** — Derive or document event_id idempotency
5. **ONB-M5** — Make OutboxRepository @Optional with graceful degradation
6. **ONB-M4** — Add @CurrentMerchant decorator
7. Remaining items
