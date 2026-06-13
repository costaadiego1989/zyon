# ADR 0013 — Commerce: sincronização de pedidos Shopify

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Commerce), Plataforma
- **Relacionado:** [ADR 0002](./0002-acl-pattern-cross-context.md), [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md). Baseline: `.specs/maturity/commerce.md`.

## Contexto

`commerce` faz a sincronização de pedidos com a Shopify. Classificado
**L1, alvo L3, prioridade P1** — o nível mais baixo entre os módulos P1,
o que o torna risco direto para o caminho transacional. A integração
externa deve seguir o padrão ACL (ADR 0002): `shopify-mapping.ts` puro +
adapter fino sobre `HttpClient`. Credenciais Shopify
(`SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`)
vêm de ambiente; sem credencial, o CLAUDE.md exige fallback determinístico
que mantenha o MVP utilizável — mas esse fallback **não pode** valer em
produção (P0.5).

## Decisão

- Subir `commerce` de L1 para L3: sincronização de pedidos **idempotente**
  por id externo Shopify, persistida, com mapping puro testado por contract
  test em sandbox.
- Publicar fatos de pedido por evento/outbox (ADR 0003) para o checkout e
  integrações consumirem.
- Fallback determinístico **apenas** fora de produção; em produção, ausência
  de credencial falha de forma segura (ADR 0009/P0.5).

## Melhorias para produção

### Segurança
- Credenciais Shopify por ambiente e por tenant quando aplicável; nunca em
  log. `merchant_id` do contexto.

### Desacoplamento
- ACL Shopify (`shopify-mapping` + adapter); contextos consomem pedidos só
  por evento/porta.

### Persistência & Consistência
- Idempotência de sync por id externo; reconciliação de pedidos divergentes;
  retry/backoff e semântica de falha parcial documentada.

### Observabilidade
- Métricas de pedidos sincronizados/falhos, latência Shopify, lag de sync;
  alertas de provider indisponível.

### Otimização & Escala
- Sync incremental/paginado; rate limit respeitando limites da Shopify.

### Features faltantes
- Contract test sandbox Shopify; runbook de reprocessamento de sync;
  teste de restart em banco real.

## Alternativas consideradas
- **Sync síncrono sob demanda sem persistência.** Rejeitado: L1 não passa
  na DoD L3 (estado crítico em memória, sem idempotência).
- **Fallback fake também em produção.** Rejeitado por P0.5.

## Consequências
**Positivas:** sincronização confiável e auditável; base para fulfillment
e integrações.
**Negativas/riscos:** depende de sandbox Shopify para contract tests;
salto de maturidade L1→L3 é o maior esforço entre os P1.

**Barra de aceite:** DoD L3 + contract test sandbox e idempotência de sync.
