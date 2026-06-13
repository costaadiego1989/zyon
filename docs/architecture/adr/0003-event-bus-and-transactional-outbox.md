# ADR 0003 — Event Bus em-process + Transactional Outbox

- **Status:** aceito
- **Data:** 2026-05-09
- **Decisores:** Engenharia, Plataforma
- **Relacionado:** [ADR 0001](./0001-modular-monolith-bounded-contexts.md), [ADR 0002](./0002-acl-pattern-cross-context.md)

## Contexto

Hoje os use-cases gravam eventos na tabela `OutboxMessage` via
`appendOutbox(...)`, mas **nada consome**. A comunicação cross-context
real acontece por injeção direta de classes de application layer
(`CheckoutPaymentAdapter` injeta `CompleteOrderUseCase`,
`ApplyNegotiationAgreementToCheckoutUseCase` chama porta do checkout, etc.).
Isso:

- impede que módulos sejam evoluídos independentemente,
- não permite reprocessamento (não há fila),
- gera ciclos sutis de dependência (paymentEmbed → checkout, etc.),
- não dá visibilidade do que está acontecendo no sistema (sem trace,
  sem possibilidade de auditoria por evento).

## Decisão

Adotamos:

1. **EventBus em-process** baseado em `@nestjs/cqrs` (`EventBus`,
   `IEvent`, `@EventsHandler`) ou implementação própria minimalista
   (decisão final fica para a issue de implementação).
2. **Transactional Outbox** como mecanismo de garantia at-least-once:
   - O *write* do agregado e o `appendOutbox` ocorrem na mesma transação Prisma.
   - Um `OutboxDispatcher` (cron in-process com lock distribuído via Redis SET NX)
     lê eventos com status `pending`, publica no `EventBus` (e, futuramente,
     em broker externo Kafka/Rabbit/NATS), marca como `delivered`.
   - Falhas de handler vão para retry exponencial; após N falhas, evento
     vai para tabela `OutboxMessageDLQ`.
3. **Idempotência por `event_id`.** Cada handler deve ser idempotente.
   O dispatcher anota `event_id` em `processed_events` para evitar
   double-fire na recuperação.
4. **Schema versionado** (`schema_version` já existe em `DomainEventEnvelope`).
   Evolução faz `schema_version: 2` co-existindo com 1 por 1 release.

## Esquema do OutboxMessage (alvo)

```prisma
model OutboxMessage {
  id             String   @id @default(cuid())
  eventId        String   @unique @map("event_id")
  eventType      String   @map("event_type")
  schemaVersion  Int      @map("schema_version")
  merchantId     String   @map("merchant_id")
  payload        Json
  correlationId  String   @map("correlation_id")
  causationId    String   @map("causation_id")
  status         String   @default("pending")     // pending | delivered | failed | dead
  attempts       Int      @default(0)
  lastError      String?  @map("last_error")
  occurredAt     DateTime @map("occurred_at")
  deliveredAt    DateTime? @map("delivered_at")
  nextAttemptAt  DateTime? @map("next_attempt_at")

  @@index([status, nextAttemptAt])
  @@index([merchantId, eventType, occurredAt])
}
```

## Fluxo

```
┌──────────────┐ append (mesma TX) ┌─────────────┐
│  Use-case    │ ─────────────────► │ OutboxMsg  │ status=pending
│  domain      │                    └─────────────┘
└──────────────┘                            │
                                            │ poll
                                            ▼
                                    ┌──────────────┐
                                    │ Dispatcher   │ lock SET NX EX
                                    │ (1/instance) │
                                    └──────┬───────┘
                                           │ publish
                                           ▼
                                    ┌──────────────┐
                                    │  EventBus    │
                                    └──────┬───────┘
                                           │ fan-out
              ┌────────────────────────────┼─────────────────────┐
              ▼                            ▼                     ▼
      ┌──────────────┐           ┌──────────────┐       ┌──────────────┐
      │ checkout     │           │ commerce     │       │ analytics    │
      │ handlers     │           │ handlers     │       │ handlers     │
      └──────────────┘           └──────────────┘       └──────────────┘
```

Quando precisarmos de comunicação inter-instância (cluster), trocamos o
`EventBus` por bridge para Rabbit/Kafka. A lógica de domínio não muda.

## Handlers exemplares (alvo)

### `payment.approved` → checkout

```ts
// apps/api/src/modules/checkout/infrastructure/event-handlers/on-payment-approved.handler.ts
@EventsHandler(PaymentApprovedEvent)
export class OnPaymentApprovedHandler implements IEventHandler<PaymentApprovedEvent> {
  constructor(private readonly completeOrder: CompleteOrderUseCase) {}

  async handle(event: PaymentApprovedEvent): Promise<void> {
    await this.completeOrder.execute({
      merchant_id: event.merchantId,
      session_id: event.sessionId,
      external_order_id: event.externalOrderId,
      order_total: event.orderTotalMajorUnits,
      currency: event.currency,
      accepted_offer_id: event.acceptedOfferId,
    });
  }
}
```

`CheckoutPaymentAdapter` deixa de existir após Onda 3.

### `negotiation.agreement.accepted` → checkout

```ts
@EventsHandler(NegotiationAgreementAcceptedEvent)
export class OnNegotiationAgreementAcceptedHandler implements IEventHandler<NegotiationAgreementAcceptedEvent> {
  constructor(private readonly applyOffer: ApplyOfferUseCase) {}

  async handle(event: NegotiationAgreementAcceptedEvent): Promise<void> {
    await this.applyOffer.execute({
      merchant_id: event.merchantId,
      session_id: event.sessionId,
      offer: event.derivedOffer,
    });
  }
}
```

## Alternativas consideradas

- **Apenas EventBus sem Outbox:** perderíamos garantia at-least-once;
  evento publicado pode ser perdido se o processo cair entre `commit`
  do agregado e `publish` do bus.
- **Kafka direto:** prematuro; adiciona dependência ops ainda não justificada.
- **Workflows (Temporal):** ótimo para sagas longas (ex.: scraping +
  compra), mas overkill para a maior parte dos eventos. Reavaliar quando
  introduzirmos `scraping-agent` e `self-checkout` recompras (Onda 7).

## Consequências

**Positivas:**
- Módulos passam a se comunicar **só** por evento → split futuro fica viável.
- Reprocessamento de eventos (replay) vira recurso natural — útil para
  rebuild de read-models.
- Auditoria por `OutboxMessage` historicizada.

**Negativas:**
- Maior latência percebida para "pagamento aprovado → pedido completo"
  (de chamada síncrona para evento). Mitigação: dispatcher in-process roda
  a cada 100 ms; user-perception ≤ 200 ms.
- Idempotência exige cuidado em todo handler.
- Mais surface para testar (testar dispatcher, lock, DLQ, replay).

## Plano de adoção

- Onda 3 do roadmap. Implementação atrás de feature flag `EVENT_BUS=enabled`.
  Quando `disabled`, fallback para o caminho atual de chamada direta.
- Migrar handlers em ordem: `payment.approved`, `negotiation.agreement.accepted`,
  `order.completed → commerce`, `order.completed → fulfillment`,
  `order.completed → buyer-history`.
- Após 2 sprints com flag ON em prod sem incidente, remover o caminho legado.
