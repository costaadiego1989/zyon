# ADR 0014 — Shipping: cotação, subsídio e persistência

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Shipping), Plataforma
- **Relacionado:** [ADR 0002](./0002-acl-pattern-cross-context.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0025](./0025-packages-engines-sdk-hardening.md). Baseline: `.specs/maturity/shipping.md`.

## Contexto

`shipping` cobre cotação de frete e subsídios. Classificado **L1, alvo L3,
prioridade P1**. Invariante do CLAUDE.md: **subsídio de frete só é aprovado
pelo `shipping-engine`** (pacote puro); o LLM/chat nunca concede frete. A
DoD L3 proíbe **cotação crítica somente em memória**. Integração externa
(ex.: ViaCEP) segue ACL (ADR 0002). Controllers de shipping estão na lista
de rotas a proteger (P0.7).

## Decisão

- Subir `shipping` de L1 a L3: cotações **persistidas** com validade
  (quote expiry), determinísticas e idempotentes por chave de
  endereço/itens.
- Decisão de subsídio centralizada no `shipping-engine` (ADR 0025);
  resultado consumido pelo checkout via porta/evento.
- Adapter de provider de CEP/transportadora via ACL com timeout/retry e
  fallback determinístico apenas fora de produção (P0.5).

## Melhorias para produção

### Segurança
- `merchant_id` do contexto; proteger/desabilitar controllers legados de
  shipping (P0.7); nunca conceder subsídio fora do `shipping-engine`.

### Desacoplamento
- ACL de provider; checkout consome cotação/subsídio por porta/evento.

### Persistência & Consistência
- Cotação persistida com expiração; idempotência por chave;
  reuso de cotação válida; semântica de recotação documentada.

### Observabilidade
- Métricas de cotações, hit/miss de cache, subsídios aplicados, latência
  do provider.

### Otimização & Escala
- Cache de cotação por chave com TTL; rate limit no provider externo.

### Features faltantes
- Configuração de regras de subsídio por tenant (dashboard, ADR 0024);
  contract test sandbox do provider de CEP.

## Alternativas consideradas
- **Cotação só em memória por request.** Rejeitado: viola DoD L3 (quote
  crítica em memória) e impede reuso/auditoria.
- **Subsídio decidido no chat.** Rejeitado: viola invariante do CLAUDE.md.

## Consequências
**Positivas:** frete determinístico, auditável e isolado por tenant.
**Negativas/riscos:** expiração de cotação exige sincronização com o
widget de frete (ADR 0022).

**Barra de aceite:** DoD L3 + testes de quote expirada, idempotência e
subsídio exclusivo do engine.
