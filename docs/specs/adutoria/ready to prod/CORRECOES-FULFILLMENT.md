# API-029 — Rastreamento, transição e outbox atômicos

Implementado localmente em `master`, em 2026-09-07.

`RecordTrackingEventUseCase` agora prepara uma única observação do carrier e a
persiste por uma porta transacional. A implementação Prisma atualiza o
`Shipment`, grava o `TrackingEvent` e cria os eventos de outbox na mesma
transação. Se qualquer uma dessas gravações falhar, o status do envio e os
eventos são desfeitos juntos.

O identificador do tracking e os IDs de outbox são derivados do conteúdo lógico
do callback. Um reenvio idêntico do carrier converge para a mesma observação e
para os mesmos eventos, sem depender de UUIDs ou do instante de retry. O
evento `shipment.delivered` deixa de ser publicado antes do commit: o dispatcher
da outbox passa a acionar o handler após a persistência durável.

Validação executada:

- `node --loader ./tests/ready-prod-loader.mjs --test ./src/modules/fulfillment/application/use-cases/record-tracking-event.use-case.spec.ts ./src/modules/fulfillment/application/use-cases/fulfillment.use-cases.spec.ts ./src/modules/fulfillment/presentation/http/tracking-webhook.controller.spec.ts ./src/modules/fulfillment/application/use-cases/cancel-shipment.use-case.spec.ts ./src/modules/fulfillment/domain/events/fulfillment-domain-event.spec.ts` — 43 testes passaram.
- `pnpm --filter @zyon/api build` — passou.

Não foi executado o teste de rollback e concorrência em PostgreSQL descartável,
pois Docker não está disponível neste ambiente. O status é
`IMPLEMENTED_LOCAL_VALIDATION`; o gate de produção continua aberto até validar a
transação e o consumo do outbox em banco real.
