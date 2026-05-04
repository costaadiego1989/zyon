# Commerce Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commerce adapters validam carrinho no servidor, criam ordem pendente e marcam paga só após `payment.approved`; sem processar pagamento do buyer (COM-REQ-001 a COM-REQ-007).

**Architecture:** Novo pacote ou módulo `commerce` com ports `CommerceCartPort`, `CommerceOrderPort`, `CommerceOfferPort` (ver `.specs/features/commerce-sync/design.md`); checkout e payment chamam estes ports; primeira implementação `ShopifyCommerceAdapter` com HTTP fake em testes.

**Tech Stack:** TypeScript puro em `packages/commerce-adapters` ou `apps/api/src/modules/commerce`, `node:test`, fetch mock.

---

## Mapeamento REQ → tarefas

| REQ | Task |
|-----|------|
| COM-REQ-001 | COM-T006 (adapter sem chamadas payment) |
| COM-REQ-002,003 | COM-T003 |
| COM-REQ-004 | COM-T004 |
| COM-REQ-005 | COM-T005 |
| COM-REQ-006 | COM-T002 ports + repos |
| COM-REQ-007 | COM-T006 Shopify; COM-T007 Woo notas |

---

### Task COM-T002: Contratos de ports

**Files:**
- Create: `packages/commerce-adapters/src/ports.ts` (ou `apps/api/src/modules/commerce/domain/ports/`)
- Create: `packages/commerce-adapters/src/ports.spec.ts` (type-level + runtime stub se necessário)

```typescript
export type TrustedCartLine = { sku: string; quantity: number; unitPriceCents: number; title: string };
export type TrustedCartSnapshot = {
  currency: string;
  totalCents: number;
  lines: TrustedCartLine[];
  commerceCartRef: string;
};

export interface CommerceCartPort {
  validateCart(input: { merchantId: string; commerceCartRef: string }): Promise<TrustedCartSnapshot>;
}

export interface CommerceOrderPort {
  createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }>;
  markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void>;
}

export interface CommerceOfferPort {
  buildOfferMetadata(input: { authorizedOfferId: string; discountCents: number }): Promise<Record<string, unknown>>;
}
```

- [ ] **Step 1:** Exportar tipos em `packages/commerce-adapters/package.json` workspace.
- [ ] **Step 2:** `pnpm --filter @aacp/commerce-adapters typecheck`
- [ ] **Step 3: Commit** `feat(commerce): neutral commerce ports`

---

### Task COM-T003: Validar carrinho antes do payment

**Files:**
- Create: `apps/api/src/modules/commerce/application/validate-cart-for-payment.use-case.ts`
- Create: `apps/api/src/modules/commerce/application/validate-cart-for-payment.use-case.spec.ts`

- [ ] **Step 1: Test** browser total ignorado — input HTTP traz `client_total_cents: 9999`, port devolve trusted `1000`; use case retorna erro se diff.

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { ValidateCartForPaymentUseCase } from "./validate-cart-for-payment.use-case.js";

test("ignores inflated browser total when trusted commerce cart differs", async () => {
  const uc = new ValidateCartForPaymentUseCase({
    async validateCart() {
      return {
        currency: "BRL",
        totalCents: 5000,
        lines: [{ sku: "a", quantity: 1, unitPriceCents: 5000, title: "A" }],
        commerceCartRef: "c1"
      };
    }
  });
  await assert.rejects(
    () =>
      uc.execute({
        merchantId: "m1",
        commerceCartRef: "c1",
        clientReportedTotalCents: 1
      }),
    /client_total_mismatch/
  );
});

test("accepts matching client reported total optionally", async () => {
  const uc = new ValidateCartForPaymentUseCase({
    async validateCart() {
      return {
        currency: "BRL",
        totalCents: 5000,
        lines: [],
        commerceCartRef: "c1"
      };
    }
  });
  const out = await uc.execute({
    merchantId: "m1",
    commerceCartRef: "c1",
    clientReportedTotalCents: 5000
  });
  assert.equal(out.trustedCart.totalCents, 5000);
});
```

- [ ] **Step 2:** Implementar use case.
- [ ] **Step 3: Commit** `feat(commerce): validate trusted cart before payment`

---

### Task COM-T004: Ordem pendente idempotente

**Files:**
- Create: `apps/api/src/modules/commerce/application/sync-pending-order.use-case.ts`
- Create: `apps/api/src/modules/commerce/application/sync-pending-order.use-case.spec.ts`

- [ ] Persistir/em memória `(merchant_id, session_id)` → `commerce_order_id`; segunda chamada devolve mesmo id.

Commit: `feat(commerce): idempotent pending order creation`

---

### Task COM-T005: Marcar pago após payment approved

**Files:**
- Create: `apps/api/src/modules/commerce/application/mark-commerce-order-paid.use-case.ts`
- Create: `apps/api/src/modules/commerce/application/mark-commerce-order-paid.use-case.spec.ts`

- [ ] Listener ou chamada desde `HandleAsaasWebhookUseCase` através de `CommerceCheckoutPort`; duplicado `paymentReference` não chama Shopify duas vezes (mock conta chamadas).

Commit: `feat(commerce): idempotent paid sync`

---

### Task COM-T006: Adapter Shopify fake HTTP

**Files:**
- Create: `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts`
- Create: `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.spec.ts`

- [ ] Fake `fetch` retorna fixture JSON minimal Admin API draft order/create.
- [ ] Assertions: nunca POST para URL de cobrança Asaas.

Commit: `feat(commerce): shopify commerce adapter tests`

---

### Task COM-T007: Notas WooCommerce (planeamento apenas)

**Files:**
- Create: `packages/commerce-adapters/README.md` (secção Woo: endpoints REST, hooks, mesmo `CommerceCartPort`)

- [ ] Documentar deltas + lista de tasks futuras `WOO-T001…` (sem código runtime obrigatório neste MVP doc).

Commit: `docs(commerce): woocommerce adapter notes`

---

## Bateria TDD

| Ficheiro | Casos obrigatórios |
|----------|---------------------|
| `validate-cart-for-payment.use-case.spec.ts` | mismatch total; match; commerce error propagates |
| `sync-pending-order.use-case.spec.ts` | first create; second idempotent |
| `mark-commerce-order-paid.use-case.spec.ts` | first paid; duplicate skipped |
| `shopify-commerce.adapter.spec.ts` | cart validate mapping; pending order create; mark paid PUT/PATCH |
