# ADR 0017 — Integrations: API keys e webhooks de saída

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Integrations), Segurança, Plataforma
- **Relacionado:** [ADR 0002](./0002-acl-pattern-cross-context.md), [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0024](./0024-dashboard-config-preview-onboarding.md). Baseline: `.specs/maturity/integrations.md`.

## Contexto

`integrations` provê API keys de merchant e webhooks de saída para
sistemas externos do tenant. Classificado **L2, alvo L3, prioridade P2**.
Estado verificado (`apps/api/src/modules/integrations/`):

- `domain/api-key.service.ts`, `domain/webhook-signature.service.ts`;
- `application/webhook-delivery-dispatcher.service.ts`;
- `presentation/http/integrations.controller.ts`, `merchant-api-key.guard.ts`,
  `tenant-tracking.controller.ts`;
- `infrastructure/event-handlers/tenant-webhooks-on-checkout.handler.ts`;
- eventos publicados visíveis no dashboard
  (`apps/dashboard/src/pages/integrations-page.tsx`): `order.approved`,
  `customer.upserted`, `order.tracking.updated`, `payment.failed`,
  `support.ticket.created`, `checkout.abandoned`.

A entrega de webhook é um caminho de **at-least-once com idempotência e
DLQ** — precisa da outbox durável (ADR 0009/0003) para não perder fatos.

## Decisão

- Levar `integrations` a L3: API keys com escopo, hash em repouso e
  rotação; webhooks de saída **assinados**, com retry/backoff, DLQ e
  idempotência por entrega.
- Entrega dirigida por evento da outbox durável (ADR 0009); nenhuma fila de
  entrega só em memória.
- Adapter de entrega via ACL com timeout e verificação de endpoint do
  tenant.

## Melhorias para produção

### Segurança
- API key hasheada (nunca em claro após criação); escopos mínimos
  (`embed:sessions:create`, `orders:tracking:write`, ...); assinatura HMAC
  de webhook; `merchant_id` do contexto; sem segredo em log.

### Desacoplamento
- Consumo de fatos só por evento; `PersistenceModule` (P0.2); ACL de
  entrega HTTP.

### Persistência & Consistência
- Fila de entrega persistida; idempotência por id de entrega; DLQ + replay;
  estado de endpoint (ativo/falho) persistido.

### Observabilidade
- Métricas de entregas, falhas, latência por endpoint, profundidade de DLQ;
  log de tentativa com `correlation_id` + `merchant_id`.

### Otimização & Escala
- Backoff exponencial; circuit breaker por endpoint; limite de
  concorrência de entrega por tenant.

### Features faltantes
- Reentrega manual e visualização de DLQ no dashboard (ADR 0024);
  rotação de API key; contract test do dispatcher.

## Alternativas consideradas
- **Entrega síncrona no handler de evento.** Rejeitado: acopla e perde em
  falha do endpoint; usamos fila persistida + DLQ.
- **API key em claro no banco.** Rejeitado: vazamento crítico.

## Consequências
**Positivas:** integração de saída confiável, auditável e isolada por
tenant.
**Negativas/riscos:** DLQ exige runbook e UI de reentrega.

**Barra de aceite:** DoD L3 + E2E de entrega duplicada, endpoint
indisponível e DLQ/replay.
