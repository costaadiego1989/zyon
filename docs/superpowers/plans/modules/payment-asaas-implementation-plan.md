# Payment Asaas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo `payment` com intents buyer-scoped, webhooks Asaas idempotentes, conclusão de checkout em `approved` e factos `payment.failed` sem completar ordem (PAY-REQ-001 a PAY-REQ-010).

**Architecture:** Domínio com máquina de estados `pending | requires_action | approved | failed | cancelled | refunded`; ports `PaymentRepository`, `PaymentProviderPort`, `CheckoutPaymentPort` (consulta sessão / completa ordem); adapter Asaas só em `infrastructure`; webhook grava `PaymentProviderEvent` idempotente por `provider_event_id`.

**Tech Stack:** NestJS, Prisma, `node:test`, fetch mockável; `.env`: `ASAAS_SANDBOX`, `ASAAS_API_KEY`, `ASAAS_API_KEY_SANDBOX`, URLs default (`asaas-env.ts`), `ASAAS_WEBHOOK_TOKEN`; pagador com `cus_` em `customer.asaasCustomerId` na sessão de checkout (`StartCheckout`).

---

## Mapeamento REQ → tarefas

| REQ | Task |
|-----|------|
| PAY-REQ-001,002,003 | PAY-T002, PAY-T003 |
| PAY-REQ-004 | PAY-T002 (invariantes entidade), PAY-T006 (sem log de PAN) |
| PAY-REQ-005 | PAY-T006, SEW (widget) |
| PAY-REQ-006 | PAY-T007 |
| PAY-REQ-007 | PAY-T008 |
| PAY-REQ-008 | PAY-T009 |
| PAY-REQ-009 | conversation AI safety já existente; não repetir claims no payment |
| PAY-REQ-010 | PAY-T005 interface `PaymentProviderPort` |

---

### Task PAY-T002: Domínio payment intent

**Files:**
- Create: `apps/api/src/modules/payment/domain/payment-intent.entity.ts`
- Create: `apps/api/src/modules/payment/domain/payment-intent.entity.spec.ts`

- [ ] **Step 1: Failing tests** — transições válidas e inválidas, idempotência lógica de chave `(merchantId, sessionId, method)`.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "./payment-intent.entity.js";

describe("PaymentIntentEntity", () => {
  it("starts in pending", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "idem_1",
      amountCents: 1000,
      currency: "BRL",
      method: "pix"
    });
    assert.equal(p.status, "pending");
  });

  it("cannot approve twice with different totals", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "idem_1",
      amountCents: 1000,
      currency: "BRL",
      method: "pix"
    });
    p.markApproved({ providerPaymentId: "asaas_1", approvedAmountCents: 1000 });
    assert.throws(() => p.markApproved({ providerPaymentId: "asaas_2", approvedAmountCents: 999 }), /illegal_transition/);
  });

  it("rejects persisting raw card fields", () => {
    assert.throws(
      () =>
        PaymentIntentEntity.create({
          merchantId: "m1",
          sessionId: "s1",
          idempotencyKey: "idem_1",
          amountCents: 100,
          currency: "BRL",
          method: "card",
          unsafeRawCardPan: "4111"
        } as never),
      /raw_card_forbidden/
    );
  });
});
```

Run: `pnpm --filter @aacp/api exec node --import tsx --test apps/api/src/modules/payment/domain/payment-intent.entity.spec.ts`
Expected: FAIL.

- [ ] **Step 2: Implement entity** — factory `create` valida ausência de campos PAN/CVV; métodos `markRequiresAction`, `markApproved`, `markFailed`.

- [ ] **Step 3: PASS**, commit:

```bash
git add apps/api/src/modules/payment/domain/
git commit -m "feat(payment): payment intent entity with safe fields"
```

---

### Task PAY-T003: Repository port + in-memory

**Files:**
- Create: `apps/api/src/modules/payment/domain/ports/payment-repository.port.ts`
- Create: `apps/api/src/modules/payment/infrastructure/in-memory-payment.repository.ts`
- Create: `apps/api/src/modules/payment/infrastructure/in-memory-payment.repository.spec.ts`

Port mínimo:

```typescript
export type SavePaymentIntentInput = { intent: PaymentIntentEntity };
export interface PaymentRepository {
  saveIntent(input: SavePaymentIntentInput): Promise<void>;
  getByIdempotency(merchantId: string, sessionId: string, idempotencyKey: string): Promise<PaymentIntentEntity | null>;
  getByProviderPaymentId(merchantId: string, providerPaymentId: string): Promise<PaymentIntentEntity | null>;
}
```

- [ ] Test: dois merchants com mesma `(sessionId, idempotencyKey)` não colidem (`m1` vs `m2`).

Run: `pnpm --filter @aacp/api test -- payment.repository`
Expected: PASS.

Commit: `feat(payment): in-memory payment repository`.

---

### Task PAY-T004: Prisma schema + repository

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — modelos `PaymentIntent`, `PaymentAttempt`, `PaymentProviderEvent`
- Create: `apps/api/src/modules/payment/infrastructure/prisma-payment.repository.ts`
- Create: `apps/api/src/modules/payment/infrastructure/prisma-payment.repository.int-spec.ts`

- [ ] **Step 1:** Migration com índices `(merchant_id, session_id, idempotency_key)` UNIQUE e `(merchant_id, provider_payment_id)` UNIQUE.

- [ ] **Step 2:** int-spec: save + load + duplicate idempotency retorna mesmo registo.

Commit: `feat(payment): prisma payment persistence`.

---

### Task PAY-T005: `PaymentProviderPort` fake

**Files:**
- Create: `apps/api/src/modules/payment/domain/ports/payment-provider.port.ts`
- Create: `apps/api/src/modules/payment/infrastructure/fake-payment-provider.ts`

```typescript
export type CreateProviderPaymentInput = {
  merchantId: string;
  sessionId: string;
  intentId: string;
  amountCents: number;
  currency: string;
  method: string;
};
export type CreateProviderPaymentOutput = {
  providerPaymentId: string;
  status: "pending" | "requires_action";
  buyerFacingPayload: { qrCodeCopyPaste?: string; redirectUrl?: string };
};
export interface PaymentProviderPort {
  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput>;
}
```

- [ ] Use case test `create-payment-intent.use-case.spec.ts` com Fake que devolve `{ providerPaymentId: "fake_1", status: "pending", buyerFacingPayload: {} }`.

Commit: `feat(payment): provider port and fake adapter`.

---

### Task PAY-T006: `AsaasPaymentAdapter`

**Files:**
- Create: `apps/api/src/modules/payment/infrastructure/asaas-payment.adapter.ts`
- Create: `apps/api/src/modules/payment/infrastructure/asaas-payment.adapter.spec.ts`

- [ ] Injetar `fetch` mock; assert URL e header `access_token` sem retornar segredos no output DTO.
- [ ] Não persistir resposta bruta com PAN.

Commit: `feat(payment): Asaas payment adapter with mock fetch`.

---

### Task PAY-T007: Webhook use case + controller

**Files:**
- Create: `apps/api/src/modules/payment/application/handle-asaas-webhook.use-case.ts`
- Create: `apps/api/src/modules/payment/application/handle-asaas-webhook.use-case.spec.ts`
- Create: `apps/api/src/modules/payment/presentation/http/asaas-webhook.controller.ts`
- Create: `apps/api/src/modules/payment/presentation/http/asaas-webhook.controller.spec.ts`

- [ ] Test: mesmo `provider_event_id` duas vezes não duplica gravação de transição.
- [ ] Test: assinatura inválida → 401 quando `ASAAS_WEBHOOK_SECRET` definido.

Commit: `feat(payment): Asaas webhook idempotency`.

---

### Task PAY-T008: Aprovação completa checkout + purchase history

**Files:**
- Create: `apps/api/src/modules/payment/domain/ports/checkout-payment.port.ts`
- Modify: `apps/api/src/modules/payment/application/handle-asaas-webhook.use-case.ts` — em `approved`, chama `checkoutPayment.completeFromPayment(...)` uma vez.

- [ ] Test com `InMemoryCheckoutRepository` + `RecordingPurchaseHistoryPort` (espelhar `complete-order.use-case.spec.ts` linhas 29–51): após webhook approved, `order.completed` uma vez e `purchaseHistory.records.length === 1`.

Commit: `feat(payment): wire payment approved to checkout completion`.

---

### Task PAY-T009: Falha de pagamento → evento checkout

**Files:**
- Modify: webhook use case — em `failed`, chama `checkoutPayment.recordPaymentFailedFact(sessionId, reason)` ou `repository.recordEvent` via port dedicado.

- [ ] Test: ordem não completa; outbox ou evento `payment.failed` registado; conversa pode ser acionada em camada superior (stub).

Commit: `feat(payment): record failed payment without order completion`.

---

### Task PAY-T010: E2E buyer checkout payment

**Files:**
- Create: `apps/api/src/modules/payment/presentation/http/payment.checkout.e2e-spec.ts`

- [ ] Fluxo: `start checkout` → `create payment intent` (HTTP) → simular webhook approved (controller de teste ou payload fixture) → assert sessão completa.

Run: `pnpm --filter @aacp/api test:prisma -- payment.checkout`
Expected: PASS.

Commit: `test(payment): checkout payment happy path e2e`.

---

## Bateria TDD resumida

| Suite | Casos |
|-------|-------|
| `payment-intent.entity.spec.ts` | pending, requires_action, approved, failed, cancelled; double approve; raw card guard |
| `in-memory-payment.repository.spec.ts` | isolamento tenant; idempotency key |
| `prisma-payment.repository.int-spec.ts` | unique constraints; reload |
| `create-payment-intent.use-case.spec.ts` | session inexistente → NotFound; intent idempotente |
| `asaas-payment.adapter.spec.ts` | headers, mapping, sem secrets no return |
| `handle-asaas-webhook.use-case.spec.ts` | duplicate event; unknown intent; approved/failed |
| `payment.checkout.e2e-spec.ts` | happy path + failed não completa |
