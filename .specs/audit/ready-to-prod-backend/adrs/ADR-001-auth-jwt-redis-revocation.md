# ADR-001 — Move JWT revocation to Redis

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `auth`
**Issue:** P0-001
**Date:** 2026-09-04

---

## Context

`apps/api/src/modules/auth/domain/services/jwt.service.ts` maintains an in-process `Map<jti, expiry>` for revoked tokens. This breaks in two ways:

1. **Multi-instance deploy:** blacklist is per-replica. A JWT revoked on replica A still verifies on replica B until natural expiry.
2. **Logout bypass:** `AuthController.logout` (line 255) clears the cookie but does NOT call `revokeToken(jti)` — the token remains valid for the full TTL on every replica.

The codebase already uses Redis (BullMQ, sessions, OTP store, rate-limit). Adding a revocation list costs nothing operationally.

---

## Decision

Move the JWT revocation list to Redis. On every `verify()`, check `EXISTS jti:revoked:<jti>`. On `revokeToken()`, write `SET jti:revoked:<jti> 1 EX <ttl-remaining>`.

`/auth/logout` MUST call `revokeToken(jti)` before clearing the cookie.

Redis-down fallback: **fail-closed** (deny verification). Reasoning: a revoked-but-leaked token during a Redis outage is worse than a brief auth outage. Log + alert.

---

## Implementation Steps

### 1. New service — `RedisJwtRevocationStore`

**File:** `apps/api/src/modules/auth/infrastructure/redis-jwt-revocation.store.ts` (new)

```typescript
export const JWT_REVOCATION_STORE = Symbol('JWT_REVOCATION_STORE');

export interface JwtRevocationStore {
  revoke(jti: string, ttlSeconds: number): Promise<void>;
  isRevoked(jti: string): Promise<boolean>;
}

@Injectable()
export class RedisJwtRevocationStore implements JwtRevocationStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async revoke(jti: string, ttlSeconds: number) {
    await this.redis.set(`jti:revoked:${jti}`, '1', 'EX', ttlSeconds);
  }

  async isRevoked(jti: string): Promise<boolean> {
    return (await this.redis.exists(`jti:revoked:${jti}`)) === 1;
  }
}
```

### 2. Refactor `JwtService`

**File:** `apps/api/src/modules/auth/domain/services/jwt.service.ts`

- Inject `JWT_REVOCATION_STORE`
- Replace in-memory `Map` with `revocationStore.isRevoked(jti)` in `verify()`
- Remove cleanup interval (no longer needed; Redis TTL handles expiry)
- Keep in-memory map ONLY for tests (mock)

### 3. Wire `logout` to revoke

**File:** `apps/api/src/modules/auth/application/refresh-token.use-case.ts` and `logout` controller

```typescript
// In logout handler (auth.controller.ts:255)
await this.jwtService.revokeToken(req.user.jti, req.user.exp - now);
await this.authCookieService.clearCookie(res);
```

### 4. Redis-down contract

In `JwtService.verify()`:

```typescript
try {
  const revoked = await this.revocationStore.isRevoked(jti);
  if (revoked) throw new UnauthorizedException('jwt_token_revoked');
} catch (err) {
  if (err instanceof UnauthorizedException) throw err;
  // Redis down: fail-closed
  this.logger.error({ err, jti }, 'jwt_revocation_store_unavailable');
  throw new UnauthorizedException('jwt_revocation_check_unavailable');
}
```

### 5. Update `auth.module.ts`

Bind `JWT_REVOCATION_STORE` → `RedisJwtRevocationStore`; inject `REDIS_CLIENT` from `shared/cache/redis.module.ts`.

---

## Verification

```bash
# 1. unit — JwtService.verify honors revoked jti
pnpm --filter @zyon/api test auth -- --testPathPattern jwt

# 2. int-spec — multi-instance simulation
# (spawn two processes, revoke on A, attempt verify on B)
pnpm --filter @zyon/api test:prisma auth-jwt-revocation

# 3. manual — logout revokes
# Login → copy token → logout → attempt request with same token → 401
```

---

## Files Touched

- `apps/api/src/modules/auth/domain/services/jwt.service.ts` (refactor)
- `apps/api/src/modules/auth/infrastructure/redis-jwt-revocation.store.ts` (new)
- `apps/api/src/modules/auth/auth.module.ts` (wire)
- `apps/api/src/modules/auth/presentation/auth.controller.ts:255` (logout)
- `apps/api/src/modules/auth/application/refresh-token.use-case.ts` (revoke on refresh)
- Tests: `auth/__tests__/jwt-redis-revocation.spec.ts` (new)
