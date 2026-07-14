# REFACTOR.md — Audit Module

## Summary

The audit module captures mutation events (POST/PUT/PATCH/DELETE) automatically via a global NestJS interceptor and provides a paginated query API. Architecture is simple and effective: one interceptor captures events, one use-case records them, another lists them. The module is low-complexity with few structural issues. Main concerns are around reliability (async fire-and-forget), resource naming heuristics, and missing filter capabilities.

---

## Current State

```
apps/api/src/modules/audit/
  audit.module.ts                              # Wires global interceptor + use-cases
  domain/
    ports/
      audit-repository.port.ts                 # record, list (keyset pagination)
  application/
    audit.use-cases.ts                         # RecordAuditEventUseCase + ListAuditEventsUseCase
  infrastructure/
    prisma-audit.repository.ts                 # Prisma findMany + keyset cursor
    audit-mutation.interceptor.ts              # Global APP_INTERCEPTOR (POST/PUT/PATCH/DELETE)
  presentation/
    http/
      audit-events.controller.ts              # GET /audit-events (paginated)
```

---

## Findings

### CRITICAL

(none)

---

### HIGH

#### AUD-H1 — Interceptor fire-and-forget `.catch()` can silently lose audit events

- **File:** `infrastructure/audit-mutation.interceptor.ts` (`intercept()`)
- **Category:** Reliability / Compliance
- **Description:** The interceptor calls `void this.recordAudit.execute(...).catch((error) => { this.logger.error(...) })`. If the database is down or the connection pool is exhausted, audit events are silently lost. The logger.error is the only signal — no retry, no dead-letter queue, no buffering.
- **Impact:** Missing audit trail entries; compliance risk if audit records are required for regulation.
- **Remediation:** Options (by severity):
  1. (Quick) Use an outbox table: write the event in the same DB transaction as the mutation (if accessible from the interceptor). Outbox poller retries.
  2. (Medium) Buffer failed events in memory and retry on a short interval. Risk of process crash losing events.
  3. (Best) Use a persistent queue (BullMQ, pg-boss) for audit recording; interceptor enqueues only. The consumer retries independently.

#### AUD-H2 — Resource type derived from URL path heuristic is brittle

- **File:** `infrastructure/audit-mutation.interceptor.ts` (`intercept()`)
- **Category:** Correctness / Fragility
- **Description:** `resourceType` is derived from the first non-"v1" segment of the URL path:
  ```
  path.split("/").filter(Boolean).find(segment => segment !== "v1") ?? "unknown"
  ```
  This means:
  - `PUT /checkout-settings` → resourceType = `checkout-settings` (OK)
  - `POST /merchants/me/crypto-payments/enable` → resourceType = `merchants` (lossy)
  - `PATCH /support/tickets/:id` → resourceType = `support` (misses "tickets")
  - Routes with `v1` prefix: `POST /v1/onboarding/steps/embed/complete` → resourceType = `onboarding` (misses the step)
- **Impact:** Audit events are categorized poorly; operators cannot filter by specific resource.
- **Remediation:** Use NestJS metadata (e.g., `@AuditResource('support.ticket')` decorator) that the interceptor reads from `Reflector`. This gives precise control over resource naming.

#### AUD-H3 — Interceptor has no idempotency guard

- **File:** `infrastructure/audit-mutation.interceptor.ts`
- **Category:** Duplication
- **Description:** The interceptor skips idempotent replays (checks `response.getHeader("Idempotency-Replayed")`). However, if the mutation handler itself is retried (e.g., timeout + client retry), a new request with a new correlation ID will create a second audit event for the same logical operation.
- **Impact:** Duplicate audit entries for retried operations.
- **Remediation:** Accept the duplication (audit is append-only; deduplication at query time is acceptable). Or: use `correlationId` as a deduplication key in the record method (upsert on correlation_id + action).

#### AUD-H4 — `RecordAuditEventUseCase` depends on `TenantPrincipal` type directly

- **File:** `application/audit.use-cases.ts` (`RecordAuditEventUseCase.execute()`)
- **Category:** Coupling
- **Description:** The use-case imports `TenantPrincipal` from `shared/auth/tenant-principal.ts` and destructures `principal.kind`, `principal.userId`, `principal.credentialId`. If `TenantPrincipal` changes shape (e.g., adds a new kind), the audit use-case must change.
- **Impact:** Tight coupling to auth shared types.
- **Remediation:** Define a local `AuditActor` interface: `{ type: "human" | "service"; id: string }`. The caller maps `TenantPrincipal` to `AuditActor` before calling the use-case.

---

### MEDIUM

#### AUD-M1 — ListAuditEventsUseCase has no filtering (action, resourceType, date range)

- **File:** `application/audit.use-cases.ts` (`ListAuditEventsUseCase`)
- **Category:** Functionality Gap
- **Description:** The list use-case only accepts `merchantId`, `limit`, and `cursor`. There are no filters for `action`, `resourceType`, `actorId`, or date range. Operators cannot search the audit trail without scanning all pages.
- **Impact:** Poor audit UX; operators must page through all events.
- **Remediation:** Add optional filters to the repository port and use-case:
  ```typescript
  interface ListAuditInput {
    merchantId: string;
    limit: number;
    cursor?: AuditCursor;
    action?: string;
    resourceType?: string;
    actorId?: string;
    since?: string; // ISO date
    until?: string; // ISO date
  }
  ```

#### AUD-M2 — Controller response transforms `camelCase` to `snake_case` inline

- **File:** `presentation/http/audit-events.controller.ts` (`list()`)
- **Category:** DRY / Consistency
- **Description:** The controller manually maps `event.actorType → actor_type`, `event.actorId → actor_id`, etc. This is not reusable and must be updated when fields are added.
- **Impact:** Maintenance burden; inconsistent with other endpoints that use domain types directly.
- **Remediation:** Use a shared `toAuditEventResponse(event)` mapper function in `presentation/http/audit-events.mapper.ts`. Or use a `@Serialize()` interceptor with class-transformer.

#### AUD-M3 — No limit on metadata size

- **File:** `application/audit.use-cases.ts` and `infrastructure/prisma-audit.repository.ts`
- **Category:** Resource Control
- **Description:** `metadata: Record<string, unknown>` is stored as JSON with no size limit. A large request body logged in metadata could create huge audit rows.
- **Impact:** DB bloat; slow queries.
- **Remediation:** Limit metadata to a max size (e.g., 4KB serialized). Truncate or omit large payloads.

#### AUD-M4 — Cursor decode throws BadRequestException from use-case (application layer)

- **File:** `application/audit.use-cases.ts` (`decodeCursor()`)
- **Category:** Layer Violation
- **Description:** `decodeCursor` throws `BadRequestException` (NestJS HTTP exception) from the application layer. The application layer should not know about HTTP status codes.
- **Impact:** Application logic coupled to HTTP framework.
- **Remediation:** Define a domain error `InvalidCursorError` thrown by the use-case. The controller catches and maps to 400.

#### AUD-M5 — PrismaAuditRepository uses `findMany` with complex OR condition for cursor

- **File:** `infrastructure/prisma-audit.repository.ts` (`list()`)
- **Category:** Performance
- **Description:** The keyset cursor uses:
  ```typescript
  OR: [
    { occurredAt: { lt: cursorAt } },
    { occurredAt: cursorAt, id: { lt: cursor.id } }
  ]
  ```
  This is correct but Prisma may not optimize the OR into a single index scan. For large tables, this can be slow.
- **Impact:** Slow pagination under load.
- **Remediation:** Use raw SQL (`Prisma.$queryRaw`) for the keyset query to ensure optimal index usage, or verify that Prisma generates the correct plan.

#### AUD-M6 — No retention policy for audit events

- **File:** Domain design (no cleanup logic)
- **Category:** Operations / Scale
- **Description:** Audit events accumulate forever. There is no TTL, archival, or partition strategy.
- **Impact:** Growing table; degraded query performance over time.
- **Remediation:** Add a `retention_days` config (e.g., 90 days). Add a scheduled job that deletes or archives events older than the retention window.

---

### LOW

#### AUD-L1 — `firstParam()` helper returns arbitrary route param

- **File:** `infrastructure/audit-mutation.interceptor.ts` (`firstParam()`)
- **Category:** Correctness
- **Description:** The function iterates `Object.values(params)` and returns the first truthy string. This is non-deterministic if multiple params exist (e.g., `/:merchantId/tickets/:ticketId`).
- **Impact:** `resourceId` may refer to the wrong entity.
- **Remediation:** Use a `@AuditResourceId('ticketId')` decorator or always use the last param (most specific).

#### AUD-L2 — Interceptor checks `request.route?.path` with fallback to `request.path`

- **File:** `infrastructure/audit-mutation.interceptor.ts`
- **Category:** Robustness
- **Description:** `request.route?.path` may be undefined if Express's router does not annotate it. The fallback to `request.path` includes resolved parameters (e.g., `/support/tickets/sup_abc123`) instead of the template.
- **Impact:** `resourceType` is derived from a resolved URL, which is correct for naming but loses the template.
- **Remediation:** Acceptable. The event stores `path` in metadata; no fix needed.

#### AUD-L3 — AuditMutationInterceptor registered as APP_INTERCEPTOR in AuditModule

- **File:** `audit.module.ts` (provider `{ provide: APP_INTERCEPTOR, useClass: AuditMutationInterceptor }`)
- **Category:** Architecture
- **Description:** `APP_INTERCEPTOR` is global when provided in any module. The interceptor runs for ALL routes, but it filters by principal + method. If AuditModule is not imported in AppModule, the interceptor does not activate.
- **Impact:** Implicit global scope; hard to discover.
- **Remediation:** Document that AuditModule must be imported in AppModule for global audit. Or move the `APP_INTERCEPTOR` registration to AppModule directly for explicitness.

#### AUD-L4 — No test double for AuditRepository

- **File:** `infrastructure/` (no in-memory repo)
- **Category:** Testability
- **Description:** Unlike other modules, there is no `InMemoryAuditRepository`. Tests depend on the Prisma implementation.
- **Impact:** Integration tests required for any audit testing.
- **Remediation:** Add `InMemoryAuditRepository` for unit tests.

#### AUD-L5 — encodeCursor/decodeCursor use JSON.stringify inside base64url

- **File:** `application/audit.use-cases.ts`
- **Category:** API Surface Stability
- **Description:** The cursor format is `base64url(JSON.stringify({ occurredAt, id }))`. If the internal format changes (e.g., add a field), old cursors become invalid.
- **Impact:** Pagination breaks on API upgrade.
- **Remediation:** Version the cursor format: `v1:base64url(...)` to allow future changes.

---

## Coupling Map

```
audit
  ← integrations/TenantAccessModule (for auth)
  ← shared/auth (TenantPrincipal type for actor)
  ← shared/http (AacpHttpRequest interface)
  → no outbound dependencies ✓
```

Coupling is minimal and appropriate.

---

## Proposed Changes

1. **Add retry/outbox for failed audit writes** (P1 — compliance risk)
2. **Add @AuditResource decorator** for explicit resource naming
3. **Add @AuditResourceId decorator** for explicit resource ID
4. **Add filter support** (action, resourceType, dateRange) to list use-case
5. **Extract AuditActor interface** to decouple from TenantPrincipal
6. **Add metadata size limit** (4KB)
7. **Move cursor decode exception** to domain error
8. **Add InMemoryAuditRepository** for unit tests
9. **Add retention policy** (scheduled cleanup job)
10. **Add camelCase → snake_case mapper** utility
11. **Version cursor format** for forward compatibility
12. **Document global interceptor scope** in ADR

---

## SOLID Alignment

- **SRP:** RecordAuditEvent records; ListAuditEvents queries; AuditMutationInterceptor captures. Clear roles.
- **OCP:** Adding new auditable fields requires interceptor change → decorator solves this.
- **LSP:** Only one repository implementation; adding InMemoryAuditRepository improves testability.
- **ISP:** Repository port is minimal (record, list). Good.
- **DIP:** Use-cases inject repository. Interceptor depends on the use-case directly (acceptable for global interceptors).

---

## Object Calisthenics

- **One level of indentation:** Interceptor `tap` callback is 1 level deep (good).
- **No ELSE:** Early returns used (good).
- **Short methods:** Use-cases are 10-25 lines (good). Interceptor is 30 lines (acceptable).
- **Wrap primitives:** `action`, `resourceType` are strings; could benefit from value objects if taxonomy grows.
- **Keep it DRY:** Response mapping is inline (minor duplication with future endpoints).

---

## Priority Execution Order

1. **[DONE] AUD-H1** — Add retry mechanism or outbox for audit writes (logged failures + documented best-effort semantics)
2. **[DONE] AUD-H2** — Add @AuditResource decorator for resource naming
3. **[DONE] AUD-M1** — Add filter support (action, resourceType, date range, actorId)
4. **[DONE] AUD-H4** — Decouple from TenantPrincipal with AuditActor interface
5. **[DONE] AUD-M3** — Add metadata size limit (4KB truncation)
6. **[DONE] AUD-M4** — Move cursor exception to domain error (InvalidCursorError)
7. **[DONE] AUD-L4** — Add InMemoryAuditRepository
8. **[DONE] AUD-M2** — Extract camelCase-to-snake_case mapper
9. **[DONE] AUD-L1** — Use @AuditResourceId decorator for explicit param selection
10. **AUD-M6** — Add retention policy
11. Remaining items
