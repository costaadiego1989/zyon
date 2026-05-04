# Billing Asaas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faturação SaaS do merchant com planos, quota, metering idempotente, webhooks Asaas billing e gates de funcionalidades enriquecidas (BIL-REQ-001 a BIL-REQ-007). Comprador checkout permanece em `payment` separado.

**Architecture:** Módulo `billing` com `BillingRepository`, `BillingProviderPort`, `UsageEvent` idempotente por `(merchant_id, event_id)`, `BillingFeatureGatePort` consultado antes de enrichment de histórico/negociação.

**Tech Stack:** NestJS, Prisma, `node:test`, Asaas Billing API via fetch mockada.

---

## Mapeamento REQ → tarefas

| REQ | Task |
|-----|------|
| BIL-REQ-001 | BIL-T002 entity plan/subscription |
| BIL-REQ-002 | BIL-T003 consume metering |
| BIL-REQ-003 | BIL-T003 idempotência |
| BIL-REQ-004 | BIL-T007 feature gate |
| BIL-REQ-005 | BIL-T006 webhook |
| BIL-REQ-006 | BIL-T005 sem secrets ao browser |
| BIL-REQ-007 | todas as queries `merchant_id` |

---

### Task BIL-T002: Domínio billing

**Files:**
- Create: `apps/api/src/modules/billing/domain/subscription.entity.ts`
- Create: `apps/api/src/modules/billing/domain/subscription.entity.spec.ts`
- Create: `apps/api/src/modules/billing/domain/quota.policy.ts`
- Create: `apps/api/src/modules/billing/domain/quota.policy.spec.ts`

- [ ] **Test:** trial ativo permite usage até limite; `past_due` bloqueia só features gated, não checkout base.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuotaPolicy } from "./quota.policy.js";

describe("QuotaPolicy", () => {
  it("allows enrichment under quota", () => {
    const p = new QuotaPolicy({ purchaseHistoryContextUsedThisMonth: 10, enrichmentLimit: 100 });
    assert.equal(p.allowEnrichedPurchaseHistoryContext(), true);
  });

  it("blocks enrichment when at limit but keeps base checkout semantics out of billing module", () => {
    const p = new QuotaPolicy({ purchaseHistoryContextUsedThisMonth: 100, enrichmentLimit: 100 });
    assert.equal(p.allowEnrichedPurchaseHistoryContext(), false);
  });
});
```

Commit: `feat(billing): subscription and quota domain`

---

### Task BIL-T003: Use cases de usage

**Files:**
- Create: `apps/api/src/modules/billing/application/record-usage-event.use-case.ts`
- Create: `apps/api/src/modules/billing/application/record-usage-event.use-case.spec.ts`

Port:

```typescript
export type UsageEventRecord = {
  merchantId: string;
  eventId: string;
  eventType:
    | "purchase_history.context_used"
    | "purchase_history.imported_order"
    | "negotiation.history_enriched";
  quantity: number;
  occurredAtUnix: number;
  metadata?: Record<string, unknown>;
};
export interface BillingRepository {
  insertUsageIfNew(event: UsageEventRecord): Promise<"inserted" | "duplicate">;
}
```

- [ ] Test: mesmo `eventId` segunda vez → `duplicate`.

Commit: `feat(billing): idempotent usage recording`

---

### Task BIL-T004: Prisma persistence

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — `MerchantBillingPlan`, `MerchantSubscription`, `UsageEventRecord`, `BillingProviderEvent`
- Create: `prisma-billing.repository.ts` + `prisma-billing.repository.int-spec.ts`

- [ ] Índices únicos `(merchant_id, external_subscription_id)`, `(merchant_id, usage_event_id)`.

Commit: `feat(billing): prisma billing models`

---

### Task BIL-T005: Asaas billing adapter

**Files:**
- Create: `apps/api/src/modules/billing/infrastructure/asaas-billing.adapter.ts`
- Create: `apps/api/src/modules/billing/infrastructure/asaas-billing.adapter.spec.ts`

- [ ] Mock fetch: cria cliente + subscription; resposta mapeada para entidades internas; nenhum campo secret no DTO retornado a HTTP.

Commit: `feat(billing): Asaas billing adapter`

---

### Task BIL-T006: Webhook billing

**Files:**
- Create: `apps/api/src/modules/billing/application/handle-asaas-billing-webhook.use-case.ts`
- Create: `apps/api/src/modules/billing/application/handle-asaas-billing-webhook.use-case.spec.ts`
- Create: `apps/api/src/modules/billing/presentation/http/asaas-billing-webhook.controller.ts`

- [ ] Idempotência por `provider_event_id`.

Commit: `feat(billing): billing webhook idempotency`

---

### Task BIL-T007: Feature gate port

**Files:**
- Create: `apps/api/src/modules/billing/domain/ports/billing-feature-gate.port.ts`
- Create: `apps/api/src/modules/billing/infrastructure/billing-feature-gate.service.ts`
- Modify: `RecordCompletedPurchaseUseCase` / `GetBuyerPurchaseContextUseCase` **não** devem importar Prisma; injetar gate: se quota excedida, contexto enriquecido vazio mas core checkout continua (test duplo em `buyer-purchase-history` com fake gate).

```typescript
export interface BillingFeatureGatePort {
  allowPurchaseHistoryEnrichment(merchantId: string): Promise<boolean>;
  allowNegotiationHistoryEnrichment(merchantId: string): Promise<boolean>;
}
```

- [ ] Test gate: `merchant` acima do limite → `false`.

Commit: `feat(billing): feature gate for paid add-ons`

---

### Task BIL-T008: API queries dashboard

**Files:**
- Create: `apps/api/src/modules/billing/presentation/http/billing.controller.ts`
- Create: `apps/api/src/modules/billing/presentation/http/billing.controller.spec.ts`

- [ ] `GET /billing/me` → plano atual, usage do mês, quota, estado subscrição; merchant vem do JWT.

Commit: `feat(billing): merchant billing status API`

---

## Bateria TDD

| Suite | Casos |
|-------|-------|
| `subscription.entity.spec.ts` | trial, active, canceled |
| `quota.policy.spec.ts` | under/at/over limit |
| `record-usage-event.use-case.spec.ts` | insert, duplicate eventId |
| `prisma-billing.repository.int-spec.ts` | constraints |
| `asaas-billing.adapter.spec.ts` | request shape |
| `handle-asaas-billing-webhook.use-case.spec.ts` | duplicate |
| `billing.controller.spec.ts` | JWT scoping |
