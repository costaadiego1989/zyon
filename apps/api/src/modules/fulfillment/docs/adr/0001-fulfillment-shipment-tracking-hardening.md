# ADR 0001 (fulfillment) — Fulfillment: criação idempotente de envio e ingestão de tracking

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Fulfillment), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0014](../../../../../../../docs/architecture/adr/0014-shipping-engine-hardening.md), [ADR 0020](../../../../../../../docs/architecture/adr/0020-growth-cross-sell-coupons-fulfillment.md). Invariantes: `CLAUDE.md` (idempotência sob entrega at-least-once; `merchant_id` em toda query; Prisma como única persistência).

## Contexto

O módulo `fulfillment` cria envios a partir de `order.completed` e ingere
eventos de tracking das transportadoras. Responsabilidades atuais:

- **Use-cases:** `CreateShipmentUseCase` (cria `ShipmentEntity`, persiste,
  anexa `shipment.created` à outbox), `RecordTrackingEventUseCase`
  (`shipment.transition`), `CancelShipmentUseCase`.
- **Event handler:** `FulfillmentOnOrderCompletedHandler` assina
  `order.completed` no `DomainEventBus` em memória.
- **Portas/repos:** `ShipmentRepository` (`findById`/`findByOrderId` exigem
  `merchantId`; `findByTrackingCode` é global), `TrackingEventRepository`,
  ambos com implementação Prisma.
- **Controller:** `TrackingWebhookController` (`@NonProductionRoute`,
  `POST webhooks/tracking/:carrier`).
- **Domínio:** `ShipmentEntity` com `LEGAL_TRANSITIONS` e `dispatched_at`.

Invariantes que o módulo deve sustentar: consumidores **idempotentes** sob
entrega at-least-once (ADR 0003); toda query escopada por `merchant_id`
(ADR 0005); transições de status válidas; persistência só via Prisma.

## Decisão

Tornar a criação de envio e a ingestão de tracking corretas sob fan-out de
eventos e redelivery:

- `CreateShipmentUseCase` é **idempotente por `(merchant_id, order_id)`** —
  consulta `findByOrderId` e faz no-op se já existir; a chave do envio é
  determinística por pedido;
- o dispatcher rastreia processamento **por `(handler, event_id)`** para que
  um handler que falha não re-execute handlers já bem-sucedidos;
- o webhook de tracking é **autenticado e verificado por assinatura** por
  transportadora, com `merchant_id` derivado da linha do envio resolvida, e
  promovido a rota de produção;
- `findByTrackingCode` passa a ser **escopado por `merchant_id`**;
- resends de mesmo status são **no-op**; só transições genuinamente ilegais
  retornam 4xx;
- `dispatched_at` é **persistido e rehidratado**;
- o carrier selecionado pelo comprador é **propagado** ao envio.

## Bugs registrados nesta análise

### P1 — Criação de envio não é idempotente sob outbox at-least-once e fan-out de handlers
- **Classificação:** concorrência. **Precisa de mudança de contrato/migração:** sim (chave determinística + dedup por handler).
- **Arquivos:** `application/use-cases/create-shipment.use-case.ts:14-31`,
  `infrastructure/event-handlers/on-order-completed.handler.ts`,
  `../../../shared/messaging/outbox-dispatcher.service.ts:43-73`.
- **Causa-raiz:** o `OutboxDispatcher` publica um evento no bus em memória onde
  múltiplos handlers rodam (fulfillment + coupons assinam `order.completed`).
  O dedup (`isProcessed`) é por `event_id` apenas; se **qualquer** handler
  lançar, o evento inteiro é re-tentado e re-publicado a **todos** os handlers.
  `CreateShipmentUseCase` sempre gera um novo `shipment.id` (UUID aleatório)
  sem verificação de idempotência por pedido, então redelivery cria envios
  duplicados e o handler de cupom re-concede.
- **Impacto:** envios duplicados por pedido e concessões de cupom duplicadas
  sempre que algum assinante falhar transitoriamente.
- **Remediação decidida:** em `CreateShipmentUseCase` consultar
  `findByOrderId(merchant_id, order_id)` e no-op se existir; dar ao envio
  chave determinística por `(merchant_id, order_id)`. Rastrear processamento
  por `(handler, event_id)` no dispatcher.

### P1 — Webhook de tracking não autenticado/spoofável e desabilitado em produção
- **Classificação:** segurança. **Precisa de mudança de contrato/migração:** sim (assinatura por transportadora + promoção a rota de prod).
- **Arquivos:** `presentation/http/tracking-webhook.controller.ts:8-9,17-40`.
- **Causa-raiz:** sem verificação de assinatura/HMAC e sem guard além de
  `@NonProductionRoute`. As transições de status são dirigidas inteiramente
  pelo body (`body.merchant_id`, `body.status`), e o envio é localizado por
  `tracking_code` não escopado. O `NonProductionRouteGuard` retorna 404 em
  produção a menos de `ENABLE_LEGACY_ROUTES`, então webhooks reais de
  transportadora não podem ser entregues em prod.
- **Impacto:** não-prod — quem conhecer/adivinhar um `tracking_code` dirige o
  status do envio (ex.: marcar entregue), corrompendo estado de fulfillment e
  eventos downstream. Prod — ingestão de tracking offline (404); status nunca
  avança por callback.
- **Remediação decidida:** verificação de assinatura por transportadora;
  derivar `merchant_id` da linha do envio resolvida (não do body); promover a
  rota de produção autenticada em vez de `@NonProductionRoute`.

### P2 — `findByTrackingCode` não escopado por `merchant_id`
- **Classificação:** segurança. **Precisa de mudança de contrato/migração:** sim (assinatura da porta).
- **Arquivos:** `infrastructure/repositories/prisma-shipment.repository.ts:62-70`,
  `domain/ports/shipment-repository.port.ts:9`.
- **Causa-raiz:** diferente de `findById`/`findByOrderId` (que exigem
  `merchantId`), `findByTrackingCode` faz lookup global sem predicado de
  tenant. O webhook de tracking o usa antes de estabelecer contexto de tenant.
- **Impacto:** viola a invariante de fronteira de tenant ("toda query escopada
  por `merchant_id`") e é o ponto de entrada não escopado explorado pelo
  webhook não autenticado.
- **Remediação decidida:** adicionar `merchantId` à porta/método e escopar a
  query; resolver o contexto de merchant a partir de um webhook autenticado
  antes do lookup.

### P2 — Criação de envio fixa `carrier_key` 'flat-rate', descartando o carrier selecionado
- **Classificação:** dado. **Precisa de ADR:** não (registrado aqui).
- **Arquivos:** `infrastructure/event-handlers/on-order-completed.handler.ts:20-24`.
- **Causa-raiz:** o payload de `order.completed` não carrega o carrier de frete
  selecionado e o handler fixa `'flat-rate'`. O carrier escolhido via
  `SelectShippingMethodUseCase`/persistido na sessão de checkout nunca é
  propagado ao envio.
- **Impacto:** todo envio é criado como flat-rate independentemente do carrier
  que o comprador escolheu (ex.: `melhor-envio-1`). Carrier errado em
  etiquetas, tracking e fulfillment downstream.
- **Remediação decidida:** incluir `selected_carrier_key` no payload de
  `order.completed` (ou buscá-lo da sessão/cotação no handler) e passá-lo a
  `CreateShipmentUseCase`.

### P2 — `RecordTrackingEvent` lança `INVALID_TRANSITION` em resends de mesmo status
- **Classificação:** runtime. **Precisa de ADR:** não.
- **Arquivos:** `application/use-cases/record-tracking-event.use-case.ts:30-31`,
  `domain/entities/shipment.entity.ts:64-68` (`LEGAL_TRANSITIONS` `delivered:[]`).
- **Causa-raiz:** transportadoras reenviam o mesmo status (ex.: `delivered`)
  várias vezes. `transition()` lança quando o alvo não está em
  `LEGAL_TRANSITIONS`, incluindo auto-transições e saídas de estados
  terminais. O use-case não captura, então vira 500.
- **Impacto:** callbacks duplicados/terminais produzem 500, fazendo
  transportadoras re-tentarem e perdendo eventos de tracking. Ingestão não
  idempotente.
- **Remediação decidida:** tratar mesmo-status como no-op (registrar o evento,
  pular a transição) e rejeitar só transições genuinamente ilegais com 4xx em
  vez de throw não tratado.

### P3 — `dispatched_at` é setado pela entidade mas nunca persistido (null no rehydrate)
- **Classificação:** dado. **Precisa de ADR:** não.
- **Arquivos:** `infrastructure/repositories/prisma-shipment.repository.ts:12-39,87-104`.
- **Causa-raiz:** `ShipmentEntity.transition` seta `dispatched_at` no status
  `dispatched`, mas o mapping Prisma nem escreve nem lê a coluna; `toSnapshot`
  fixa `null`.
- **Impacto:** timestamp de despacho perdido na persistência — qualquer
  read-model/métrica de SLA por tempo de despacho fica sempre null.
- **Remediação decidida:** persistir `dispatchedAt` no upsert e mapeá-lo de
  volta em `toSnapshot` (adicionar a coluna no `schema.prisma` se faltar).

### P3 — `CreateShipment` confunde `sessionId` e `externalOrderId` na persistência
- **Classificação:** dado. **Precisa de ADR:** não.
- **Arquivos:** `infrastructure/repositories/prisma-shipment.repository.ts:16-24`.
- **Causa-raiz:** `ShipmentEntity` só tem `order_id`; o repo escreve o mesmo
  valor em `sessionId` e `externalOrderId`. O handler de `order.completed`
  passa `external_order_id` como `order_id`, então `sessionId` recebe um id de
  pedido.
- **Impacto:** a coluna `sessionId` guarda um identificador de pedido; qualquer
  join/lookup ou constraint única em `sessionId` fica errado e a ligação real
  com a sessão de checkout se perde.
- **Remediação decidida:** carregar `session_id` e `external_order_id` no
  agregado de envio e mapear cada um à sua coluna.

## Melhorias para produção

### Segurança
- Webhook de tracking autenticado/assinado; `merchant_id` derivado da linha do
  envio (ADR 0005/0009). `findByTrackingCode` escopado por tenant.

### Desacoplamento
- `order.completed` carrega o carrier selecionado; fulfillment não fixa
  `flat-rate` (ADR 0014).

### Persistência & Consistência
- Idempotência por `(merchant_id, order_id)`; dedup por `(handler, event_id)`
  (ADR 0003); persistir `dispatched_at`; separar `sessionId`/`externalOrderId`.

### Observabilidade
- Logs estruturados com `correlation_id` + `merchant_id` + `shipment_id`;
  métricas de envios criados, transições e backlog de tracking.

### Otimização & Escala
- Constraint única por `(merchant_id, order_id)`; índice por `tracking_code`
  escopado.

### Features faltantes
- Runbook de reprocessamento de webhook; reconciliação envio↔pedido↔carrier.

## Alternativas consideradas
- **Dedup só por `event_id` no dispatcher.** Rejeitado: re-publica a todos os
  handlers quando um falha, quebrando idempotência (ADR 0003).
- **Manter o webhook como `@NonProductionRoute`.** Rejeitado: deixa a ingestão
  de tracking offline em produção.

## Consequências
**Positivas:** envios e tracking idempotentes e auditáveis; ingestão de
tracking viável em produção. **Negativas/riscos:** mudança de assinatura de
porta (`findByTrackingCode`) e de schema (`dispatchedAt`, `sessionId`);
necessidade de coordenar com `coupons` o dedup por handler.

**Barra de aceite:** E2E de `order.completed` duplicado sem envio/cupom
duplicado; resend de `delivered` retorna 2xx no-op; webhook com assinatura
inválida negado; cross-tenant em `findByTrackingCode` negado; `dispatched_at`
persistido e rehidratado.

