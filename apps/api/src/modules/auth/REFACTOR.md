# Auth Module — Refactor Plan

## Current State

The auth module handles merchant registration, login, JWT issuance, refresh, logout, and rate limiting. Structure:

```
apps/api/src/modules/auth/
  auth.module.ts                       # NestJS wiring + provider list
  domain/
    auth.types.ts                      # AuthMerchant / AuthUser / AuthenticatedPrincipal / AuthTokens
    ports/auth-repository.port.ts      # AuthRepository interface + AUTH_REPOSITORY symbol
    services/
      jwt.service.ts                   # sign/verify/verifyForRefresh HS256 + helpers
      password-hasher.service.ts       # scrypt-based hash/verify
      auth-cookie.service.ts           # Set-Cookie serialization (read/create/clear)
      login-rate-limiter.service.ts    # In-memory IP+email bucket limiter
  application/
    register-merchant.use-case.ts      # create merchant + owner user, issue token
    login.use-case.ts                  # verify password, issue token
  infrastructure/
    prisma-auth.repository.ts          # Prisma implementation
    in-memory-auth.repository.ts       # Test double (not wired in module root)
  presentation/
    auth.controller.ts                 # POST /auth/register, /auth/login, /auth/refresh, /auth/logout
    auth.guard.ts                      # Bearer + cookie auth, populates request.user + tenant principal
    tenant-role.guard.ts               # @RequireTenantRoles enforcement
    tenant-role.decorator.ts           # SetMetadata helper
```

Other modules consume: `AuthGuard`, `TenantRoleGuard`, `JwtService`, `AuthCookieService`, `AUTH_REPOSITORY` (exports from `AuthModule`).

---

## Architecture Issues

### CRITICAL

- **C1. `verifyForRefresh` allows indefinite token re-use via the 7-day grace window without revocation list.**
  `verifyForRefresh` accepts any token signed in the last 7 days, even after the user has logged out. A leaked token remains valid for refresh for up to 7 days post-expiry, and can be refreshed indefinitely within that window. The current `logout` endpoint only clears the cookie — there is no server-side revocation. → Fix: introduce `jti` claim + per-user token version (`tokenVersion`) persisted on `merchant_user`, embed it in the JWT, reject mismatches in `verify` and `verifyForRefresh`. Drop or shrink the grace window to seconds/minutes with sliding refresh only.

- **C2. PrismaAuthRepository swallows `merchantUser.id` non-null with `!`.**
  `PrismaAuthRepository.createMerchantWithOwner` uses `created.users[0]!` — if Prisma ever returns an empty array (e.g. include ordering race, schema change, partial migration), a `TypeError` is thrown deep in `register-merchant.use-case.ts`, surfacing as a 500. The use-case treats any non-P2002 error as a 500 too. → Fix: assert `created.users.length === 1` and throw a domain error (`MerchantOwnerNotCreated`) that maps to a 500 with a clear log.

- **C3. `requireSecret` default value leaks in dev.**
  `JwtService` constructor signature: `secret = requireSecret("JWT_SECRET", "dev-secret-change-me")`. If the secret loader returns the fallback whenever `JWT_SECRET` is missing in production (operator forgets to set env), tokens become forgeable by anyone who can read the codebase. The fallback must be strictly dev-only, and `requireSecret` must throw in production. → Fix: gate the fallback on `NODE_ENV !== "production"`, add a startup test in `auth.module.ts` (or a `OnModuleInit` hook) that verifies the secret is not the default.

- **C4. Login rate limiter is in-memory per Node process.**
  `LoginRateLimiter` stores buckets in a `Map`. Behind a load balancer or with multiple workers, an attacker rotates between instances / IPs to bypass the limit. The `attempts` map also grows unbounded (`this.attempts.set(key, bucket)` only ever adds). → Fix: implement a Redis-backed limiter behind the same `LoginAttemptScope` port; add eviction (sweep expired buckets) so memory does not grow.

### HIGH

- **H1. `AuthController` does orchestration that belongs in a use-case.**
  `loginWithPassword` constructs the rate-limit scope, calls `assertAllowed`, runs `LoginUseCase`, records success/failure, and sets the cookie. `refresh` re-implements token extraction (header vs cookie), then constructs an `AuthResponse` literal. These are application-layer concerns leaking into the controller. → Fix: introduce `LoginWithRateLimitUseCase` (or a service) that wraps `LoginUseCase` + `LoginRateLimiter`; introduce `RefreshTokenUseCase` that produces an `AuthResponse`. Controller should only translate HTTP ↔ use-case input.

- **H2. `AuthResponse` is duplicated and constructed inline in two places.**
  Defined in `register-merchant.use-case.ts`, exported as a function `toAuthResponse` (taking a `user` shape), but `AuthController.refresh` rebuilds the literal in-place with the same fields. The factory is only used by `register` and `login`. → Fix: move `AuthResponse` and `toAuthResponse` to `application/auth-response.ts`; make `RefreshTokenUseCase` use the same factory.

- **H3. `auth.guard.ts` mutates `request.user` AND `setTenantPrincipal`.**
  Two sources of truth for the principal: `request.user` (raw `AuthenticatedPrincipal`) and `setTenantPrincipal` (typed). `currentUser` and `currentTenantPrincipal` diverge — `currentUser` casts loosely (`as { role: "owner" | "admin" }`). Controllers/handlers pick whichever, leading to inconsistent principal reads. → Fix: pick one (the typed `TenantPrincipal` from `shared/auth`), deprecate `currentUser` and `request.user`, expose a single accessor.

- **H4. `LoginUseCase` does not enforce rate limiting.**
  The use-case only validates credentials. The controller has to call `assertAllowed/recordFailure/recordSuccess`. If anyone calls `LoginUseCase.execute()` from another controller, queue, or test path, the rate limit is silently bypassed. → Fix: inject `LoginRateLimiter` into the use-case (via a port) and let it own the `assertAllowed` + `recordSuccess/Failure` lifecycle.

- **H5. `register-merchant.use-case.ts` does not normalize inputs and validates only by side-effects.**
  No password strength check, no email format check (only `toLowerCase().trim()`). A 1-char password hashes fine and creates an account. There is no check that `merchant_name` is non-empty. → Fix: introduce a small validator (Zod or hand-rolled `assertValidEmail`/`assertStrongPassword`) at the use-case boundary; reject early with `BadRequestException`.

- **H6. `RegisterMerchantRequest.merchant_id` is accepted but ignored.**
  The request type still exposes `merchant_id?: string`, and the use-case silently ignores it. The comment says "Always generate merchant_id server-side", but the type implies it's settable. → Fix: remove the field from `RegisterMerchantRequest`.

- **H7. Cookie default `secure` flag depends on `NODE_ENV` only at construction time.**
  `AuthCookieService` reads `process.env.NODE_ENV === "production"` in the constructor. If the env changes at runtime (or if the service is rebuilt in a non-prod worker), it does not reflect. Also, `SameSite=Lax` is hardcoded — no `Strict` option, no `Domain`, no `Partitioned`. → Fix: read config from a `CookieConfig` injected at module load; support `sameSite`, `domain`, and `partitioned` config keys.

- **H8. `LoginRateLimiter` does not expose observability.**
  No logging of throttle events, no metrics, no `Retry-After` header on the 429 response. `HttpException("login_rate_limited", 429)` returns just the body. → Fix: log the scope + reset time, set `Retry-After` header in `recordFailure` consumer (controller), emit a counter.

### MEDIUM

- **M1. `RegisterMerchantUseCase` couples to `ConflictException` and string-sniffs Prisma error.**
  The catch uses `msg.includes("Unique constraint") || msg.includes("P2002")` — this breaks if Prisma changes message wording, version, or when run on Postgres vs SQLite. → Fix: introduce a domain error `EmailAlreadyRegisteredError` thrown by the repository (`PrismaAuthRepository` should check the error code structurally via `instanceof PrismaClientKnownRequestError && e.code === "P2002"`). Use-case maps it to `ConflictException`.

- **M2. `JwtService.sign` and `verify`/`verifyForRefresh` duplicate the parse + base64-decode logic.**
  Three nearly identical blocks (`parts = token.split(".")`, `sign(header+payload)`, `JSON.parse(Buffer.from(payload, "base64url"))`, principal reconstruction). → Fix: extract `parseAndValidate(token, options)` returning `{ header, payload, decoded }`.

- **M3. `JwtService.verifyForRefresh` re-implements `verify` instead of composing it.**
  The signature check, audience check, and merchant_id check are duplicated verbatim. The only diff is the expiry window. → Fix: factor a private `verifyCore(token, options)` and have both public methods delegate with different `{ requireNotExpired, graceSeconds }`.

- **M4. `AuthGuard` swallows all JWT errors with one message.**
  `catch { throw new UnauthorizedException("invalid_bearer_token"); }` masks `jwt_missing_merchant_id` vs `jwt_expired` vs `jwt_invalid_signature`. Operators can't tell why tokens are being rejected. → Fix: preserve the original error code in a structured log; consider exposing specific codes for `jwt_missing_merchant_id` only (security-relevant); keep `jwt_expired` opaque to clients.

- **M5. `AuthGuard` precedence: Bearer over Cookie.**
  `header.startsWith("Bearer ")` wins over the cookie. For browser dashboards, this is usually fine, but a stale Bearer in localStorage will keep a logged-out session alive (cookie cleared, but local Bearer remains). Documented behavior? → Fix: confirm intent (Bearer wins), document in ADR, or invert (cookie wins for same-origin, Bearer for cross-origin) via a config flag.

- **M6. `auth-cookie.service.ts` imports `AuthResponse` from `application/`.**
  Domain service importing from application layer inverts Clean Architecture (`presentation → application → domain ← infrastructure`). → Fix: move `AuthResponse` to `domain/auth.types.ts` (already partially there as `AuthTokens`); or define a domain-level `AuthCookieInput` with the cookie-relevant fields only.

- **M7. `password-hasher.service.ts` hard-codes the algorithm format.**
  `verify` parses `scrypt:salt:hash` and rejects anything else. If we ever want to migrate to argon2, all hashes become invalid (no upgrade path). → Fix: introduce `PasswordHasher` port with `Algorithm: "scrypt" | "argon2id"`; route based on parsed prefix; on successful verify with weaker algorithm, rehash with the stronger one and persist.

- **M8. `LoginRateLimiter.recordSuccess` deletes the bucket — allows instant retry after success.**
  If a legitimate user logs in successfully, then an attacker spoofs the same IP/email combo, the limiter is empty. The `key` mixes IP + email, but `ip` is the request IP, so an attacker from a different IP is not throttled. → Fix: keep success-based deletion but also enforce a global per-IP throttle (`assertAllowed(scope)` should additionally consult a `perIp` counter).

- **M9. `AuthController.logout` clears the cookie but does not blacklist the JWT.**
  Logout is effectively client-side only. A token captured before logout remains valid until its natural expiry (or `verifyForRefresh` window). Same root cause as C1 but worth listing as a discrete concern. → Fix: see C1.

- **M10. `LoginRateLimiter.assertAllowed` does not return a `Retry-After`.**
  The 429 carries no `Retry-After` header. → Fix: add `retryAfter(scope): number | undefined` and have the controller set the header before throwing.

- **M11. `RegisterMerchantUseCase` constructs `merchantId = mrc_${crypto.randomUUID()}` inline.**
  ID generation is a domain concern. → Fix: introduce `MerchantIdGenerator` port, inject into the use-case.

- **M12. `auth.types.ts` uses `AuthUser["role"]` indirection.**
  `AuthenticatedPrincipal.role: AuthUser["role"]` couples the principal to the persisted user shape. If `AuthUser.role` ever widens to include `agent`, every token payload picks it up. → Fix: define an explicit `TenantRole` union (`"owner" | "admin"`) in `domain/auth.types.ts` and reuse it.

- **M13. `AuthController.refresh` returns `token_type: "Bearer" as const` but does not construct `AuthResponse`.**
  Drift risk: any new field added to `AuthResponse` will not show up in `/refresh`. → Fix: use `toAuthResponse` (or new `RefreshTokenUseCase`).

### LOW

- **L1. `AuthGuard` uses `request.headers?.authorization` with a permissive type.**
  The decorator shape is typed as `string | string[] | undefined`. The guard assumes `string`. → Fix: narrow with `Array.isArray(header) ? header[0] : header`.

- **L2. `AuthGuard` reads cookie via `AuthCookieService.read` which does case-insensitive prefix match.**
  Browsers send cookies in declaration order, but `Set-Cookie` is also case-insensitive for names. The current `startsWith(prefix)` is correct but the `slice(prefix.length)` does not decode (`encodeURIComponent`). If cookie values are ever URL-encoded, the JWT will contain `%XX`. → Fix: document the contract (no encoding) and assert it in tests, or decode on read.

- **L3. `LoginRateLimiter` reads env vars in the constructor.**
  `process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5` is parsed once at construction. Configuration changes require a restart (acceptable) but there's no validation. → Fix: validate with `Number.isFinite()` and throw at boot on invalid input.

- **L4. `LoginRateLimiter` key function lowercases + trims email, but the scope's `email` is also normalized upstream.**
  Double work; minor. → Fix: normalize once at the controller boundary.

- **L5. `auth.controller.ts` has too many dependencies (5).**
  Each route handler touches 3-5 collaborators. → Fix: extract a thin `AuthResponseBuilder` (cookie + payload composition) so the controller only knows about use-cases and the response builder.

- **L6. `AuthController.register` does not apply rate limiting.**
  Anyone can call `/auth/register` in a tight loop to spam merchant creation. → Fix: same limiter, key = `register:${ip}`.

- **L7. `RegisterMerchantRequest` uses `merchant_name` (snake_case) but `AuthResponse` uses `merchant_id`, `user_id`, `access_token`.**
  Inconsistent casing across the module — both inside the auth boundary. → Fix: standardize (snake_case is fine for HTTP, but pick one and document).

- **L8. `in-memory-auth.repository.ts` is `@Injectable()` and lives in `infrastructure/`.**
  CLAUDE.md says "In-memory repos exist only as test doubles, constructed directly in specs (never injected via module roots)." This file is `@Injectable()` — never wired, but still a decoration that suggests it could be. → Fix: remove `@Injectable()` and the dependency on `@nestjs/common`, keep it as a plain class for direct instantiation in tests.

- **L9. `prisma-auth.repository.ts` defines `toAuthUser` as a module-private helper.**
  Both `PrismaAuthRepository` and `InMemoryAuthRepository` need the same mapping logic (today only Prisma does, but `InMemory` produces a similar shape by literal). Drift risk. → Fix: define `toAuthUser(row: PrismaMerchantUser): AuthUser` (and `toAuthMerchant`) in `infrastructure/prisma-mappers.ts`.

- **L10. `LoginUseCase` does not use the rate limiter.**
  Mentioned in H4. Restating here as a layering issue: the use-case shouldn't care about HTTP. The right place for rate-limit-aware logic is a wrapper use-case or a domain service called by the use-case.

- **L11. `auth.guard.ts` exports `currentUser` for inline use.**
  Hidden in a `presentation/` file but used by feature controllers (search for `currentUser`). Mixing presentation export with shared utility. → Fix: move to `shared/auth/current-user.ts`.

- **L12. `JwtPayload.role: string` is widened.**
  The role is `string` at the payload level but cast to `AuthenticatedPrincipal["role"]` at verify. No runtime validation. A crafted JWT with `role: "superadmin"` would round-trip. → Fix: assert role ∈ `"owner" | "admin"` during verify.

- **L13. `LoginUseCase` throws `UnauthorizedException` from the application layer.**
  The use-case imports from `@nestjs/common`. Clean Architecture says application orchestrates; the HTTP-specific exception should be thrown by the controller or a thin adapter. → Fix: introduce `InvalidCredentialsError` in domain, map in controller.

- **L14. No `@UseGuards(AuthGuard)` on `AuthController` routes.**
  Register/login/refresh/logout are intentionally public, but the unguarded `refresh` endpoint means anyone with a captured Bearer (still within grace window) can rotate it. → Fix: see C1; refresh should require the existing valid token + recent activity.

- **L15. `tenant-role.guard.ts` returns `true` when no roles are declared.**
  This is correct behavior but silently makes the guard a no-op on routes without `@RequireTenantRoles(...)`. If a developer forgets the decorator, the route is unprotected by RBAC (only by `AuthGuard`). → Fix: emit a warning log when `roles?.length === 0` to make accidental misuse visible.

- **L16. `AuthResponse.expires_in` is a number in seconds, but `AuthTokens.expires_in` matches. No consistency issue today, but `token_type: "Bearer"` and `expires_in` could move into a shared `BearerTokenView`.**
  → Fix: extract `BearerTokenView`.

---

## Coupling Map

Inbound (depends on auth):
- `agent-rules` module
- `buyer-purchase-history` module
- `coupons` module
- `embed` module
- `integrations` module + `tenant-access` module
- `merchant` module
- `negotiation` module
- `onboarding` module
- `__test__/test-seed` (test fixtures)
- `app.module.ts` (root composition)

Outbound (auth depends on):
- `@nestjs/common` (DI, exceptions)
- `@prisma/client` (`PrismaClient` type only — runtime comes from `PRISMA_CLIENT`)
- `shared/persistence/persistence.module.ts` (`PRISMA_CLIENT` symbol)
- `shared/auth/tenant-principal.ts` (`setTenantPrincipal`, `currentTenantPrincipal`, `TenantRole`)
- `shared/config/secret-config.ts` (`requireSecret`)
- `node:crypto` (scrypt, HMAC, timingSafeEqual)
- `node:util` (`promisify`)

Cross-module exports used by consumers:
- `AuthGuard`, `TenantRoleGuard` (presentation layer — leaky abstraction, but pragmatic)
- `JwtService` (sign/verify/expiresIn) — domain service exposed to other modules
- `AuthCookieService` — domain service exposed
- `AUTH_REPOSITORY` — repository port

Coupling smells:
- Presentation-layer guards (`AuthGuard`, `TenantRoleGuard`) exported and reused by every module. Acceptable as the auth boundary, but it means every consumer transitively depends on `presentation/`.
- `JwtService` is a domain service with stateful config (`secret`, `ttlSeconds`) consumed outside the module — its constructor reads env at instantiation. Any other module that imports `AuthModule` triggers an env read.
- `auth-cookie.service.ts` imports `AuthResponse` from `application/` (see M6).

---

## Proposed Changes

Ordered by impact. Each refactor is small and reversible.

1. **Introduce token revocation list (`jti` + `tokenVersion`).** Closes C1, fixes L14, gives `/logout` real effect. [HIGH]
2. **Move rate-limit logic from controller into `LoginWithRateLimitUseCase`.** Closes H1, H4. [HIGH]
3. **Create `RefreshTokenUseCase` and centralize `AuthResponse` construction in `application/auth-response.ts`.** Closes H2, M13. [HIGH]
4. **Replace `currentUser` with `currentTenantPrincipal` everywhere; deprecate `request.user`.** Closes H3. [HIGH]
5. **Add input validation (`assertValidEmail`, `assertStrongPassword`) to `RegisterMerchantUseCase`.** Closes H5. [HIGH]
6. **Drop `merchant_id` from `RegisterMerchantRequest`; introduce `MerchantIdGenerator` port.** Closes H6, M11. [HIGH]
7. **Add Prisma error-code-based mapping in repository; remove string sniffing in use-case.** Closes M1. [MEDIUM]
8. **Extract `parseAndValidate` + `verifyCore` in `JwtService`.** Closes M2, M3. [MEDIUM]
9. **Restrict `JwtService` secret fallback to dev; add startup assertion that the secret is not the default.** Closes C3. [MEDIUM]
10. **Promote `CookieConfig` to an injected value object with `secure`, `sameSite`, `domain`, `partitioned`.** Closes H7. [MEDIUM]
11. **Move `AuthResponse` to `domain/auth.types.ts`; update `auth-cookie.service.ts` import.** Closes M6, M12. [MEDIUM]
12. **Harden `LoginRateLimiter`:** per-IP throttle, Redis-backed implementation behind a port, `Retry-After` exposure. Closes C4, M8, M10. [HIGH — but the Redis swap is large; ship the per-IP fix first, Redis as follow-up]
13. **Assert `created.users.length === 1` in `PrismaAuthRepository.createMerchantWithOwner`; throw domain error.** Closes C2. [HIGH]
14. **Apply rate limiting to `/auth/register` (separate bucket key).** Closes L6. [LOW]
15. **Preserve original JWT error code in a structured log on auth failure.** Closes M4. [LOW]
16. **Validate role in `JwtService.verify` (`role === "owner" | "admin"`).** Closes L12. [LOW]
17. **Add `algorithm` indirection in `PasswordHasher`; allow rehash-on-verify for migrations.** Closes M7. [LOW]
18. **Standardize casing in `RegisterMerchantRequest` (or document).** Closes L7. [LOW]
19. **Strip `@Injectable()` from `InMemoryAuthRepository`.** Closes L8. [LOW]
20. **Remove `currentUser` helper from `auth.guard.ts`; move to `shared/auth/current-user.ts` and mark deprecated.** Closes L11. [LOW]
21. **Replace Nest exceptions in `LoginUseCase` and `RegisterMerchantUseCase` with domain errors; map in controller.** Closes L13. [LOW]
22. **Log a warning when `TenantRoleGuard` is invoked with no `@RequireTenantRoles`.** Closes L15. [LOW]

---

## SOLID Analysis

- **SRP — partial pass.**
  - Pass: `JwtService`, `PasswordHasher`, `AuthCookieService`, `LoginRateLimiter` each have one job.
  - Fail: `AuthController.loginWithPassword` mixes rate-limit policy with HTTP translation (H1). `RegisterMerchantUseCase` mixes ID generation, validation, persistence orchestration, error mapping, and response shaping (H5, M11, M1). `AuthGuard` mixes token extraction, JWT verification, and principal propagation (H3).

- **OCP — fail.**
  Adding a new auth flow (e.g. SSO, magic link) requires editing `AuthController` (new route), `AuthModule.providers` (new use-case), and possibly `JwtService` (new claim). The response shape (`AuthResponse`) is duplicated in `AuthController.refresh`. No seams to add flows without modifying the controller (H2, M13).

- **LSP — pass.**
  Both `PrismaAuthRepository` and `InMemoryAuthRepository` implement the same `AuthRepository` port with the same return shapes. `PrismaAuthRepository.createMerchantWithOwner` returns the same `{ merchant, user }` envelope as `InMemoryAuthRepository`. No behavioral surprises across implementations.

- **ISP — partial pass.**
  `AuthRepository` has three methods — all are used. The `AuthenticatedPrincipal` type is reused consistently. `JwtPayload` exposes more fields than `AuthenticatedPrincipal` (`iat`, `exp`, `sub`, `merchant_id`) but those are internal — fine.
  - Concern: `AuthResponse` carries `access_token`, `expires_in`, `token_type` plus `merchant_id`, `user_id`, `email`. Consumers that only need the token don't need the user info, and vice versa. Splitting `BearerTokenView` from `AuthIdentityView` would help (L16).

- **DIP — partial pass.**
  - Pass: `AuthRepository` is a port; `LoginAttemptScope` is a typed value object; `LoginRateLimiter` is a class, but used as a concrete (no port yet — see H4, M10).
  - Fail: domain services (`JwtService`, `AuthCookieService`, `LoginRateLimiter`) are injected as concrete classes across modules. No port interfaces. Mocking them in tests requires subclassing or DI tricks. The application use-cases depend on concrete `JwtService`/`PasswordHasher` (not ports). → Fix: introduce `TokenSigner`, `TokenVerifier`, `PasswordHasherPort`, `RateLimiterPort` interfaces and have the implementations bind to them.

---

## Object Calisthenics

- **Rule 1 — One level of indentation per method.** Mostly respected. Mild violation in `PrismaAuthRepository.createMerchantWithOwner` (nested `users: { create: { ... } }`). Acceptable for declarative ORM data.

- **Rule 2 — Don't use the `else` keyword.** Pass. No `else` in any production file.

- **Rule 3 — Wrap all primitives and strings.** Fail.
  - `AuthenticatedPrincipal` is an interface, not a value object. `setTenantPrincipal` accepts a plain object literal.
  - `email` is `string` everywhere — no `Email` value object (only `normalizeEmail` as a free function).
  - `merchantId` is `string` everywhere — no `MerchantId` value object.
  - `role: "owner" | "admin"` is a string union, not an enum/role class. The use-case reads `decoded.role as AuthenticatedPrincipal["role"]` — a cast, not a parse.
  - `ExpiresInSeconds` is `number` — no unit branding.
  - **Fix:** introduce `Email`, `MerchantId`, `TenantRole`, `ExpiresInSeconds` value objects. Replace string params in `AuthRepository.findUserByEmail(email: Email)` etc.

- **Rule 4 — First-class collections.** Partial fail.
  - `LoginRateLimiter.attempts` is a `Map<string, AttemptBucket>` but exposed through five different methods (`assertAllowed`, `recordFailure`, `recordSuccess`, `remaining`, `activeBucket`, `key`). The bucket logic is split between the class and inline arithmetic.
  - `auth-cookie.service.ts` does `cookieHeader.split(";").map(...)` inline — no `CookieJar` class.
  - **Fix:** wrap buckets in `AttemptBuckets` class; wrap cookies in `CookieJar` class.

- **Rule 5 — One dot per line.** Mostly pass. Mild violations:
  - `setTenantPrincipal(request as TenantPrincipalRequest, { ... })` — three dots but acceptable.
  - `process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5` — fine.
  - `created.users[0]!` — acceptable.

- **Rule 6 — Don't abbreviate.** Fail in places:
  - `req`, `res`, `ctx` (Nest-style; acceptable as framework convention).
  - `iat`, `exp`, `sub`, `aud`, `jti` (JWT standard; acceptable).
  - `usr_`, `mrc_` ID prefixes — standard for this project, not module-specific.

- **Rule 7 — Keep entities small.** Pass — no class exceeds ~80 lines.

- **Rule 8 — No classes with more than two instance variables.** Fail.
  - `LoginRateLimiter` has `attempts: Map`, `maxAttempts`, `windowMs` (3 instance vars). The "two variables" rule is the strictest reading; OC admits "a small number". Treat as borderline.
  - `AuthCookieService` has `cookieName`, `secure` (2 vars) — pass.

- **Rule 9 — No getters/setters/properties.** Pass — only `readonly` constructor-injected dependencies.

---

## Summary of Findings by Severity

| Severity | Count | Examples |
|---|---|---|
| CRITICAL | 4 | C1 refresh grace, C2 `!` non-null, C3 dev secret fallback, C4 in-memory rate limiter |
| HIGH | 8 | H1-H8 controller orchestration, no rate-limit in use-case, weak input validation, request.user drift |
| MEDIUM | 13 | M1-M13 string-sniff errors, cookie config, password hash migration, error mapping |
| LOW | 16 | L1-L16 typing nits, casing consistency, missing decorators, role validation |

Total: **41 findings**, including security-relevant issues in C1, C3, C4, H5, M7, M9.

The module is small and well-structured at the directory level. The main risks are around token lifetime/revocation (C1, C3, M9) and the rate limiter's per-process state (C4). Layering is mostly clean — the controller doing application work (H1, H4) is the single biggest structural smell.