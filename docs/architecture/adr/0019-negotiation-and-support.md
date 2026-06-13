# ADR 0019 — Negotiation e support

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Produto, Segurança
- **Relacionado:** [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0025](./0025-packages-engines-sdk-hardening.md). Baseline: `.specs/maturity/negotiation.md`, `.specs/maturity/support.md`.

## Contexto

Dois módulos P2, ambos **L2, alvo L3**:

- `negotiation` — sessões de negociação M2M e cost ledger.
- `support` — atendimento/ticket.

Invariantes do CLAUDE.md críticas para `negotiation`: **a oferta/desconto
só é aprovada pelo `rules-engine`** e a matemática de oferta é
determinística (`evaluateDiscountOffer` aplica hard-cap de
`maxDiscountPercent`, rejeita abaixo de `minimumMarginPercent`, margem usa
`cost` do item ou default 50%, fee de pagamento 4%). O LLM nunca autoriza.
`negotiation` emite `negotiation.agreement.accepted` que o checkout consome
por evento (ADR 0003). O cost ledger é estado financeiro — **não pode ficar
só em memória** (DoD L3). `support` cria `support.ticket.created` consumido
por integrations.

## Decisão

- Levar ambos a L3. `negotiation`: sessões e **cost ledger persistidos**,
  decisão de desconto delegada ao `rules-engine` (ADR 0025), acordo
  publicado por outbox durável (ADR 0009). `support`: tickets persistidos,
  emissão de evento idempotente.

## Melhorias para produção

### Segurança
- `merchant_id` do contexto; nenhuma concessão fora do `rules-engine`;
  mensagens geradas validadas por `isSafeGeneratedMessage` com fallback
  determinístico.

### Desacoplamento
- `PersistenceModule` (P0.2); comunicação com checkout só por evento;
  `support`→`integrations` por evento.

### Persistência & Consistência
- Cost ledger e sessões persistidos; idempotência de aceite de acordo;
  ledger + outbox atômicos.

### Observabilidade
- Métricas de sessões, acordos aceitos/recusados, custo por intervenção;
  tickets criados/resolvidos.

### Otimização & Escala
- Limite de rodadas de negociação; paginação de tickets.

### Features faltantes
- Reconciliação do cost ledger; SLA/roteamento de tickets; runbook de
  replay de acordo.

## Alternativas consideradas
- **Desconto decidido na negociação/chat.** Rejeitado: viola invariante;
  só o `rules-engine` aprova.
- **Cost ledger em memória.** Rejeitado: estado financeiro crítico.

## Consequências
**Positivas:** negociação determinística e auditável; suporte integrado.
**Negativas/riscos:** ledger persistido exige reconciliação e runbook.

**Barra de aceite:** DoD L3 + testes de hard-cap/margem, aceite idempotente
e mensagem segura.
