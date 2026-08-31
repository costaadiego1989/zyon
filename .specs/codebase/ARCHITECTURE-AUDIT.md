# Architecture Audit — God Modules + Coupling Analysis

**Scope:** API codebase (apps/api/src/modules). 464 source files scanned.  
**Date:** 2026-08-29  
**Status:** In progress (3 parallel scans running)

## Phase 1: God-Module Scan — COMPLETE ✓

### High-Risk God-Modules (51% of files flagged)

| File | LOC | Methods | CC | Risk | Primary Issue |
|------|-----|---------|----|----|---|
| checkout.repository | 727 | 48 | 52 | 🔴 HIGH | Monolithic repo; all CRUD ops in one class |
| send-chat-message.use-case | 573 | 42 | 44 | 🔴 HIGH | Orchestrator; chat + rules + LLM + transform |
| operations.controller | 571 | 16 | 28 | 🔴 HIGH | REST endpoint; list/detail/order/transform all mixed |
| payment-platform.controller | 524 | 14 | 31 | 🔴 HIGH | Webhooks + intents + transactions combined |
| prisma-operations-read.repository | 461 | 19 | 22 | 🟡 MED | Read-only god-repo; filters merged in methods |

### SOLID Violations Inventory

| Principle | Violations | Primary Pattern |
|-----------|-----------|-----------------|
| SRP (Single Responsibility) | 229 (48.4%) | Classes do 5–57 things each |
| OCP (Open/Closed) | 157 (33.2%) | High cyclomatic; switches/nested ifs prevent extension |
| DIP (Dependency Inversion) | 190 (40.1%) | Controllers inject Prisma repos directly |

---

## Phase 2: Coupling Analysis — COMPLETE ✓

**Key correction:** Architecture healthier than raw scan suggested. Ports/adapters in place, zero circular deps, shallow DI. Issues are narrow and targeted.

### 2A. Direct infrastructure imports (DIP violation) — 🔴 HIGH (11 sites)

Concrete infra imported by static path instead of injected behind port.

**Controllers (7):**
| File | Line | Concrete Import |
|------|------|-----------------|
| inventory/erp-oauth.controller.ts | 7-8 | erp-secret-cipher, marketplace-adapter.factory |
| payment/crypto-payment.controller.ts | 7 | bullmq-crypto-verify.queue |
| payment/crypto-quote.controller.ts | 2 | crypto-quote.service |
| revenue-manager/revenue-manager.controller.ts | 28 | daily-observation.job |
| shipping/melhor-envio-oauth.controller.ts | 7 | commerce-secret-cipher |
| negotiation/m2m.controller.ts | 34 | m2m-webhook-dispatcher.service |
| whatsapp-channel/whatsapp-webhook.controller.ts | 26-27 | twilio-webhook-parser, twilio-deduplicator |

**Application services (4):**
| File | Line | Concrete Import |
|------|------|-----------------|
| checkout/checkout-customer.service.ts | 4 | brevo-buyer-email.notifier |
| inventory/crm-sync.service.ts | 5-6 | crm-adapter.factory, crm-secret-cipher |
| inventory/marketplace-stock-push.service.ts | 7-8 | marketplace-adapter.factory, erp-secret-cipher |
| payment/payment-dispatch.service.ts | 11 | payment-event-publisher |

**Fix:** wrap each behind a `domain/ports/*.port.ts` interface + `@Inject(TOKEN)`. Highest ROI for dependency-direction correctness.

### 2B. Repo-in-controller on command paths (SRP/layering) — 🟡 MED (18 controllers)

Controllers inject repository **ports** directly (legit DI), but skip the use-case layer. Read paths defensible; **write/command paths must route through use-cases**.

Notable command-path sites:
- coupons/merchant-coupons.controller.ts:15 → CouponRepository
- coupons/widget-coupons.controller.ts:22-23 → CheckoutSessionRepository, MerchantRepository
- cross-sell/merchant-cross-sell.controller.ts:18 → CrossSellPromotionRepository
- embed/embed-checkout.controller.ts:49 → CheckoutRepository
- fulfillment/tracking-webhook.controller.ts:22 → ShipmentRepository
- negotiation/m2m.controller.ts:49,53 → BuyerAccountRepository, CheckoutSessionRepository
- payment/mercadopago-oauth.controller.ts:47 → PaymentPlatformRepository
- shipping/embed-shipping.controller.ts:37-38, widget-shipping.controller.ts:20
- whatsapp-channel/whatsapp-config.controller.ts:30, whatsapp-webhook.controller.ts:64

### 2C. Hard-coded external client — 🟢 LOW (1 site)

- shared/storage/s3-upload.service.ts:30 → `new S3Client({...})`. Wrap behind injectable provider (~30 min).

### 2D. Circular dependencies — ✅ CLEAN

Zero cycles across full intra-`apps/api/src` import graph. No `forwardRef` needed anywhere.

### 2E. DI chain depth — ✅ HEALTHY

Max constructor arity 5 params (webauthn-login-verify, handle-sale-completed), avg 1.2. No god-constructors.

### 2F. Ports/adapters — ✅ PRESENT (initial false positive corrected)

Every sampled `*Repository` declared as interface in `<ctx>/domain/ports/*-repository.port.ts`, Prisma impl separate in `infrastructure/prisma-*.repository.ts`. Abstraction layer correct. **Not** missing.

---

## Phase 3: Architecture Principles Audit — COMPLETE ✓

**Overall posture:** Genuinely Clean-Architecture/DDD-shaped. Ports+tokens for DI, OUTBOX_REPOSITORY + DOMAIN_EVENT_BUS present, webhook-dedup ports wired, NestJS Logger broad (only 8 stray console.*). Problems concentrated, not systemic.

### 3A. Monolithic Laws

**🔴 HIGH — Domain layer imports framework + Prisma (pure-domain violation)**
| File | Line | Violation |
|------|------|-----------|
| cross-sell/domain/services/cross-sell-context-resolver.service.ts | 1 | imports @nestjs/common |
| cross-sell/domain/services/co-occurrence.service.ts | 2,24 | imports PrismaClient, runs queries in domain/ |
| cross-sell/domain/services/catalog-strategy-recommender.ts | 2 | imports PrismaClient |
| payment/domain/billing-plan-guard.ts | 1-11 | NestJS CanActivate guard in domain/ |

→ Move to infrastructure/. These are adapters/guards, not domain policy.

**🟡 MED — Events emitted from infrastructure**
- payment/infrastructure/checkout-payment.adapter.ts:19 → publishes DomainEventBus from infra (blurs app/infra)
- fulfillment/infrastructure/event-handlers/on-shipment-delivered.handler.ts
- payment/infrastructure/payment-event-publisher.ts:59 (acceptable for outbox relay)
→ Raise domain events from the use-case owning the state transition.

**✅ GOOD — Idempotency present.** Commerce webhooks (nuvemshop/shopify/tray/vtex/woocommerce) wire COMMERCE_PAID_WEBHOOK_DEDUP. Payment webhooks (stripe/asaas/mercadopago) verify HMAC via timingSafeEqual.

**✅ Observability:** structured Logger widespread; 8 console.* → swap for Logger (low).

### 3B. SOLID (detail)

**🔴 HIGH — SRP god use-cases (huge fan-in)**
| File | Deps | execute() LOC | Orchestrates |
|------|------|---------------|--------------|
| checkout/start-checkout.use-case.ts:42 | 18 (9 @Optional) | 331 | sessions, identity, outbox, settings, merchant, agent-context, metrics, cross-sell, intent-memory, consent, buyer-account, addresses, storefront-cart |
| checkout/send-chat-message.use-case.ts:50 | 15 | 422 | chat, rules, LLM, profile transform |

**🔴 HIGH — SRP mega use-case files (many classes per file)**
| File | LOC | Exported classes |
|------|-----|------------------|
| payment/application/payment-platform.use-cases.ts | 655 | 14 (Stripe Connect, Asaas subaccounts, billing sub/trial/checkout/portal, platform events) |
| integrations/application/integrations.use-cases.ts | 633 | 17 (API keys, webhooks, deliveries, tracking, shipments) |

**🔴 HIGH — DIP + type-safety: `prisma?: any` injected into application use-cases (5 sites)**
- start-checkout.use-case.ts:53, send-chat-message.use-case.ts:62 → `@Inject(PRISMA_CLIENT) prisma?: any`
→ Application reaching untyped DB client, bypasses ports, defeats typing. Replace with typed repository ports.

**🟡 MED — Fat controllers (business logic in `private async`)**
- operations.controller.ts (594L), payment-platform.controller.ts (547L), m2m.controller.ts (441L)

### 3C. KISS / DRY

- **🔴 742 `as any`/`: any`** in non-test code — http (153), presentation (129), repositories (109), use-cases (97). Largest quality signal; each a latent runtime bug + OCP/LSP hazard.
- revenue-lift.repository.ts:90 → untyped `(this.prisma as any).$queryRaw`, `rows as any[]`
- 128 TODO/FIXME/HACK in prod
- **✅ KISS fine** — no over-abstraction. Focus on eliminating `any` + typing repo rows.

### 3D. Object Calisthenics

- **🔴 Long methods (>40 LOC): 168 flagged.** Worst:
  | Method | LOC |
  |--------|-----|
  | store-langgraph-agent.ts:141 run() | 597 |
  | send-chat-message execute() | 422 |
  | send-store-message.use-case.ts:46 | 331 |
  | start-checkout execute() | 331 |
  | complete-order.use-case.ts:58 | 265 |
  | create-payment-intent.use-case.ts:152 | 227 |
  | storefront-conversation.adapter.ts:787 reply() | 226 |
- Large files: storefront-conversation.adapter.ts (1206L), store-tools.ts (903L), store-langgraph-agent.ts (738-882L), prisma-checkout.repository.ts (796L)
- else usage: 145 (moderate; prefer early-return, not critical)
- ✅ Abbreviations: not a problem — names explicit

---

## Synthesis — What's Actually Wrong

The three scans converge. The raw god-module count (51%) overstates risk: ports/adapters are correct, zero cycles, DI shallow. **Real problems are concentrated in 4 buckets:**

1. **Type-safety erosion** (742 `any`) — largest single signal, latent runtime bugs
2. **God use-cases** on the core checkout path (start-checkout 18 deps/331L, send-chat 422L)
3. **Layer leaks** — 4 domain-purity violations + 11 direct infra imports (DIP)
4. **Mega files** — 2 multi-class use-case files, 7 methods >200L

Full roadmap with atomic tasks: `REFACTOR-ROADMAP.md`.

---

## Next Steps

1. ✅ Phase 1: god-module scan
2. ✅ Phase 2: coupling analysis
3. ✅ Phase 3: architecture principles audit
4. ✅ Synthesized into 4 problem buckets
5. → See `REFACTOR-ROADMAP.md` for atomic tasks + priority + effort
6. → Await user go-ahead before any code change

