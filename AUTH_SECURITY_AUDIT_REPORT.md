# Production Readiness Audit: Auth & Tenant Isolation
**Date:** 2026-08-24  
**Scope:** `apps/api/src/modules/auth`, `apps/api/src/modules/buyer-account`, `apps/api/src/shared/auth`, `apps/api/src/shared/tenant`  
**Status:** 18 findings (2 P0, 5 P1, 7 P2, 4 P3)

---

## Executive Summary

The auth and tenant isolation subsystem has **two P0 (critical) findings** that break production readiness:

1. **R2P-001: JWT Audience Confusion** — Buyer tokens are accepted by merchant routes, enabling tenant escape and cross-tenant data leaks.
2. **R2P-003: OTP Brute-Force** — Unauthenticated phone OTP endpoints with 6-digit codes and no lockout enable account takeover in seconds.

Additionally, **in-memory storage** (OTP, rate limiter) fails under horizontal scaling, and **refresh tokens** lack revocation, enabling indefinite session hijacking. These must be fixed before any production deployment.

---

## Critical Findings (P0 + P1)

### R2P-001 [P0] — JWT Audience Confusion (merchant ⟷ buyer)
**Files:** `modules/auth/domain/services/jwt.service.ts:36-50`, `modules/auth/presentation/auth.guard.ts`, `modules/buyer-account/domain/services/buyer-jwt.service.ts:20`

**Issue:**
- `BuyerJwtService` currently uses `JWT_SECRET` — the same secret as merchant auth.
- `JwtService.verify()` in merchant `AuthGuard` skips validation of `aud` and `role`.
- Result: A buyer JWT (`aud:"buyer"`, `role:"buyer"`) passes signature verification in the merchant guard.
- The principal is then extracted with `merchantId = undefined`, and downstream Prisma queries omit the merchant filter.

**Impact:** Complete tenant escape. Buyer tokens open merchant routes. A buyer can read/write all merchants' data.

**Remediation:**
1. `BuyerJwtService` → use `BUYER_JWT_SECRET` (separate environment variable, required in production).
2. `JwtService.verify()` → reject tokens where `aud==="buyer"` or `role==="buyer"`.
3. `JwtService.verify()` → assert `merchant_id` is non-empty string.
4. `AuthGuard` → assert `principal.tenantId` is non-empty before populating request.
5. **E2E test:** buyer JWT denied on `/api/merchant/...` endpoints.

**ADR Reference:** auth#B1, buyer-account#B1

---

### R2P-003 [P0] — OTP Brute-Force (6-digit code, no lockout, public endpoints)
**Files:** `modules/buyer-account/application/use-cases/verify-buyer-phone-code.use-case.ts:20-45`, `modules/buyer-account/application/use-cases/send-buyer-phone-code.use-case.ts:9`

**Issue:**
- `/buyer/phone/send` and `/buyer/phone/verify` are public, unauthenticated endpoints.
- OTP code is 6 digits: 10^6 = 1 million combinations.
- `VerifyBuyerPhoneCodeUseCase` increments `attempts` counter but does **not enforce lockout**; any error re-increments.
- TTL is 5 minutes; no backoff or distributed rate limit per IP+phone.
- Attacker knowing a phone number: ~1 million attempts over 300 seconds = trivial online brute-force.

**Impact:** Account takeover. Any phone number → OTP cracked in seconds → JWT issued → full buyer account compromise.

**Remediation:**
1. Enforce lockout: after `maxAttempts` failures (e.g., 5), mark OTP as locked (consume it, set `attempts >= maxAttempts`).
2. Add distributed rate limit on `/phone/send` and `/phone/verify` by IP + phone number (e.g., 1 request per 10 seconds per IP+phone).
3. Consider 8+ digit codes or alphanumeric (entropy > 10^6).
4. Persist OTP store in Prisma or Redis (see R2P-004).
5. **E2E test:** send OTP, attempt verify 5× (wrong code), attempt 6× → `UnauthorizedException('otp_locked')`.

**ADR Reference:** buyer-account#B2

---

### R2P-002 [P1] — Rate Limiter Contournable via `x-device-id` Header
**Files:** `modules/auth/domain/services/login-rate-limiter.service.ts:53-55`, `modules/auth/presentation/auth.controller.ts:29-32`

**Issue:**
- Rate limiter keys on `${ip}:${deviceId}`.
- `deviceId` is read from client header `x-device-id` (attacker-controlled).
- Rotating the header creates a new bucket → bypasses the 5-attempt limit.
- IP also defaults to `"unknown"` when unresolved.

**Impact:** Credential stuffing / brute-force protection bypassed. 5 attempts × N devices = no protection.

**Remediation:**
1. Key limiter on trusted identifiers only: **IP (server-resolved) + normalized email**.
2. Omit `deviceId`.
3. Asseverate IP is not `"unknown"`; if unresolved, use `X-Forwarded-For` or reject.
4. **Test:** attempt login 5× with same IP+email, all wrong → 6th attempt → `429 Too Many Requests`.

**ADR Reference:** auth#B2

---

### R2P-006 [P1] — Refresh Tokens Accepted for 7 Days Post-Expiry, No Revocation
**Files:** `modules/auth/domain/services/jwt.service.ts:56-71`, `modules/auth/application/refresh-token.use-case.ts`

**Issue:**
- `JwtService.verifyForRefresh(token, graceSeconds=7*24*3600)` accepts tokens expired <7 days.
- No denylist, no `token_version`, no password-change invalidation.
- Each refresh resets the 7-day window.
- `/auth/refresh` is unauthenticated and unthrottled.

**Impact:** Stolen token = indefinite session renewal. Changing password does not log out. User has no way to revoke a compromised token.

**Remediation:**
1. Introduce `token_version` in merchant user table (increment on password change, logout-all, etc.).
2. `JwtService.verify()` and `verifyForRefresh()` check `token_version` against stored version.
3. Shorten grace window or require server-side validation.
4. Add rate limit to `/auth/refresh` by IP.
5. **Migration:** add `token_version INT DEFAULT 1` to merchant user.
6. **E2E test:** (a) change password → old refresh token rejected. (b) logout-all → all tokens revoked.

**ADR Reference:** auth#B3

---

### R2P-004 [P2] — OTP and Rate-Limiter in Process Memory Map
**Files:** `modules/auth/domain/services/login-rate-limiter.service.ts:14`, `modules/buyer-account/infrastructure/in-memory-otp-store.ts`, `modules/buyer-account/infrastructure/redis-otp-store.ts`

**Issue:**
- `LoginRateLimiter` uses in-memory `Map<string, AttemptBucket>()`.
- OTP store also in-memory (injected; can be Prisma but defaults to in-memory in tests).
- Under horizontal scaling: OTP issued on node A not verifiable on node B.
- Rate limit counters are per-instance, multiplied by number of nodes.
- State lost on restart; deployment cycle clears all buckets.

**Impact:** Phone login broken on multi-node deployments. Rate limits ineffective at scale. Distributed rate-limit store needed.

**Remediation:**
1. Always use Prisma OTP store (table `buyerPhoneOtp` exists; ensure production wiring).
2. Inject rate-limiter via port, not local `Map`.
3. Implement Redis-backed rate limiter for login (or use Prisma + cron cleanup of expired buckets).
4. **No schema change needed** (table exists); fix DI wiring and ensure Redis is configured in production.

**ADR Reference:** buyer-account#B3, auth#B3

---

## High-Priority Findings (P1)

### R2P-008 [P1] — No E2E Test for OTP Lockout
**Files:** `modules/buyer-account/application/use-cases/otp-hardening.spec.ts`

**Issue:** Code checks `attempts >= maxAttempts` but no test pins this behavior. Future changes may silently remove lockout.

**Remediation:** Add E2E: send OTP → verify 5 times (all wrong) → verify attempt 6 → `UnauthorizedException('otp_locked')`.

---

### R2P-010 [P1] — TenantGuard Does Not Validate JWT `merchant_id` ⟷ URL
**Files:** `shared/tenant/tenant.guard.ts:45-70`

**Issue:**
- `TenantGuard.validateTenantRequest` extracts `merchantId` from principal and checks URL/body `merchantId` match.
- But if a route omits the merchant parameter and relies solely on JWT, the check is bypassed.

**Impact:** If routing relies on JWT alone (without explicit `merchantId` in URL/body), a mismatched or malicious JWT could slip through.

**Remediation:** Document: every route reading `merchantId` from params/body must assert JWT `merchant_id` matches before any data operation. Add test for cross-tenant param tampering.

---

### R2P-015 [P1] — No Cross-Tenant Isolation Test (Buyer JWT + Merchant Route)
**Files:** `shared/persistence/cross-tenant-fuzz.prisma-e2e-spec.ts`

**Issue:** No E2E test verifies that buyer-A JWT + merchant-B URL is rejected, or that buyer-A cannot read buyer-B purchases.

**Impact:** Tenant isolation not validated; regression risk if guards change.

**Remediation:** Add E2E: (a) buyer JWT → merchant route → 401. (b) buyer-A JWT + ?merchant_id=merchant-b → 403. (c) both TenantGuard + Prisma middleware layers tested.

---

## Medium-Priority Findings (P2)

### R2P-005 [P2] — OTP and PII in Plain-Text Logs
**Files:** `modules/buyer-account/application/use-cases/send-buyer-phone-code.use-case.ts:29`, `modules/buyer-account/application/use-cases/verify-buyer-phone-code.use-case.ts:38-46`

**Issue:** Logs contain `code=123456 phone=5511999999999` in plaintext. Any log accessor (devops, CI, aggregators) reads OTPs and phone numbers.

**Impact:** Secrets + PII in cleartext logs. Compromises OTP and buyer identity.

**Remediation:**
1. Never log the OTP code or hash.
2. Log only redacted marker: `[OTP sent to ***1234]` (last 4 digits only).
3. Require feature flag for verbose dev-only logging.
4. Verify `app.module.ts` redact paths include OTP fields.

---

### R2P-007 [P2] — Register Accepts Client `merchant_id` + TOCTOU on Email
**Files:** `modules/auth/application/register-merchant.use-case.ts:30-41`

**Issue:**
- `merchantId = input.merchant_id ?? generated` — client can choose tenant ID.
- Uniqueness check on email (`findUserByEmail`) + create has race condition: two concurrent requests both pass check, second hits constraint → 500.

**Impact:** Tenant ID squatting / predictability. Email collision returns 500 instead of 409 Conflict.

**Remediation:**
1. Always server-generate `merchantId`; ignore client input.
2. Catch unique-constraint on email and map to `ConflictException` (409).

---

### R2P-011 [P2] — Phone-Only Accounts Have Malformed `passwordHash`
**Files:** `modules/buyer-account/application/use-cases/verify-buyer-phone-code.use-case.ts:31-42`

**Issue:**
- Phone-only accounts created with `passwordHash = null` (or UUID).
- Email set to `phone_<num>@buyer.aacp` (fake, occupies unique index).

**Impact:** Passwordless auth method not explicit; no `auth_method` flag. Merging phone↔email accounts later is complex.

**Remediation:**
1. **Migration:** (a) make `passwordHash` nullable. (b) add `auth_method` enum (`PASSWORD | PHONE | EMAIL`).
2. For phone accounts: set `email = NULL` or unique placeholder (not `@buyer.aacp`).

---

### R2P-012 [P2] — Buyer Purchases Cross-Merchant When `merchant_id` Omitted
**Files:** `modules/buyer-account/application/use-cases/get-buyer-purchases.use-case.ts:76,184`

**Issue:**
- `GetBuyerPurchasesUseCase.execute({ globalUserId, merchantId?, ... })`.
- When `merchantId` is omitted, the Prisma query omits the merchant filter → returns orders from all merchants.
- Violates CLAUDE.md invariant: "purchase history always filtered per merchant."

**Impact:** Cross-tenant data exposure. Buyer sees all merchants' orders with their ID.

**Remediation:** Carve-out + documentation:
- `/buyer/me/purchases` (buyer-scoped via `BuyerJwtAuthGuard`) **can** be cross-merchant (buyer's own history).
- Merchant-scoped routes (via `AuthGuard`) **must** filter by merchant.
- Update ADR 0018 invariant to reflect this policy.
- Pin with E2E test.

---

### R2P-016 [P2] — `CurrentTenant` Decorator Extracts Without Validation
**Files:** `shared/tenant/current-tenant.decorator.ts`

**Issue:** Throws if `merchantId` absent, but does not validate it is non-empty string or matches JWT.

**Remediation:** Asseverate `merchantId` is non-empty string; add unit test.

---

### R2P-017 [P2] — No Rate Limit on `/auth/refresh`
**Files:** `modules/auth/presentation/auth.controller.ts:73-91`

**Issue:** `/auth/refresh` is unauthenticated and unthrottled. Stolen refresh token can be cycled indefinitely.

**Impact:** Stolen token + no throttle = indefinite renewal.

**Remediation:** Add rate limiter to `/auth/refresh` by IP. Use distributed store (Prisma or Redis).

---

## Low-Priority Findings (P3)

### R2P-009 [P3] — OTP Generated with Non-Cryptographic PRNG
**Remediation:** Enforce `crypto.randomInt(100000, 1000000)` or higher range. Audit all OTP generation paths.

### R2P-013 [P3] — Pagination Cursor/Date Filters Not Validated
**Remediation:** Validate cursor structure, reject NaN dates, clamp limit. Treat `Invalid Date` as 400 Bad Request.

### R2P-014 [P3] — Cookie SameSite Defaults to `Lax` (CSRF Risk)
**Remediation:** Evaluate Strict vs Lax trade-off. If Lax required, add CSRF-token middleware or Strict on sensitive endpoints (logout, password change).

### R2P-018 [P3] — Response Types Not Validated Against Schema
**Remediation:** Use DTO + ClassValidator for response validation on critical endpoints.

---

## Gate Items for Production

**MUST FIX before deployment:**
1. **R2P-001** — JWT audience confusion breaks tenant isolation.
2. **R2P-003** — OTP brute-force enables account takeover.
3. **R2P-004** — In-memory OTP/rate-limiter fail at scale.
4. **R2P-006** — 7-day refresh without revocation enables indefinite compromise.
5. **R2P-002** — Rate limiter contournable via header.

**SHOULD FIX before GA:**
6. R2P-005 — OTP/PII in logs (secrets leak).
7. R2P-007 — Register TOCTOU + client-controlled merchant_id.
8. R2P-008, R2P-015 — E2E test coverage for isolation.
9. R2P-010, R2P-017 — TenantGuard validation + refresh rate limit.
10. R2P-011, R2P-012, R2P-016 — Data integrity & validation.

---

## Test Execution Checklist

```bash
cd apps/api

# Auth module tests
pnpm test modules/auth/

# Buyer account tests
pnpm test modules/buyer-account/

# Tenant isolation E2E (add tests for R2P-001, R2P-015)
pnpm test:prisma shared/persistence/cross-tenant-fuzz.prisma-e2e-spec.ts

# Full build + typecheck
pnpm build
pnpm typecheck
```

---

## Summary Table

| ID | Severity | Type | Title | Status |
|---|---|---|---|---|
| R2P-001 | P0 | SECURITY | JWT audience confusion | GATE |
| R2P-002 | P1 | SECURITY | Rate limiter bypassed via header | GATE |
| R2P-003 | P0 | SECURITY | OTP brute-force | GATE |
| R2P-004 | P2 | SECURITY | In-memory stores | GATE |
| R2P-005 | P2 | SECURITY | OTP in logs | HIGH |
| R2P-006 | P1 | SECURITY | Refresh without revocation | GATE |
| R2P-007 | P2 | DATA_INTEGRITY | Register TOCTOU | HIGH |
| R2P-008 | P1 | TEST_GAP | OTP lockout test | HIGH |
| R2P-009 | P3 | SECURITY | Math.random for OTP | LOW |
| R2P-010 | P1 | SECURITY | TenantGuard validation | HIGH |
| R2P-011 | P2 | DATA_INTEGRITY | Phone account schema | HIGH |
| R2P-012 | P2 | BUG | Cross-merchant purchases | HIGH |
| R2P-013 | P3 | VALIDATION | Cursor validation | LOW |
| R2P-014 | P3 | SECURITY | SameSite=Lax | LOW |
| R2P-015 | P1 | TEST_GAP | Cross-tenant E2E test | HIGH |
| R2P-016 | P2 | VALIDATION | CurrentTenant validation | HIGH |
| R2P-017 | P2 | SECURITY | Refresh rate limit | HIGH |
| R2P-018 | P3 | VALIDATION | Response validation | LOW |

---

## Conclusion

The auth subsystem has **production-blocking security issues** in JWT audience isolation, OTP brute-force, and refresh token revocation. These must be resolved before any production release. The team should prioritize the **GATE items** first, then address the **HIGH priority** findings before GA.

The codebase shows good intent (separate JWT secrets, Prisma middleware for tenant scoping, rate-limiter patterns) but incomplete hardening in critical paths. The ADRs document the decisions and known risks; implementation must follow through.

---

**Report prepared:** Staff Engineer Production Audit  
**Date:** 2026-08-24
