# Infrastructure Outbox and RabbitMQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar publicação assíncrona durável de factos de domínio via outbox transacional + RabbitMQ (`aacp.events`, `aacp.retry`, `aacp.dlx`) com consumidores idempotentes (inbox), alinhado a `.specs/project/AGENT_CONTEXT.md` e Group C de `.specs/features/modular-ddd-foundation/tasks.md`.

**Architecture:** Na mesma transação Prisma das mutações, inserir linha `OutboxMessage` já existente conceitualmente no checkout; worker separado (processo Node ou Nest `OnModuleInit`) fechado com `Channel` amqplib; consumidores atualizam projections ou disparam side effects internos monólito via use cases.

**Tech Stack:** RabbitMQ 3.x Docker, `amqplib`, Prisma, Testcontainers ou container fixo em CI para integração.

---

### Task OUT-T001: Messaging contracts package

**Files:**
- Create: `packages/messaging-contracts/src/envelope.ts`
- Create: `packages/messaging-contracts/src/envelope.spec.ts`

```typescript
export type AacpEventEnvelopeV1 = {
  event_id: string;
  event_type: string;
  schema_version: 1;
  merchant_id: string;
  occurred_at: string;
  correlation_id: string;
  causation_id: string;
  producer: string;
  payload: Record<string, unknown>;
};

export function validateEnvelope(e: unknown): AacpEventEnvelopeV1 {
  if (typeof e !== "object" || e === null) throw new Error("invalid_envelope");
  const o = e as Record<string, unknown>;
  const required = ["event_id","event_type","merchant_id","occurred_at","correlation_id","causation_id","producer","payload"] as const;
  for (const k of required) {
    if (!(k in o)) throw new Error(`missing_${k}`);
  }
  return { ...o, schema_version: 1 } as AacpEventEnvelopeV1;
}
```

Run: `pnpm --filter @aacp/messaging-contracts test`

Commit: `feat(messaging): event envelope contract`

---

### Task OUT-T002: Outbox writer transacional (reforço)

**Files:**
- Modify: `apps/api/src/modules/checkout/application/use-cases/checkout-transaction.ts` — garantir append outbox na mesma `$transaction` já usada.
- Create: `apps/api/src/modules/outbox/application/publish-outbox-batch.use-case.spec.ts` com fake prisma.

- [ ] Test rollback: comando falha após append → outbox row não aparece em query seguinte simulada.

Commit: `test(outbox): transactional write guarantees`

---

### Task OUT-T003: Publisher worker

**Files:**
- Create: `apps/api/src/workers/outbox-publisher.ts` — loop seleciona `status=pending ORDER BY occurred_at LIMIT 50`, marca `processing`, publish, mark `published`.
- Create: `apps/api/src/workers/outbox-publisher.integration-spec.ts`

- [ ] Duplicate publish protection: mesmo `event_id` requeue-safe (retry idempotente no broker + DB unique `(event_id)`). 

Commit: `feat(outbox): publisher worker skeleton`

---

### Task OUT-T004: Topology RabbitMQ

**Files:**
- Create: `infra/rabbitmq/definitions.dev.json` (exchanges `aacp.events` topic durable, retry, dlq)
- Create: `apps/api/scripts/setup-rabbit-topology.ts`

- [ ] Smoke script em dev; documentar variáveis `RABBIT_URL`.

Commit: `chore(infra): rabbitmq topology script`

---

### Task OUT-T005: Inbox consumer idempotência

**Files:**
- Create: `apps/api/prisma/schema.prisma` — `InboxMessage` UNIQUE(`merchant_id`, `delivery_id`) ou `event_id`.
- Create: `apps/api/src/modules/inbox/application/process-inbox-message.use-case.ts`
- Create: `apps/api/src/modules/inbox/application/process-inbox-message.use-case.spec.ts`

- [ ] Test: mesma mensagem segunda vez não reexecuta projection handler.

Commit: `feat(inbox): idempotent consumer`

---

### Task OUT-T006: Milestone MVP — async opcional na pilot

Documentar toggle `OUTBOX_PUBLISHER_ENABLED=false` até credenciais broker estáveis; objetivo final `true` para pilot.

Commit: `docs(outbox): deployment flags`

---

## Bateria TDD

| Suite | Casos |
|-------|-------|
| `envelope.spec.ts` | missing field; valid minimal |
| `publish-outbox-batch.use-case.spec.ts` | pick pending; backoff |
| `outbox-publisher.integration-spec.ts` | publish ACK (requer Rabbit) |
| `process-inbox-message.use-case.spec.ts` | first insert; duplicate skip |

**Nota:** Parte dos testes marcados `#integration` só em `pnpm test:integration` se introduziram gate separado para não falhar máquinas sem Rabbit.
