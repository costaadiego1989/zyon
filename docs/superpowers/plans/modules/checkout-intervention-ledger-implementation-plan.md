# Checkout Intervention Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir intervenções já disparadas por sessão (`merchant_id` + `session_id`) para fazer cumprir `cooldown_between_interventions` e `maximum_interventions_per_session` já expostos em checkout-settings/agent context (.specs/project/STATE.md indica enforced apenas após ledger).

**Architecture:** Checkout domain ganha porta `CheckoutInterventionLedgerPort` como append-only ledger; infra Prisma opcional (+ in-memory para testes). `TrackCheckoutEventUseCase` e `GetDecisionUseCase` consultam antes de definir `trigger_agent: true`; sem alterar deterministic scoring (`@aacp/decision-engine`), apenas gated.

**Tech Stack:** NestJS, TypeScript `node:test`, Prisma novo modelo `checkout_interventions`.

---

### Task LED-T001: Port + entidade InterventionRecord

**Files:**
- Create: `apps/api/src/modules/checkout/domain/entities/intervention-record.entity.ts`
- Create: `apps/api/src/modules/checkout/domain/entities/intervention-record.entity.spec.ts`
- Create: `apps/api/src/modules/checkout/domain/ports/checkout-intervention-ledger.port.ts`

```typescript
export type InterventionRecordedReason = "agent_trigger_allowed";

export interface CheckoutInterventionLedgerPort {
  countForSession(merchantId: string, sessionId: string): Promise<number>;
  lastOccurredAt(merchantId: string, sessionId: string): Promise<number | null>;
  record(input: {
    merchantId: string;
    sessionId: string;
    occurredAtUnix: number;
    reason: InterventionRecordedReason;
  }): Promise<void>;
}
```

- [ ] Entity valida timestamps monotónicos por sessão apenas no nível aplicação (ledger aceita ordenação estrita opcional).

Run: `pnpm --filter @aacp/api test -- intervention-record`
Commit: `feat(checkout): intervention ledger port scaffold`

---

### Task LED-T002: Políticas operacionais combinadas — testes puros

**Files:**
- Create: `apps/api/src/modules/checkout/domain/services/intervention-policy.service.ts`
- Create: `apps/api/src/modules/checkout/domain/services/intervention-policy.service.spec.ts`

Entrada:

```typescript
export type InterventionPolicyInput = {
  proactiveEnabled: boolean;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  nowUnix: number;
  triggerAgentFromScore: boolean;
  interventionCount: number;
  lastInterventionUnix: number | null;
};
export type InterventionPolicyDecision = {
  triggerAgent: boolean;
  suppressedReason?:
    | "max_interventions"
    | "cooldown_active"
    | "proactive_disabled"
    | null;
};
```

- [ ] **Tests matrix:**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideInterventions } from "./intervention-policy.service.js";

describe("decideInterventions", () => {
  const base = {
    proactiveEnabled: true,
    cooldownSeconds: 60,
    maxInterventionsPerSession: 3,
    nowUnix: 1000,
    triggerAgentFromScore: true,
    interventionCount: 0,
    lastInterventionUnix: null as number | null
  };

  it("allows first intervention when scoring allows", () => {
    assert.equal(decideInterventions(base).triggerAgent, true);
  });

  it("suppresses after max interventions", () => {
    const d = decideInterventions({ ...base, interventionCount: 3 });
    assert.equal(d.triggerAgent, false);
    assert.equal(d.suppressedReason, "max_interventions");
  });

  it("suppresses during cooldown window", () => {
    const d = decideInterventions({
      ...base,
      interventionCount: 1,
      lastInterventionUnix: 990,
      cooldownSeconds: 30
    });
    assert.equal(d.triggerAgent, false);
    assert.equal(d.suppressedReason, "cooldown_active");
  });

  it("allows after cooldown elapsed", () => {
    const d = decideInterventions({
      ...base,
      interventionCount: 1,
      lastInterventionUnix: 900,
      cooldownSeconds: 30
    });
    assert.equal(d.triggerAgent, true);
  });

  it("suppresses globally when proactive disabled", () => {
    const d = decideInterventions({ ...base, proactiveEnabled: false, triggerAgentFromScore: true });
    assert.equal(d.triggerAgent, false);
    assert.equal(d.suppressedReason, "proactive_disabled");
  });
});
```

- [ ] **Step 2: Implementação mínima**

`intervention-policy.service.ts`:

```typescript
export type InterventionPolicyInput = {
  proactiveEnabled: boolean;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  nowUnix: number;
  triggerAgentFromScore: boolean;
  interventionCount: number;
  lastInterventionUnix: number | null;
};
export type InterventionPolicyDecision = {
  triggerAgent: boolean;
  suppressedReason?: "max_interventions" | "cooldown_active" | "proactive_disabled" | null;
};

export function decideInterventions(i: InterventionPolicyInput): InterventionPolicyDecision {
  if (!i.proactiveEnabled) {
    return { triggerAgent: false, suppressedReason: "proactive_disabled" };
  }
  if (!i.triggerAgentFromScore) {
    return { triggerAgent: false, suppressedReason: null };
  }
  if (i.interventionCount >= i.maxInterventionsPerSession) {
    return { triggerAgent: false, suppressedReason: "max_interventions" };
  }
  if (
    i.lastInterventionUnix !== null &&
    i.nowUnix - i.lastInterventionUnix < i.cooldownSeconds
  ) {
    return { triggerAgent: false, suppressedReason: "cooldown_active" };
  }
  return { triggerAgent: true, suppressedReason: null };
}
```

Run: `pnpm --filter @aacp/api test -- intervention-policy`
Expected: PASS.

Commit: `feat(checkout): pure intervention policy decisions`

---

### Task LED-T003: In-memory ledger + integração `TrackCheckoutEventUseCase`

**Files:**
- Create: `apps/api/src/modules/checkout/infrastructure/in-memory-intervention-ledger.ts`
- Create: `apps/api/src/modules/checkout/infrastructure/in-memory-intervention-ledger.spec.ts`
- Modify: `apps/api/src/modules/checkout/application/use-cases/track-checkout-event.use-case.ts` — após `applyOperationalSettings`, se resposta final `triggerAgent` true e política ledger permitir, chamar `record`.

- [ ] Test use case: terceiro trigger dentro cooldown não incrementa `trigger_agent` true.

Commit: `feat(checkout): wire intervention ledger into track event`

---

### Task LED-T004: Integração `GetDecisionUseCase`

**Files:**
- Modify: `apps/api/src/modules/checkout/application/use-cases/get-decision.use-case.ts` — aplicar mesma política antes de retornar `trigger_agent`.

- [ ] Test: decisão silenciosa apesar de `decideIntervention` true quando max interventions atingido.

Commit: `feat(checkout): decision endpoint respects intervention ledger`

---

### Task LED-T005: Prisma ledger

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — `CheckoutIntervention` com `(merchant_id, session_id, occurred_at)`
- Create: `apps/api/src/modules/checkout/infrastructure/prisma-intervention-ledger.repository.ts`
- Create: `apps/api/src/modules/checkout/infrastructure/prisma-intervention-ledger.repository.int-spec.ts`

- [ ] Migration + integration test idempotente em `record` duplicado (opcional: unique por `event_id` se necessário).

Commit: `feat(checkout): prisma intervention ledger`

---

### Task LED-T006: E2E HTTP

**Files:**
- Create: `apps/api/src/modules/checkout/presentation/http/checkout.intervention-ledger.e2e-spec.ts`

- [ ] Sequência: start → track repeated events → assert `trigger_agent` false após limite.

Commit: `test(checkout): intervention ledger e2e`

---

## Bateria TDD (resumo)

| Camada | Ficheiros |
|--------|-----------|
| Domain policy | `intervention-policy.service.spec.ts` |
| Domain entity | `intervention-record.entity.spec.ts` |
| Infra | `in-memory-intervention-ledger.spec.ts`, `prisma-intervention-ledger.repository.int-spec.ts` |
| Application | estender `track-checkout-event.use-case.spec.ts`, `get-decision.use-case.spec.ts` |
| E2E | `checkout.intervention-ledger.e2e-spec.ts` |
