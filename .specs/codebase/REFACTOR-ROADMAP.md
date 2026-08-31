# Refactor Roadmap — Atomic Tasks

**Source:** ARCHITECTURE-AUDIT.md (3-scan synthesis)
**Principles enforced:** 10 Monolithic Laws, SOLID, KISS, DRY, Object Calisthenics
**Style mandate:** no inline comments (code self-documents); JSDoc only on public contracts (exported ports, use-case `execute`, controller handlers)
**Constraint:** respect existing ports/adapters (they're correct); do not break tenancy (`merchant_id`); do not touch safety engines (rules/shipping/negotiation)

---

## Sizing

**Scope = LARGE.** Multi-module, multi-component. Requires full task breakdown + dependency ordering.

Tasks are grouped by the 4 problem buckets. Each: `[Pn]` priority, `[P]` = parallel-safe, effort estimate, done-when + gate.

---

## Bucket 1 — Type-Safety (742 `any`) 🔴 HIGHEST ROI

Latent runtime bugs. Attack by layer, highest concentration first.

### T1.1 — Type checkout use-case Prisma injections [P1]
- **What:** Replace `@Inject(PRISMA_CLIENT) prisma?: any` with typed repository ports
- **Where:** `checkout/application/use-cases/start-checkout.use-case.ts:53`, `send-chat-message.use-case.ts:62`
- **Reuses:** existing `checkout/domain/ports/*.port.ts`
- **Done when:** no `any` in checkout use-case constructors; typecheck green
- **Gate:** `cd apps/api && pnpm typecheck && pnpm test -- checkout`
- **Depends on:** none
- **Effort:** M (existing ports; wire methods)

### T1.2 — Type repository raw-query rows [P1] [P]
- **What:** Type `$queryRaw` result rows; remove `rows as any[]`
- **Where:** `revenue-lift/infrastructure/revenue-lift.repository.ts:90`, sweep `repositories` layer (109 `any`)
- **Done when:** repositories layer `any` count → 0 (excluding justified generics)
- **Gate:** `cd apps/api && pnpm typecheck`
- **Depends on:** none
- **Effort:** M

### T1.3 — Type presentation/http layer [P2] [P]
- **What:** Remove 153 http + 129 presentation `any` (DTO typing, request/response)
- **Where:** `modules/*/presentation/http/**`
- **Done when:** http+presentation `any` → near-0
- **Gate:** `cd apps/api && pnpm typecheck`
- **Depends on:** none
- **Effort:** L (spread across modules; parallelizable per module)

---

## Bucket 2 — God Use-Cases (core checkout path) 🔴 HIGH

### T2.1 — Decompose start-checkout.use-case (18 deps, 331L)
- **What:** Extract collaborators; use-case becomes thin coordinator
- **Where:** `checkout/application/use-cases/start-checkout.use-case.ts`
- **Extract into:**
  - `IdentityResolutionService` (identity, consent, buyer-account, addresses)
  - `CrossSellEnrichmentService` (cross-sell, intent-memory)
  - `CheckoutBootstrapService` (sessions, settings, merchant, storefront-cart)
  - keep metrics/outbox as injected ports
- **Done when:** `execute()` ≤ 60L; ≤ 6 constructor deps; each collaborator SRP-clean; no behavior change
- **Gate:** `cd apps/api && pnpm typecheck && pnpm test -- start-checkout` + e2e checkout flow
- **Depends on:** T1.1 (types first)
- **Effort:** L — CORE PATH, high test coverage required

### T2.2 — Decompose send-chat-message.use-case (15 deps, 422L)
- **What:** Split orchestration; respect LLM-never-authorizes invariant
- **Where:** `checkout/application/use-cases/send-chat-message.use-case.ts`
- **Extract into:**
  - `ChatPersistenceService` (message store/retrieve)
  - `RulesDispatchService` (rules-engine gateway — NEVER bypass)
  - `MessageContextBuilder` (profile/context injection)
  - delegate objection-classification to existing conversation-engine
- **Done when:** `execute()` ≤ 60L; ≤ 6 deps; `isSafeGeneratedMessage` still enforced; fallback templates intact
- **Gate:** `cd apps/api && pnpm typecheck && pnpm test -- send-chat` + safety-invariant tests
- **Depends on:** T1.1
- **Effort:** L — SAFETY-CRITICAL

---

## Bucket 3 — Layer Leaks (DIP + domain purity) 🔴 HIGH

### T3.1 — Move cross-sell domain services to infrastructure [P1] [P]
- **What:** Domain must be pure; these are repo-backed adapters
- **Where:**
  - `cross-sell/domain/services/co-occurrence.service.ts` → `infrastructure/`
  - `cross-sell/domain/services/catalog-strategy-recommender.ts` → `infrastructure/`
  - `cross-sell/domain/services/cross-sell-context-resolver.service.ts` → split pure policy vs infra
- **Done when:** no `PrismaClient`/`@nestjs/common` import under `cross-sell/domain/`; define port for query access
- **Gate:** `cd apps/api && pnpm typecheck && pnpm test -- cross-sell`
- **Depends on:** none
- **Effort:** M

### T3.2 — Move billing-plan-guard out of domain [P1] [P]
- **What:** NestJS `CanActivate` guard belongs in presentation/infrastructure
- **Where:** `payment/domain/billing-plan-guard.ts` → `payment/presentation/guards/` or `infrastructure/`
- **Done when:** no NestJS/Prisma import under `payment/domain/`
- **Gate:** `cd apps/api && pnpm typecheck && pnpm test -- payment`
- **Depends on:** none
- **Effort:** S

### T3.3 — Wrap 11 direct infra imports behind ports [P2]
- **What:** Define `domain/ports/*.port.ts` + `@Inject(TOKEN)` for each concrete infra import
- **Where:** (from Phase 2A)
  - Controllers: inventory/erp-oauth, payment/crypto-payment, payment/crypto-quote, revenue-manager, shipping/melhor-envio-oauth, negotiation/m2m, whatsapp/webhook
  - Services: checkout/checkout-customer, inventory/crm-sync, inventory/marketplace-stock-push, payment/payment-dispatch
- **Done when:** each site injects a port, not a concrete class
- **Gate:** `cd apps/api && pnpm typecheck && pnpm build`
- **Depends on:** none (per-site parallelizable)
- **Effort:** L (11 sites; ~30min each)

### T3.4 — Fix knowledge-base → catalog infra cross-module leak [P2]
- **What:** knowledge-base use-cases reach into `catalog/infrastructure/`
- **Where:** `knowledge-base/application/use-cases/*`
- **Done when:** cross-module access via published port/interface only
- **Gate:** `cd apps/api && pnpm typecheck`
- **Depends on:** none
- **Effort:** M

---

## Bucket 4 — Mega Files + Long Methods 🟡 MED

### T4.1 — Split payment-platform.use-cases.ts (14 classes, 655L) [P3] [P]
- **What:** One class per file, grouped by sub-aggregate
- **Where:** `payment/application/payment-platform.use-cases.ts`
- **Split into:** `use-cases/connect/`, `use-cases/billing/`, `use-cases/platform-events/`
- **Done when:** ≤ 1 exported use-case class per file
- **Gate:** `cd apps/api && pnpm typecheck && pnpm test -- payment`
- **Effort:** M (mechanical; update module wiring + imports)

### T4.2 — Split integrations.use-cases.ts (17 classes, 633L) [P3] [P]
- **What:** One class per file, grouped
- **Where:** `integrations/application/integrations.use-cases.ts`
- **Split into:** `use-cases/api-keys/`, `use-cases/webhooks/`, `use-cases/tracking/`
- **Done when:** ≤ 1 exported class per file
- **Gate:** `cd apps/api && pnpm typecheck && pnpm test -- integrations`
- **Effort:** M

### T4.3 — Extract 7 methods >200L into named steps [P3]
- **What:** Object Calisthenics — long method → composed named steps (early-return, no else)
- **Where:**
  - store-langgraph-agent.ts:141 run() (597L)
  - send-store-message.use-case.ts:46 (331L)
  - complete-order.use-case.ts:58 (265L)
  - create-payment-intent.use-case.ts:152 (227L)
  - storefront-conversation.adapter.ts:787 reply() (226L)
  - (start-checkout + send-chat covered by T2.1/T2.2)
- **Done when:** each method ≤ 60L; extracted steps SRP-named
- **Gate:** per-module typecheck + test
- **Effort:** L

### T4.4 — Thin fat controllers [P4] [P]
- **What:** Move `private async` business logic to use-cases
- **Where:** operations.controller.ts (594L), payment-platform.controller.ts (547L), m2m.controller.ts (441L)
- **Done when:** controllers only parse/validate/delegate/respond
- **Gate:** per-module typecheck + test
- **Effort:** M

### T4.5 — Route command-path repo-in-controller through use-cases [P4]
- **What:** 18 controllers inject repos; write paths must use use-cases (read paths OK)
- **Where:** (from Phase 2B) coupons, cross-sell, embed, fulfillment, m2m, mercadopago-oauth, shipping, whatsapp controllers
- **Done when:** no repository write call in a controller
- **Gate:** per-module typecheck + test
- **Effort:** L

---

## Cleanup (Low, opportunistic)

- **C1** — Replace 8 stray `console.*` with NestJS `Logger` [P]
- **C2** — Wrap `S3Client` (`shared/storage/s3-upload.service.ts:30`) behind injectable provider
- **C3** — Move infra-emitted domain events to owning use-case (checkout-payment.adapter.ts:19)
- **C4** — Triage 128 TODO/FIXME/HACK markers

---

## Execution Order (dependency-respecting)

```
Wave 1 (parallel, no deps):    T1.1  T1.2  T3.1  T3.2
Wave 2 (types done):           T2.1  T2.2   (+ T1.3, T3.3 parallel)
Wave 3 (structural):           T3.4  T4.1  T4.2  T4.3
Wave 4 (polish):               T4.4  T4.5  C1-C4
```

## Effort Summary

| Bucket | Tasks | Effort | Priority |
|--------|-------|--------|----------|
| 1. Type-safety | 3 | M+M+L | 🔴 P1 |
| 2. God use-cases | 2 | L+L | 🔴 P1 (core+safety) |
| 3. Layer leaks | 4 | M+S+L+M | 🔴 P1-P2 |
| 4. Mega files | 5 | M+M+L+M+L | 🟡 P3-P4 |
| Cleanup | 4 | S each | 🟢 opportunistic |

## Guardrails (do NOT violate during refactor)

- LLM never authorizes offers — send-chat refactor must preserve `isSafeGeneratedMessage`
- Discounts only via rules-engine; subsidies only via shipping-engine
- `merchant_id` tenancy scoping on every query/command
- Prisma repos are only runtime persistence; in-memory only in specs
- No behavior change — refactors are structure-only; tests must stay green
- Run `pnpm typecheck` before "done"; `pnpm build` before "release-ready"
