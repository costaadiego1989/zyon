# REFACTOR.md - installations Module

## Current State

**Module Size:** 853 LOC (7 files)
**Architecture:** Clean Architecture; operations-focused (health checks, CRUD)
**Maturity:** Production-ready; Prisma-backed, pagination supported

**Structure:**
- **Domain:** No entities; only port (72 LOC with type definitions)
- **Application:** 6 use-cases (List, Get, Create, Update, ReportHealth, ResolveForEmbed) - 284 LOC
- **Infrastructure:** PrismaInstallationRepository (173 LOC)
- **Presentation:** InstallationsController (213 LOC with pagination helpers), DTO (96 LOC)
- **Tests:** use-cases spec (288 LOC)
- **Module:** 36 LOC

**Key Invariants:**
- Installation name + environment unique per merchant
- Status: active, disabled, degraded
- Allowed origins must be HTTPS (except localhost in test)
- Widget version validated (semantic version pattern)
- Pagination cursor-based (creation order)

---

## Issues

### CRITICAL

1. **Prisma Repository Over-Parameterized**
   - PrismaInstallationRepository methods require merchant_id + installationId + more
   - findById scopes by merchant but also by installationId (unique across merchants?)
   - Unclear if unique constraint is global or per-merchant
   - **Impact:** Potential data leakage if unique is global + concurrent access
   - **Location:** `infrastructure/prisma-installation.repository.ts` lines 30–50

2. **Cursor-Based Pagination Ties to Prisma**
   - Cursor encoding: base64url(JSON) with createdAt + id
   - Parsing is manual; no standard library
   - If Prisma schema changes, cursor format could break
   - **Impact:** Backward incompatibility in cursor format
   - **Location:** `application/installation.use-cases.ts` lines 150–180

### HIGH

1. **No Validation on Origin Normalization**
   - normalizeOrigin() validates URL shape but doesn't check against merchant whitelist or deny-list
   - Any HTTPS domain is accepted
   - **Impact:** Merchant can register malicious origins
   - **Location:** `application/installation.use-cases.ts` lines 200–215

2. **Health Report Overwrites Previous Errors**
   - reportHealth() sets status = active/degraded, but lastErrorCode is overwritten
   - No history of error codes; only latest visible
   - **Impact:** No audit trail of degradation history
   - **Location:** `infrastructure/prisma-installation.repository.ts` reportHealth() method

3. **Widget Version Validation Regex Loose**
   - validateWidgetVersion() accepts any string matching basic pattern
   - No check against supported versions or SemVer strictness
   - **Impact:** Can register unsupported widget versions
   - **Location:** `application/installation.use-cases.ts` line 240–250

4. **ResolveInstallationForEmbed Unspecified**
   - Listed in module providers but not used by any controller
   - Logic unclear; probably resolves installation by embed token
   - No tests for this use-case
   - **Impact:** Dead code or incomplete feature
   - **Location:** `application/installation.use-cases.ts` (not visible in samples)

### MEDIUM

1. **CreateInstallation Has No Idempotency**
   - Name + environment unique; but no idempotent retry support
   - Duplicate request with same name + environment fails with conflict
   - Controller uses @Idempotent() but use-case doesn't handle idempotency key
   - **Impact:** Retries fail; UX broken
   - **Location:** `application/installation.use-cases.ts` CreateInstallationUseCase

2. **DTO Validation Minimal**
   - CreateInstallationDto validates required fields but not cross-field rules
   - No check that allowed_origins is non-empty
   - **Impact:** Can create installations with no allowed origins
   - **Location:** `presentation/http/installation.dto.ts` lines 1–40

3. **Controller Duplicate Validation**
   - Controller validates @Req() and maps to DTO
   - DTO validates again
   - Validators like `normalizeOrigin` are called in use-case, not DTO
   - **Impact:** Validation logic scattered; hard to audit
   - **Location:** `presentation/http/installations.controller.ts` + `application/installation.use-cases.ts`

4. **Pagination Limit Not Server-Clamped**
   - parsePageSize() allows user-provided limit; no max cap
   - Buyer can request 10,000 results in one page
   - **Impact:** DOS; unbounded memory consumption
   - **Location:** `presentation/http/installations.controller.ts` line 50–60

5. **Entity Tags Set Without Etag Validation**
   - InstallationsController sets response etag on create/get
   - But no @Header() validator for If-None-Match or If-Match on updates
   - **Impact:** Concurrent updates not protected
   - **Location:** `presentation/http/installations.controller.ts` line 80–120

### LOW

1. **No Audit Logging**
   - Create/update/delete not logged; no visibility into who changed what
   - **Impact:** No audit trail for compliance
   - **Location:** No logs in use-cases

2. **Error Messages Leak Internal Details**
   - installation_origin_invalid, installation_name_invalid
   - Users can infer validation rules
   - **Impact:** Minor security concern
   - **Location:** Validation helpers

3. **Hard-Coded Defaults**
   - Default status = "active" hard-coded in DTO/model
   - Environment default "test" unclear
   - **Location:** Various files

---

## Coupling Map

```
installations
├── domain
│   └── ports/installation-repository.port (72 LOC; types + interface)
├── application
│   ├── ListInstallationsUseCase
│   ├── GetInstallationUseCase
│   ├── CreateInstallationUseCase (validation helpers)
│   ├── UpdateInstallationUseCase
│   ├── ReportInstallationHealthUseCase
│   └── ResolveInstallationForEmbedUseCase
├── infrastructure
│   └── PrismaInstallationRepository (173 LOC; full impl)
├── presentation
│   ├── InstallationsController (213 LOC; pagination, etag)
│   ├── InstallationDto (96 LOC; validation)
│   └── Guards: TenantCredentialGuard, TenantAccessGuard
└── module
    ├── imports: [TenantAccessModule]
    ├── providers: use-cases + repository
    └── (clean module wiring)

External:
- TenantAccessModule (merchant context)
- Prisma (data layer)
- @nestjs/common (decorators)
```

---

## Proposed Changes

### P0: Clamp Pagination Limit

**Problem:** No max cap on limit; DOS risk.

**Solution:**
1. Set MAX_LIMIT = 100 constant
2. parsePageSize() clamps limit to [1, MAX_LIMIT]
3. Add test that oversized limit is clamped

**Estimate:** 30 minutes

---

### P1: Add Error Code History

**Problem:** Only latest error visible; no history.

**Solution:**
1. Add errorCodeHistory: string[] to Installation model (or separate table)
2. reportHealth() appends to history (max 10 entries)
3. List endpoint includes recent errors in response
4. Add test for error history

**Estimate:** 2 hours

---

### P2: Add Origin Whitelist Validation

**Problem:** Any HTTPS origin accepted.

**Solution:**
1. Create InstallationOriginValidator service
2. Check origin against merchant-specific allow-list or known-good patterns
3. Reject suspicious domains (parked, registrar holding pages)
4. Add configuration for origin validation rules

**Estimate:** 2–3 hours

---

### P3: Implement Idempotent Create

**Problem:** Duplicate create requests fail.

**Solution:**
1. Add idempotency_key to HTTP request headers
2. Store idempotency record mapping key → response
3. Duplicate request returns cached response
4. Add idempotent.decorator if not present in framework
5. Add test for duplicate requests

**Estimate:** 2–3 hours

---

### P4: Consolidate Validation

**Problem:** Validation scattered (DTO, controller, use-case).

**Solution:**
1. Move all field validation to DTO
2. Move all business rule validation (origin, widget version, etc.) to use-case
3. Controller only maps HTTP → DTO
4. Use-case receives validated DTO

**Estimate:** 1–2 hours

---

### P5: Add Etag-Based Concurrency Control

**Problem:** Entity tags set but not validated on update.

**Solution:**
1. Add @Header('If-Match') etag validation to update endpoint
2. Return 412 Precondition Failed if etag doesn't match
3. Use Prisma's `version` field for optimistic locking (if available)
4. Add test for concurrent update conflict

**Estimate:** 2 hours

---

### P6: Implement Audit Logging

**Problem:** No audit trail.

**Solution:**
1. Inject AuditLogService into each use-case
2. Log create/update/delete with who, what, when
3. Correlate with merchant_id + actor identity
4. Add audit log retention policy

**Estimate:** 2–3 hours

---

### P7: Strict Widget Version Validation

**Problem:** Any version pattern accepted.

**Solution:**
1. Define supported versions in configuration
2. validateWidgetVersion() checks against supported list
3. Add deprecation window (e.g., support n-1 versions)
4. Return error if version unsupported or deprecated

**Estimate:** 1–2 hours

---

## SOLID Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **S**ingle Responsibility | ⚠ | CreateInstallationUseCase mixes validation + creation + event. |
| **O**pen/Closed | ✓ | Repository port extensible; use-cases don't hard-code behavior. |
| **L**iskov Substitution | ✓ | Repository correct. |
| **I**nterface Segregation | ✓ | Port is focused (6 methods). |
| **D**ependency Inversion | ✓ | Use-cases depend on port. |

---

## Object Calisthenics

| Rule | Status | Notes |
|------|--------|-------|
| 1. One level of indentation | ✓ | Methods well-factored. |
| 2. No `else` | ✓ | Early returns used. |
| 3. Wrap primitives in objects | ⚠ | Installation fields are loose (name, environment, status). |
| 4. First-class collections | ✓ | allowedOrigins wrapped. |
| 5. No getters/setters | ✓ | No direct property access in use-cases. |
| 6. One dot per line | ✓ | No deep chaining. |
| 7. No abbreviations | ✓ | Clear naming. |
| 8. Keep classes small | ✓ | Each use-case is compact. |
| 9. No more than 2 instance variables | ✓ | Use-cases have 1–2 deps. |

---

## Recommended Refactor Priority

1. **First:** Clamp pagination limit (P0) — DOS prevention.
2. **Second:** Idempotent create (P3) — UX reliability.
3. **Third:** Consolidate validation (P4) — clarity.
4. **Fourth:** Add etag concurrency (P5) — production robustness.
5. **Fifth:** Strict widget version (P7) — feature gatekeeping.
6. **Sixth:** Error code history (P1) — observability.
7. **Seventh:** Origin whitelist (P2) — security hardening.
8. **Eighth:** Audit logging (P6) — compliance.

---

## Reference Files

- `/apps/api/src/modules/installations/domain/ports/installation-repository.port.ts`
- `/apps/api/src/modules/installations/application/installation.use-cases.ts`
- `/apps/api/src/modules/installations/infrastructure/prisma-installation.repository.ts`
- `/apps/api/src/modules/installations/presentation/http/installations.controller.ts`
- `/apps/api/src/modules/installations/presentation/http/installation.dto.ts`
