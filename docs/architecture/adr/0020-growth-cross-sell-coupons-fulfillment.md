# ADR 0020 — Growth e logística: cross-sell, coupons e fulfillment

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Produto, Plataforma
- **Relacionado:** [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0013](./0013-commerce-shopify-sync-hardening.md). Baseline: `.specs/maturity/cross-sell.md`, `.specs/maturity/coupons.md`, `.specs/maturity/fulfillment.md`.

## Contexto

Três módulos **P3** (só fechar após o caminho P1 estar em L3, ADR 0007):

- `cross-sell` — **L1**, ofertas de cross-sell elegíveis.
- `coupons` — **L1**, cupons do merchant.
- `fulfillment` — **L1**, tracking/entrega (webhook de tracking).

Os três têm controllers na lista de rotas a proteger (P0.7) e estão em L1
(estado crítico provavelmente em memória, sem idempotência/persistência
exigidas pela DoD L3). `coupons` envolve **cupom**, item explicitamente
citado pela DoD como não podendo existir só em memória.

## Decisão

- Fechar a L3 **após P1**, sem atrasar bloqueios P0/P1. Cupons e
  elegibilidade de cross-sell **persistidos** e idempotentes; tracking de
  fulfillment idempotente por webhook e dirigido por evento (ADR 0003).

## Melhorias para produção

### Segurança
- Proteger/desabilitar controllers legados (P0.7); `merchant_id` do
  contexto; verificação de assinatura do webhook de tracking
  (`tracking-webhook.controller.ts`).

### Desacoplamento
- `PersistenceModule` (P0.2); consumo de pedidos por evento (ADR 0013);
  cross-sell respeita guardrails do agente (ADR 0016).

### Persistência & Consistência
- Cupom persistido com regras de uso/limite/idempotência de resgate;
  elegibilidade de cross-sell reconstruível; tracking idempotente por
  evento.

### Observabilidade
- Métricas de cupons resgatados, cross-sell exibido/aceito, eventos de
  tracking; profundidade de fila.

### Otimização & Escala
- Cache de elegibilidade; paginação de tracking; rate limit do webhook.

### Features faltantes
- Regras de cupom configuráveis por tenant (ADR 0024); reconciliação de
  tracking; contract test do provider de tracking.

## Alternativas consideradas
- **Antecipar P3 antes de P1.** Rejeitado pelo ADR 0007 (ordem de
  fechamento).
- **Cupom em memória.** Rejeitado pela DoD L3.

## Consequências
**Positivas:** growth/logística confiáveis sobre base P1 estável.
**Negativas/riscos:** salto L1→L3; não deve consumir capacidade dos P0/P1.

**Barra de aceite:** DoD L3 + idempotência de resgate de cupom e de webhook
de tracking.
