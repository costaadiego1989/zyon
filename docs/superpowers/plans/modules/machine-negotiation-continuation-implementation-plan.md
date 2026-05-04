# Machine Negotiation Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir políticas/preferences, sessão e custos; expor API além do motor puro; ligar acordo determinístico à autorização de ofertas no checkout (MN-T004 a MN-T008; alinhado a `.specs/features/machine-negotiation/design.md` secção Future API).

**Architecture:** Dados em `merchant`-adjacent ou `negotiation` module com Prisma; reuso de `EvaluateNegotiationUseCase`; novos modelos `MerchantNegotiationPolicyRow`, `BuyerAgentNegotiationPreferencesRow`, `NegotiationSession`, `NegotiationCostLedgerEntry`; checkout recebe port `NegotiationAgreementPort` só com output auditável sem LLM.

**Tech Stack:** NestJS, Prisma, `node:test`, pacote `@aacp/negotiation-engine` existente.

---

## Estado prévio

- MN-T001–T003A completos (motor + `POST /negotiations/evaluate`).

---

### Task MN-T004: Política merchant via API + persistência

**Files:**
- Create: `apps/api/src/modules/negotiation/domain/merchant-negotiation-policy.entity.ts`
- Create: `apps/api/src/modules/negotiation/domain/merchant-negotiation-policy.entity.spec.ts`
- Create: `apps/api/src/modules/negotiation/infrastructure/prisma-merchant-negotiation-policy.repository.ts`
- Create: `apps/api/src/modules/negotiation/presentation/http/merchant-negotiation-policy.controller.ts`
- Create: `apps/api/src/modules/negotiation/presentation/http/merchant-negotiation-policy.controller.spec.ts`

Rotas (alinhado design):

- `GET /merchant-negotiation-policy`
- `PUT /merchant-negotiation-policy`

- [ ] **Step 1: Controller test** — `PUT` com body contendo `merchantId` falso; persistência usa `merchantId` do JWT (padrão existente em [`negotiation.controller.spec.ts`](apps/api/src/modules/negotiation/presentation/http/negotiation.controller.spec.ts)).

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MerchantNegotiationPolicyController } from "./merchant-negotiation-policy.controller.js";
import { UpsertMerchantNegotiationPolicyUseCase } from "../../application/upsert-merchant-negotiation-policy.use-case.js";

describe("MerchantNegotiationPolicyController", () => {
  it("scopes upsert to JWT merchant", async () => {
    let seen = "";
    const uc = new UpsertMerchantNegotiationPolicyUseCase({
      async save(input) {
        seen = input.merchantId;
        return input;
      },
      async load() {
        return null;
      }
    });
    const c = new MerchantNegotiationPolicyController(uc);
    await c.put(
      { user: { merchantId: "m_jwt", userId: "", email: "", role: "owner" } },
      { merchantId: "m_evil", enabled: true, global: { minOfferDiscountPercent: 1, maxDiscountPercent: 5 } }
    );
    assert.equal(seen, "m_jwt");
  });
});
```

- [ ] **Step 2:** Prisma model + migration JSON policy column.
- [ ] **Step 3: Commit** `feat(negotiation): persist merchant negotiation policy`

---

### Task MN-T005: Preferências buyer-agent

**Files:**
- Create: `apps/api/src/modules/negotiation/domain/buyer-agent-preferences.entity.ts`
- Create: `apps/api/src/modules/negotiation/domain/buyer-agent-preferences.entity.spec.ts`
- Create: `apps/api/src/modules/negotiation/presentation/http/buyer-agent-preferences.controller.ts`
- Create: `apps/api/src/modules/negotiation/application/upsert-buyer-agent-preferences.use-case.spec.ts`

Rotas:

- `GET /buyer-agent/preferences?global_user_id=…` (autenticado merchant + user escopo)
- `PUT /buyer-agent/preferences`

- [ ] Tests: `global_user_id` nunca cruza `merchant_id`; query exige ambos no repositório `(merchant_id, global_user_id)`.

Commit: `feat(negotiation): buyer agent preferences persistence`

---

### Task MN-T006: Sessão + cost ledger Prisma

**Files:**
- Create: `apps/api/prisma/migrations/.../negotiation_session_ledger/`
- Create: `apps/api/src/modules/negotiation/application/start-negotiation-session.use-case.ts`
- Create: `apps/api/src/modules/negotiation/infrastructure/prisma-negotiation-session.repository.int-spec.ts`

- [ ] Ao receber `POST /negotiations/evaluate`, gravar `NegotiationSession` com `estimated_ai_calls`, `estimated_ai_cost_cents`, `agreement`.
- [ ] `NegotiationCostLedgerEntry` append-only.

Commit: `feat(negotiation): session and cost ledger`

---

### Task MN-T007: Acordo → oferta autorizada checkout

**Files:**
- Create: `apps/api/src/modules/negotiation/domain/ports/checkout-negotiation.port.ts`
- Create: `apps/api/src/modules/negotiation/application/apply-negotiation-agreement.use-case.ts`
- Create: `apps/api/src/modules/negotiation/application/apply-negotiation-agreement.use-case.spec.ts`
- Modify: fluxo existente de authorize offer/checkout — método que consome resultado `selectedDiscountPercent` apenas se igual ao output do motor para o mesmo `cart` fingerprint.

- [ ] **Test:** registar `Agreement` snapshot; chamada divergente (LLM tentando 99%) falha gates.

Commit: `feat(negotiation): wire agreement snapshot to checkout authorized offers`

---

### Task MN-T008: Live M2M e2e opcional

**Files:**
- Create: `apps/api/src/modules/negotiation/presentation/http/negotiation.live-m2m.e2e-spec.ts`

- [ ] Skip unless `RUN_REAL_AI_E2E=true` e caps definidos no policy; dois requests simulados merchant-agent/buyer-agent com provider key (espelhar `checkout.ai-live-e2e-spec.ts`).

Commit: `test(negotiation): opt-in live m2m negotiation e2e`

---

## Bateria TDD

| Suite | Casos |
|-------|-------|
| `merchant-negotiation-policy.entity.spec.ts` | enabled/disabled JSON shape |
| `merchant-negotiation-policy.controller.spec.ts` | JWT scope |
| `buyer-agent-preferences.entity.spec.ts` | caps, autoAccept bounds |
| `upsert-buyer-agent-preferences.use-case.spec.ts` | cross-merchant isolation |
| `prisma-negotiation-session.repository.int-spec.ts` | ledger append |
| `apply-negotiation-agreement.use-case.spec.ts` | happy path / tamper reject |
| `negotiation.live-m2m.e2e-spec.ts` | skipped por default |
