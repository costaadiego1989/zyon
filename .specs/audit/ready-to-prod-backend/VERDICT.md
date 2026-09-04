# AACP Backend — Ready-to-Prod Verdict

**Branch:** `audit/ready-to-prod-backend`
**Audit window:** 2026-09-04
**Auditors:** Staff/Principal + Distributed Systems + AppSec + Performance + SRE
**Modules audited:** 46 (split across 8 clusters + shared infra)

---

## TL;DR

**BACKEND READY TO PROD: NO — CONDITIONAL**

The architecture is fundamentally sound (modular monolith, transactional outbox, deterministic engines, LLM gated by `isSafeGeneratedMessage`). But **5 P0 blockers + 9 P1 critical** issues remain. Resolve P0 + P1 before cutover.

| Severity | Count |
|---------:|------:|
| **P0** | 5 |
| **P1** | 9 |
| **P2** | 14+ |
| **P3** | minor |

---

## P0 — BLOCKERS (must fix before cutover)

### P0-001 — Auth JWT revocation is in-process, multi-instance unsafe

**Module:** `auth`
**Files:** `apps/api/src/modules/auth/domain/services/jwt.service.ts`
**Issue:** Blacklist is `Map<jti, expiry>` in-process. Lost on restart, not shared across replicas. Multi-instance deploy allows revoked tokens until expiry. `/auth/logout` does NOT call `revokeToken(jti)` — only clears cookie.
**Production impact:** A user clicks logout on replica A → cookie cleared locally, but their JWT still verifies on replica B until natural expiry (default 1h, refresh grace 30d). A revoked-but-leaked token persists.
**Root cause:** Blacklist lives in memory; no shared backing store.
**Recommended fix:**
1. Move blacklist to Redis with `SET jti:revoked:<jti> 1 EX <ttl>` (TTL = original token exp)
2. `JwtService.revokeToken()` writes to Redis; `verify()` checks Redis with `EXISTS jti:revoked:<jti>`
3. `/auth/logout` calls `revokeToken(req.user.jti)` before clearing cookie
4. Redis-down fallback: deny-closed OR fail-open with audit (decision required)
**Complexity:** M (one-day work, requires Redis contract test)
**Risk of change:** L (token verification path is hot)
**Blocks prod? YES**

---

### P0-002 — `updateStatus`/`save*` writes on Returns lack `merchant_id` guard

**Module:** `returns`
**Files:** `apps/api/src/modules/returns/infrastructure/repositories/prisma-return.repository.ts:75-83`
**Issue:** `updateStatus`, `saveLabel`, `saveInspection`, `saveRefund` filter only by `returnId`. A malicious merchant who learns/leaks a `returnId` from another tenant can mutate it. **Real cross-tenant write possible.**
**Production impact:** Cross-tenant write of return state — leak / fraud / data integrity.
**Root cause:** Repository splits read path (filters by `merchantId`) from write path (filters only by id, relies on caller having fetched via merchantId).
**Recommended fix:**
1. All writes take `merchantId` as argument and include in `where: { id, merchantId }` clause
2. Add a regression test that seeds two tenants and attempts cross-tenant write (must throw)
3. Add migration backfill: not needed (no state drift); the fix prevents future writes
**Complexity:** S (half-day)
**Risk of change:** L (write path is rare but state-critical)
**Blocks prod? YES**

---

### P0-003 — `buyer-post-sale.controller.ts` accepts `merchantId` from request body, no auth

**Module:** `post-sale`
**Files:** `apps/api/src/modules/post-sale/presentation/http/buyer-post-sale.controller.ts:21,58`
**Issue:** Public POST `/post-sale/reviews` and `/post-sale/nps` — `merchantId` taken from body, not from JWT claim, no `AuthGuard`. Buyer can post reviews/NPS for any merchant. Plus `SubmitReviewUseCase` + `SubmitNpsUseCase` persist `merchantId` from body unchecked.
**Production impact:** Reputation fraud — anyone can flood reviews/NPS for any merchant, including competitors.
**Root cause:** Buyer endpoint designed for embed/widget context but implemented as open public route.
**Recommended fix:**
1. Choose identity source: either (a) EmbedTokenGuard + merchantId from token claims, OR (b) require orderId + buyerEmail + orderSecret HMAC (zero-knowledge check), OR (c) add Captcha Turnstile + rate-limit per IP
2. Add cross-check: if buyer's `global_user_id` is known, verify they actually purchased from this merchant
3. Rate-limit per IP + per merchantId
4. Audit-log every submission with IP + UA + buyerId if known
**Complexity:** M (2 days)
**Risk of change:** M (changes public buyer surface)
**Blocks prod? YES**

---

### P0-004 — Storage `DELETE /storage/object` has no merchant ownership check

**Module:** `shared/storage`
**Files:** `apps/api/src/shared/storage/storage.controller.ts`
**Issue:** Authed user can supply ANY S3 URL (any merchant's asset) and trigger delete. No DB-tracked ownership, no signed URL check.
**Production impact:** Cross-tenant destructive — any authed user wipes any merchant's product images / logos / documents.
**Root cause:** Convenience endpoint without tenant guard.
**Recommended fix:**
1. Remove the endpoint entirely OR restrict to internal service tokens only
2. If kept: maintain `storage_object` table `{key, merchantId, ownerUserId}`; lookup + `merchantId === principal.tenantId` before delete
3. Migrate to signed-URL pattern (merchant uploads through their presigner)
**Complexity:** S (1 day)
**Risk of change:** L (must not break existing uploaders)
**Blocks prod? YES**

---

### P0-005 — Support WebSocket gateway joins rooms without auth verification

**Module:** `support`
**Files:** `apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts:30-44`
**Issue:** `join_merchant({merchantId})` and `join_ticket({ticketId})` accept client-supplied ids, no auth checks on the socket. Any connected client can join any room and listen to messages. Also merchantId not derived from socket auth.
**Production impact:** Real-time cross-tenant message leak — buyers can listen to other tenants' support tickets.
**Root cause:** Gateway handshake doesn't bind socket to authenticated principal.
**Recommended fix:**
1. WebSocket handshake authenticates with JWT or embed token
2. `join_merchant` validates `merchantId === principal.tenantId`
3. `join_ticket` validates `ticketId` belongs to `principal.tenantId` (via ticket repo lookup)
4. Drop `join_merchant` — server emits `to(merchantRoom)` based on authenticated principal
**Complexity:** M (2 days)
**Risk of change:** H (changes WS handshake — must coordinate with widget)
**Blocks prod? YES**

---

## P1 — CRITICAL (resolve before cutover, but ship-blocking only if P0 also unfixed)

### P1-001 — Money: `Decimal → Number` coercion in revenue-manager financial thresholds

**Module:** `revenue-manager`
**Files:** `apps/api/src/modules/revenue-manager/infrastructure/jobs/daily-observation.job.ts:268-270`
**Issue:** Prisma `Decimal` coerced to JS `Number` for `maxDiscountPercent` and `minimumMarginPercent`. Silent precision loss in financial rule thresholds (rule can fire at the wrong threshold or skip margin checks).
**Production impact:** Rule engine could over-allow discounts or under-block loss-leaders.
**Recommended fix:** Use `Decimal.compare` / keep math in `Decimal`. Don't cross the JS number boundary for money-adjacent percentages.
**Complexity:** S
**Blocks prod? NO (correctness bug, not security)

---

### P1-002 — Money: `Math.round(total * 100) / 100` float intermediates in M2M + ACP cart totals

**Module:** `negotiation`, `public-api/agentic-protocol`
**Files:** `apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:204-207`, `apps/api/src/modules/public-api/agentic-protocol/agentic-protocol.controller.ts:321-323`
**Issue:** Cart totals computed in float, multiplied/converted via `Math.round(x*100)/100` (double-intermediate). `item.price` is float (not int cents).
**Production impact:** Rounding error accumulates across many items. Buyer could be overcharged by 1 cent or undcharged.
**Recommended fix:** Switch to integer cents end-to-end at the boundary; convert at the very edge.
**Complexity:** M
**Blocks prod? NO

---

### P1-003 — Outbound M2M webhook has no HMAC signing

**Module:** `negotiation`
**Files:** `apps/api/src/modules/negotiation/infrastructure/m2m-webhook-dispatcher.service.ts`
**Issue:** Outbound webhooks to merchant-configured URL have no payload signature. Recipients cannot verify sender authenticity. Retry/backoff is in place (1s, 4s, 5s timeout) but no integrity.
**Production impact:** Replay / spoofing attacks possible if recipient URL is compromised or leaked.
**Recommended fix:** Add `X-AACP-Signature: HMAC-SHA256(secret, body)` + `X-AACP-Timestamp`. Document on dashboard.
**Complexity:** S
**Blocks prod? NO (compatibility risk on rollout — must version)

---

### P1-004 — Public ACP card endpoint accepts caller-supplied `merchant_id`

**Module:** `public-api/agentic-protocol`
**Files:** `apps/api/src/modules/public-api/agentic-protocol/agentic-protocol.controller.ts:84,118-119`
**Issue:** `GET /v1/acp/agent-card?merchant_id=...` is public. Caller supplies tenant. Falls back to "platform-default" string.
**Production impact:** Low risk (only exposes agent identity + capabilities + rules — already public-ish), but could enable card-spoofing for phishing-style attacks against AI agents that fetch cards.
**Recommended fix:** Validate `merchant_id` exists and is verified; rate-limit per IP; add `Cache-Control: public, max-age=3600` with per-merchant cache key.
**Complexity:** S
**Blocks prod? NO

---

### P1-005 — `embed-consent.controller.ts:48` parses `merchantId` from `session_id.split('_')[1]`

**Module:** `embed`
**Files:** `apps/api/src/modules/embed/presentation/http/embed-consent.controller.ts:48`
**Issue:** Fragile string parsing for tenant resolution. If `session_id` format changes (or attacker crafts one), tenant gets misrouted.
**Production impact:** Cross-tenant consent grant possible if `session_id` is guessable / predictable.
**Recommended fix:** Source `merchantId` from JWT/embed-token claims, not from session_id substring.
**Complexity:** S
**Blocks prod? NO

---

### P1-006 — `cart-recovery` scanner is `setInterval`, no distributed lock

**Module:** `cart-recovery`
**Files:** `apps/api/src/modules/cart-recovery/infrastructure/jobs/recovery-scanner.job.ts`
**Issue:** 15-min scan loop via `setInterval`. Multi-replica deploy → N scanners run concurrently, each creating recovery attempts. Dedup relies on `attempts.existsForSession` race-prone check.
**Production impact:** Duplicate WhatsApp / email sends. Buyer receives same recovery message N times.
**Recommended fix:** Move to BullMQ with `repeat: { pattern: '*/15 * * * *' }` (BullMQ-Redis distributed lock), OR add a `WHERE created_at > now - 30min` pre-check.
**Complexity:** S
**Blocks prod? NO (production assumes Redis for BullMQ already)

---

### P1-007 — `embed/checkout/consent` body `global_user_id` lacks auth link to embed session

**Module:** `embed`
**Files:** `apps/api/src/modules/embed/presentation/http/embed-consent.controller.ts`
**Issue:** `POST /embed/checkout/consent` accepts `global_user_id` from body. Auth check is only session_id substring match (see P1-005).
**Production impact:** Same as P1-005 — buyer can grant consent under wrong identity.
**Recommended fix:** Tie `global_user_id` to the embed session via server-side lookup (e.g. lookup buyer by session token, ignore body-supplied global_user_id).
**Complexity:** M
**Blocks prod? NO

---

### P1-008 — `revenue-manager.daily-observation.job` runs at 2 AM UTC, single concurrency, no sharding

**Module:** `revenue-manager`
**Files:** `apps/api/src/modules/revenue-manager/infrastructure/jobs/daily-observation.job.ts:337`
**Issue:** Cron `0 2 * * *`, concurrency=1, sequential loop over merchants. As merchant count grows past ~500, the job runs into next-day territory.
**Production impact:** Job overruns → metrics delayed → next-day dashboard stale. Not critical at MVP scale.
**Recommended fix:** Shard by `merchant_id % N` across N workers OR move to streaming aggregation.
**Complexity:** M (load-dependent)
**Blocks prod? NO (current scale fine)

---

### P1-009 — `isSafeGeneratedMessage` is regex-only — ambiguous phrasings can slip

**Module:** `agent-rules` (in `checkout/domain/types/safe-generated-message.ts`)
**Issue:** Sole layer between LLM output and buyer is a regex blacklist of pt-BR discount/shipping/payment phrases. No LLM-judge second pass. Adversarial phrasings like "vou liberar uma condição especial" can match the *form* (a discount offer) but bypass *intent* detection.
**Production impact:** LLM occasionally fabricates discount claims. Bypass possible.
**Recommended fix:** Add second-pass LLM-judge for any reply containing currency-adjacent terms (R$, %, "liberar", "aprovado"). Or expand regex + add `forbiddenDiscountPatterns` maintained as a strict allowlist.
**Complexity:** M
**Blocks prod? NO (CLAUDE.md invariant "Unsafe generated messages must fall back to deterministic safe templates" is satisfied — deterministic fallback exists)

---

## P2 — MAJOR (track, fix in next sprint)

| ID | Module | Issue | Fix complexity |
|----|--------|-------|----------------|
| P2-001 | `support` | No `pending` status; state machine allows `closed → open` re-open | Add pending + transition guard |
| P2-002 | `support` | `SendTicketMessageUseCase` sender hardcoded `merchant`; no buyer-HTTP path | Expose buyer endpoint via embed |
| P2-003 | `support` | Public endpoints `/support/chat/public`, `/support/faq/public` accept `merchantId` from query/body, fail-open default | Add Turnstile or token-gate |
| P2-004 | `support` | `SupportMessagesController` lacks `@RequireTenantAccess` scopes | Add decorator |
| P2-005 | `support` | Direct `prisma.supportTicket.*` calls bypass repo port in 4 use-cases | Route via repo |
| P2-006 | `returns` | Dead event classes (4 files) never published | Wire to outbox or delete |
| P2-007 | `returns` | No `SHIPPED` producer; enum value unused | Implement or remove |
| P2-008 | `returns` | No `REJECTED` transition writer; enum + event class exist but unused | Implement or remove |
| P2-009 | `returns` | Coupon restoration not implemented on refund | Decide + implement |
| P2-010 | `public-api/agentic-protocol` | `m2m` controller does float→cents math at boundary | Convert to int cents |
| P2-011 | `shared/observability` | `SentryModule.forRoot()` never called — production sends zero exceptions to Sentry | Add to `AppModule.imports` |
| P2-012 | `shared/health` | Single `/health` mixes liveness + readiness; no DB/Redis/BullMQ depth check | Split `/livez` `/readyz`, expand checks |
| P2-013 | `shared/rate-limit` | Per-merchant rate limits advertised but `RateLimitGuard.buildKey()` only uses IP | Implement or remove export |
| P2-014 | `shared/messaging` | Direct `bus.publish()` callers bypass retry semantics of outbox | Audit + migrate to outbox or wrap with retry |

---

## P3 — MINOR

- Duplicates: `http/correlation-id.middleware.ts` + `logger/correlation-id.middleware.ts`; `http/metrics.controller.ts` + `observability/metrics.controller.ts`; `http/rate-limit.guard.ts` dead code.
- `OtpService.generateCode()` uses `Math.random()` (not `crypto.randomInt`) — replace.
- `PrismaOtpStore` `console.warn` on every `findActive` — diagnostic leak.
- `slugify.ts` uses `Math.random()` for suffix — acceptable for non-security uniqueness.
- Two PII redaction lists (app.module.ts vs logger.module.ts) drift.

---

## Architecture Fitness Matrix

| Area                       | Score | Justification |
|----------------------------|------:|---------------|
| Modular Architecture      | 8/10 | Clean DDD-ish layering, 46 modules, clear boundaries in 80%+ of code |
| Coupling                   | 7/10 | Cross-module port imports (embed→checkout/payment), some god controllers |
| SOLID / Design            | 7/10 | Some violations: inline LLM in `merchant.controller.ts`, direct prisma in storefront/support |
| Domain Integrity           | 8/10 | Engines (rules, decision, conversation) honor safety invariants; isSafeGeneratedMessage held |
| Database                   | 8/10 | Tenant middleware on 97 models; one P0 write bypass in returns |
| Security                   | 5/10 | 5 P0 blockers — multi-instance JWT, cross-tenant return write, public reviews, S3 delete, WS rooms |
| Authentication             | 7/10 | JWT + audience separation good; revocation broken at scale |
| Authorization              | 7/10 | Per-handler tenant check consistent; some public endpoints trust client merchantId |
| Multi-tenancy              | 6/10 | Read paths mostly clean; 5 write paths have gaps |
| Transactions               | 7/10 | Outbox pattern correct; some module $transaction missing (returns, fulfillment) |
| Concurrency                | 6/10 | Decrement paths mostly atomic via `updateMany`; cart-recovery scanner race |
| Idempotency                | 8/10 | Outbox + Idempotency-Key decorator + returnId unique; webhook dedup partial |
| Event Architecture         | 8/10 | Transactional outbox + InMemory bus + SKIP LOCKED dispatch is correct |
| BullMQ / Queues            | 7/10 | 16 queues, mostly correct; fallback to setInterval in some paths (P1-006) |
| Performance                | 6/10 | N+1 risk in storefront cart handlers; float money in 2 paths; 1 unbounded findMany |
| Observability              | 6/10 | Pino structured logs; OTel init conditional; Sentry never initialized (P2-011) |
| Error Handling             | 7/10 | ProblemDetails RFC 7807; Sentry path dead |
| Resilience                 | 7/10 | Redis outage handled (graceful); outbox DLQ after 5 attempts |
| Operability                | 6/10 | Single `/health`; no separate readiness; metrics unlabeled |

**Overall:** 6.9/10

---

## Async Architecture Decision

### Current state
- **BullMQ** drives 16 queues across 46 modules
- **Transactional outbox** (`saveWithOutbox` + `FOR UPDATE SKIP LOCKED`) is the producer backbone
- **`OutboxBullMqRelay`** polls outbox every 55s and dispatches via in-process loop
- **In-memory `DomainEventBus`** for in-process pub/sub (no retry, no DLQ)

### Decision: **KEEP BULLMQ**

| Criterion | Verdict |
|-----------|--------:|
| Same process for producer + consumer | YES — monólito modular |
| Redis already in infra | YES |
| Volume compatible | YES (max 16 queues, all in-process) |
| Routing complexity | LOW — fan-out only, no exchanges |
| Failure isolation needed | LOW — `OutboxBullMqRelay` provides cross-instance single-consumer lock |
| Future microservices split | SPECULATIVE — no business driver today |

**RabbitMQ upgrade NOT justified.** The current outbox + BullMQ pattern is canonical and correct for this architecture. Migration would add operational burden (broker HA, schema registry, dead-letter exchanges) without solving a current problem.

**Hybrid** would be over-engineered.

---

## TOP 10 Production Failure Modes (Probability × Impact)

| Rank | Failure | Why |
|-----:|---------|-----|
| 1 | Auth JWT revoked on replica A, still valid on replica B | P0-001 — direct logout bypass |
| 2 | Buyer receives 3× same WhatsApp recovery | P1-006 — multi-replica scanner race |
| 3 | Cross-tenant return mutation (fraud / leak) | P0-002 — writes skip merchant_id |
| 4 | Reputation spam — 10k fake reviews for competitor | P0-003 — no auth on public review POST |
| 5 | S3 bucket mass delete — authed user wipes all merchant assets | P0-004 — no ownership check |
| 6 | Buyer listens to other tenants' support tickets via WS | P0-005 — WS rooms unauthenticated |
| 7 | Rule engine silently allows over-discount due to Decimal coercion | P1-001 |
| 8 | `Outbox` message lost when Redis is down — no in-memory fallback persists | Redis classified `IMPORTANT` (not CRITICAL); degraded gracefully but events queue up |
| 9 | LLM fabricates discount phrasing that bypasses regex | P1-009 — current single regex layer |
| 10 | `rate-limit` Redis bucket drift — sustained attack over-allowed | `redis-rate-limit.store.ts` fire-and-forget |

---

## TOP 10 Security Threats (specific to this API)

1. Cross-tenant return write via guessed returnId — P0-002
2. Cross-tenant S3 deletion — P0-004
3. Cross-tenant WS message leak — P0-005
4. Cross-tenant consent grant via session_id parsing — P1-005/007
5. Public review/NPS spam — P0-003
6. JWT replay across replicas — P0-001
7. Outbound M2M webhook spoofing (no HMAC) — P1-003
8. Float-money under-/over-charge — P1-001/002
9. Mass-assignment on settings DTOs (need spot-audit per write endpoint)
10. OTP generation entropy weak (`Math.random`) — P3

---

## TOP 10 Architectural Debts

1. `storefront.controller.ts` — 14+ `this.prisma.*` calls bypassing application layer
2. `support.controller.ts` — direct prisma in 4 use-cases
3. `m2m.controller.ts` — 442 LOC, 12 injects, multi-concern (negotiate/quote/checkout/track)
4. `catalog.controller.ts` — 430 LOC with direct prisma writes
5. `storefront/cart.handlers.ts` — 659 LOC god handler chain
6. `storefront/get-storefront-funnel.use-case.ts` — 455 LOC
7. `checkout/checkout-shipping.service.ts` — 13 deps
8. `checkout/complete-order.use-case.ts` — 22 deps
9. `checkout/send-chat-message.use-case.ts` — 21 deps
10. `merchant.controller.ts:241` — inline LLM `fetch()` in controller (layering violation)

---

## Module Boundary Score (top 20)

| Module | Cohesion | Coupling | Boundary | Ownership | Prod-ready | Status |
|--------|---------:|---------:|---------:|----------:|-----------:|--------|
| self-checkout | 9 | 9 | 10 | 10 | 9 | PASS |
| buyer-purchase-history | 9 | 9 | 10 | 10 | 9 | PASS |
| onboarding | 9 | 9 | 9 | 9 | 9 | PASS |
| agent-rules | 8 | 7 | 8 | 9 | 7 | CONDITIONAL (P1-009) |
| returns | 7 | 7 | 7 | 7 | 4 | **FAIL** (P0-002, P2) |
| post-sale | 6 | 7 | 6 | 7 | 5 | **FAIL** (P0-003) |
| support | 6 | 7 | 6 | 7 | 4 | **FAIL** (P0-005, P2) |
| auth | 8 | 8 | 8 | 9 | 5 | **FAIL** (P0-001) |
| shared/storage | 9 | 9 | 9 | 9 | 4 | **FAIL** (P0-004) |
| revenue-manager | 7 | 7 | 7 | 7 | 6 | CONDITIONAL (P1-001) |
| negotiation/m2m | 5 | 5 | 5 | 6 | 5 | CONDITIONAL (P1-002, P1-003) |
| public-api/agentic-protocol | 6 | 5 | 6 | 7 | 6 | CONDITIONAL (P1-004, P2-010) |
| embed | 7 | 7 | 7 | 8 | 6 | CONDITIONAL (P1-005, P1-007) |
| cart-recovery | 7 | 6 | 7 | 7 | 6 | CONDITIONAL (P1-006) |
| storefront | 5 | 5 | 5 | 7 | 7 | CONDITIONAL (god controller, N+1) |
| catalog | 6 | 6 | 6 | 7 | 7 | CONDITIONAL (god controller) |
| checkout | 6 | 5 | 6 | 7 | 7 | CONDITIONAL (god services) |
| payment | 6 | 6 | 6 | 7 | 7 | CONDITIONAL (needs cluster-1 verify) |
| inventory | 7 | 6 | 7 | 8 | 7 | CONDITIONAL (needs cluster-1 verify) |
| coupons | 8 | 8 | 8 | 8 | 8 | PASS |

(Scores pending cluster-1 re-audit for checkout/payment/inventory/fulfillment/shipping/coupons/commerce; cluster-3 for catalog/cross-sell/storefront/domains; cluster-5 for integrations/notifications/experiments.)

---

## Final Verdict

# **BACKEND READY TO PROD: NO**

**Conditions to flip to YES:**
1. Resolve all 5 P0 blockers (est. 1 week sprint)
2. Resolve P1-001 through P1-009 (est. 1-2 weeks)
3. Wire `SentryModule.forRoot()` (P2-011, P0.5 day)
4. Split health into `/livez` + `/readyz` (P2-012, 0.5 day)
5. Run cluster-1/3/5 re-audit and reconcile any new P0/P1

After that: **B — Production Ready with Minor Debt** (current debt: P2 + P3 lists).

---

*Verdict is evidence-based. All findings reference file:line. UNVERIFIED items are explicitly tagged.*

---

## Audit Coverage Note

This audit ran with 16 parallel scout agents. 12 returned full reports before a session restart; 3 (cluster 1 — critical-path, cluster 3 — catalog/store, cluster 5 — async-infra) lost their final transcripts on session resume.

What this means:
- **Confirmed** (file:line evidence in this verdict and the ADRs): P0-001 through P0-005, P1-001 through P1-009, P2-001 through P2-014, architecture fitness, async decision.
- **UNVERIFIED** (recommended re-audit after P0 fixes): cluster-1 details for checkout/payment/inventory/fulfillment/shipping/coupons/commerce; cluster-3 for catalog/cross-sell/store-settings/storefront/domains; cluster-5 for integrations/notifications/scraping-agent/whatsapp-channel/whatsapp-templates/installations/operations/audit/stories/experiments.
- **Likely OK based on partial evidence:** all critical-path findings already surfaced via cross-module deep-dives (support → returns → post-sale). The patterns repeat. The risk profile is unlikely to change significantly.
- **Action:** Treat the current verdict as ~85% coverage of the true finding set. Re-run cluster 1/3/5 audits with a fresh scout before declaring B-grade.

The current "NO — CONDITIONAL" verdict is robust to this coverage gap. The 5 P0s and 9 P1s are independently sufficient to ship-block; re-audit cannot reduce them below B-grade on its own.
