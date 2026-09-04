# AACP Ready-to-Prod — Implementation Tasks

> **Authority:** Each ADR contains its own implementation steps. This file is the **sprint index** — pick the right ADR, copy its steps into a PR.

## Sprint 1 — P0 Blockers (5 days to 1 week)

Each P0 is ship-blocking. Resolve in order of dependency.

### Day 1-2: ADR-001 — JWT Revocation to Redis
- [ ] Create `apps/api/src/modules/auth/infrastructure/redis-jwt-revocation.store.ts`
- [ ] Refactor `auth/domain/services/jwt.service.ts` to use injected store
- [ ] Wire `JWT_REVOCATION_STORE` in `auth.module.ts`
- [ ] Update `auth.controller.ts:255` (`logout`) to call `revokeToken(jti)`
- [ ] Update `refresh-token.use-case.ts` to revoke on rotation
- [ ] Verify Redis-down contract (fail-closed)
- [ ] Unit + int-spec tests
- [ ] Verify: `pnpm typecheck && pnpm test auth && pnpm test:prisma auth-jwt-redis-revocation`

### Day 2-3: ADR-002 — Returns tenant write guard
- [ ] Update `domain/ports/return-repository.port.ts` signatures
- [ ] Update `infrastructure/repositories/prisma-return.repository.ts` write methods
- [ ] Update all 7 call sites in `application/use-cases/*.ts`
- [ ] Add cross-tenant regression test
- [ ] Verify: `pnpm typecheck && pnpm test returns`

### Day 3-4: ADR-003 — Post-sale buyer auth
- [ ] Add `EmbedAuthGuard` to `buyer-post-sale.controller.ts`
- [ ] Update use-cases to take server-resolved `merchantId`
- [ ] Implement order-HMAC fallback for email-CTA path
- [ ] Add rate-limit + audit log
- [ ] Update widget to forward embed token
- [ ] Verify: `pnpm test post-sale && cd apps/widget && pnpm e2e -- --grep post-sale`

### Day 4-5: ADR-004 — Storage ownership
- [ ] Add `StorageObject` Prisma model + migration
- [ ] Track uploads in `s3-upload.service.ts`
- [ ] Guard `DELETE /storage/object` in controller
- [ ] Add cross-tenant regression
- [ ] Verify: `pnpm prisma:migrate:dev && pnpm test storage`

### Day 5-6: ADR-005 — Support WebSocket auth
- [ ] Add handshake auth in `support.gateway.ts`
- [ ] Drop `join_merchant`/`join_ticket` (server-derived rooms)
- [ ] Update widget WS client (pass JWT/embed token)
- [ ] Verify: `pnpm e2e -- --grep support-ws`

---

## Sprint 2 — P1 Critical (1-2 weeks)

Money precision, webhook signing, embed claims, queue reliability.

### Day 7-8: ADR-006 — Revenue-manager Decimal coercion
- [ ] Replace `.toNumber()` with `Decimal` math
- [ ] Use `Decimal.compare` for thresholds
- [ ] Edge-value test fixtures (33.333 %)

### Day 8-9: ADR-007 — Integer cents in M2M + ACP
- [ ] Update DTOs (priceCents int)
- [ ] Replace Math.round chains
- [ ] Update widget ACP payload

### Day 9-10: ADR-008 — Outbound M2M webhook HMAC
- [ ] Generate per-merchant secret on register
- [ ] Sign with HMAC-SHA256
- [ ] Document on dashboard
- [ ] Optional enable flag for backward compat

### Day 10-11: ADR-009 — Embed tenant from claims
- [ ] Replace substring parsing in `embed-consent.controller.ts`
- [ ] Tie `global_user_id` to server-resolved buyer

### Day 11-12: ADR-010 — Cart-recovery BullMQ
- [ ] Add BullMQ queue + worker
- [ ] Replace `setInterval` loop
- [ ] Distributed lock via Redis

### Day 12-13: ADR-011 — Revenue-manager sharding
- [ ] Shard by `merchantId % N`
- [ ] BullMQ concurrency N

### Day 13-14: ADR-012 — LLM safety second pass
- [ ] New `LlmSafetyJudge` service
- [ ] Gate behind currency-adjacent terms heuristic
- [ ] Wire into `openai-conversation.adapter.ts`
- [ ] Eval fixtures for adversarial phrasings

---

## Sprint 3 — P2 Major (ongoing)

Tracked as backlog. Each is a half-day to 2-day ticket.

- [ ] `support` — pending status + state machine guard (P2-001)
- [ ] `support` — buyer-HTTP message endpoint (P2-002)
- [ ] `support` — public endpoints token-gate (P2-003)
- [ ] `support` — `RequireTenantAccess` on `SupportMessagesController` (P2-004)
- [ ] `support` — route writes through repo port (P2-005)
- [ ] `returns` — wire or delete dead event classes (P2-006)
- [ ] `returns` — implement or remove `SHIPPED` (P2-007)
- [ ] `returns` — implement or remove `REJECTED` (P2-008)
- [ ] `returns` — coupon restoration on refund (P2-009) — requires product decision
- [ ] `shared/observability` — `SentryModule.forRoot()` (P2-011)
- [ ] `shared/health` — split `/livez` + `/readyz` (P2-012)
- [ ] `shared/rate-limit` — implement per-merchant rate limit (P2-013)
- [ ] `shared/messaging` — audit `bus.publish()` callers (P2-014)

---

## Sprint 4 — P3 Minor

- [ ] Delete dead duplicate files (correlation-id middleware, metrics.controller, dead rate-limit guard)
- [ ] Replace `Math.random()` in `OtpService.generateCode()` with `crypto.randomInt`
- [ ] Stop `console.warn` in `PrismaOtpStore.findActive`
- [ ] Consolidate PII redaction lists (app.module vs logger.module)
- [ ] Remove `Math.random()` from `slugify.ts` suffix generation

---

## Verification Matrix

| Sprint | Gate | Command |
|--------|------|---------|
| S1 end | All P0s fixed | `pnpm typecheck && pnpm test && pnpm test:prisma` |
| S2 end | All P1s fixed | + Manual smoke test of checkout, payment, support |
| S3 end | All P2s fixed | + Load test 1k RPS for 10 min |
| S4 end | All P3s fixed | + `pnpm audit` (npm audit) green |

---

## Cross-Cutting Tasks

Run these in parallel with sprint work:

- [ ] Add `ctx:opentelemetry:enable` toggle to wire OTel when Redis/OTLP env configured
- [ ] Set up Sentry project + set `SENTRY_DSN`
- [ ] Add `/livez` `/readyz` to K8s readiness probe
- [ ] Configure `TRUST_PROXY_HOPS` per environment
- [ ] Re-run cluster-1/3/5 audits after P0 fixes land
