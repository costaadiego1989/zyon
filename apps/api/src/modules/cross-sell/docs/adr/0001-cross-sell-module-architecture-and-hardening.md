# ADR 0001 (cross-sell) — Arquitetura do módulo de cross-sell e hardening de autoridade/integridade de oferta

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Growth), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0004](../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md), [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0007](../../../../../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md), [ADR 0016](../../../../../../docs/architecture/adr/0016-merchant-config-surface-hardening.md), [ADR 0020](../../../../../../docs/architecture/adr/0020-growth-cross-sell-coupons-fulfillment.md). Cross-context: ADR de coupons (mesma quebra de autoridade de desconto), `catalog` (resolução de SKU por tenant) e `rules-engine` (autoridade de desconto e stacking). Baseline: `.specs/maturity/cross-sell.md`.

## Contexto

`cross-sell` é o módulo do contexto **growth** que sugere e aceita ofertas
de cross-sell elegíveis no carrinho. Está classificado **P3 / L1** (ADR
0020): estado crítico provavelmente em memória, sem idempotência/persistência
da DoD L3.

### Responsabilidades e camadas

- **Domínio:** `CrossSellPromotionEntity`, `CrossSellSuggestionEntity`;
  políticas `eligibility.policy` e `stacking.policy` (`evaluateStacking`);
  serviço `cross-sell-recommender.service` (ranking). Eventos em
  `cross-sell-domain-event`.
- **Ports:** `CrossSellPromotionRepository`,
  `CrossSellSuggestionRepository` (escopo por `merchant_id`),
  `OutboxRepository`.
- **Aplicação:** create/update/archive promotion, `ListEligibleCrossSells`,
  `AcceptCrossSellSuggestion`, `DeclineCrossSellSuggestion`; serviço de
  app `cross-sell-product-resolver` (resolve SKU → item de carrinho).
- **Infra:** repositórios in-memory de promotion e suggestion.
- **Apresentação:** `WidgetCrossSellController` (`embed/...`, com
  `EmbedAuthGuard` + `assertSessionBelongsToEmbedMerchant`),
  `MerchantCrossSellController` (admin, hoje `@NonProductionRoute`).

### Fluxos-chave

1. **Suggest (widget):** `findActiveByMerchant` → `rankEligiblePromotions`
   → cria/persiste `CrossSellSuggestionEntity` por promoção elegível →
   outbox `cross-sell.offer.suggested`.
2. **Accept (widget):** `suggestion.accept(accepted_skus)` → persiste →
   outbox `cross-sell.offer.accepted` → controller adiciona itens ao
   `session.cart` via `resolveCrossSellCartItem` e grava o desconto.

### Invariantes que o módulo deve sustentar

- **Desconto só pelo `rules-engine`** (cap + margem); o `computed_discount`
  da promoção não é autoridade.
- **Cap de stacking determinístico**: soma de cross-sell + cupom +
  negociação ≤ `maxDiscountPercent`.
- **Integridade de oferta:** itens aceitos pertencem à sugestão; preços vêm
  do catálogo real do tenant.
- **Toda query escopada por `merchant_id`** (ADR 0005); persistência Prisma
  em runtime (ADR 0004); save + outbox atômicos (ADR 0003).

## Decisão

Manter o desenho hexagonal e corrigir os desvios abaixo. O `computed_discount`
da promoção deixa de ser honrado diretamente e passa por
`evaluateDiscountOffer` do `rules-engine` no accept; o cap de stacking passa
a ser efetivamente aplicado (um único passo de agregação de desconto, de
competência do `rules-engine`, invocado em toda mutação de desconto);
`accepted_skus` é validado como subconjunto da sugestão; e os itens de
cross-sell são resolvidos a partir do catálogo real do tenant, nunca de
tabela hardcoded. Migra para repos Prisma com save+outbox atômico.

## Bugs registrados (root cause + remediação)

### P0 — Desconto de cross-sell aplicado sem autorização do `rules-engine` (contrato)
- **Onde:** `application/use-cases/accept-cross-sell-suggestion.use-case.ts:17-32`;
  origem em `domain/services/cross-sell-recommender.service.ts:18`.
- **Root cause:** `computed_discount` nasce de `promotion.discount_percent` e
  é aceito/emitido sem passar pelo `rules-engine`. `max_discount_percent` é
  armazenado mas nunca enforçado no accept. Mesma quebra do caminho de cupom.
- **Impacto:** promoções autorizam o próprio desconto, furando a fonte única
  de verdade. Promoção mal configurada (até 100%) é honrada sem checagem.
- **Remediação decidida:** submeter o desconto a `evaluateDiscountOffer`
  antes de emitir `cross-sell.offer.accepted`; enforçar
  `max_discount_percent` e margem pelo engine. **Precisa de mudança de
  contrato** (port do `rules-engine` no use-case).

### P0 — Cap de stacking nunca enforçado (`evaluateStacking` é dead code) (funcional)
- **Onde:** `domain/policies/stacking.policy.ts:12-18`; efeito em
  `presentation/http/widget-coupons.controller.ts:53` (no módulo coupons).
- **Root cause:** `evaluateStacking()` — único ponto que soma
  cross-sell + cupom + negociação contra `maxDiscountPercent` — só é
  referenciado por `cross-sell-policies.spec.ts`. Nenhum use-case/controller
  o chama. Enquanto isso o widget de cupom faz
  `currentDiscount = max(existente, aplicado)` (um `max()`, não soma) e
  cross-sell adiciona itens à parte; descontos de motores diferentes nunca
  são totalizados nem capeados.
- **Impacto:** buyer pode empilhar cupom + cross-sell + negociação sem teto
  agregado. Desconto combinado pode exceder `maxDiscountPercent` e levar a
  margem negativa. Viola o invariante de cap determinístico.
- **Remediação decidida:** um único passo de agregação de desconto (de
  competência do `rules-engine`) invocado em toda mutação de desconto, que
  calcula o total corrente entre fontes e rejeita quando `> maxDiscountPercent`;
  ligar `evaluateStacking` (ou o equivalente no engine) ao apply-coupon e ao
  accept-cross-sell. **Precisa de contrato compartilhado** entre coupons,
  cross-sell, negotiation e o `rules-engine`.

### P1 — Produtos de cross-sell resolvidos de CATALOG hardcoded com preço fabricado (dados)
- **Onde:** `application/services/cross-sell-product-resolver.ts:3-66`.
- **Root cause:** `resolveCrossSellCartItem/Product` leem de um `CATALOG`
  de 3 SKUs no módulo e, para SKU desconhecido, fabricam name/price (59,90) e
  cost (24). Não é escopado por merchant nem é o catálogo real.
- **Impacto:** itens entram no carrinho com preços/custos fictícios →
  `roundCartTotal` e a math de margem ficam erradas. Cross-tenant: todo
  merchant compartilha a mesma tabela de 3 SKUs.
- **Remediação decidida:** resolver itens a partir do módulo `catalog`
  escopado por `merchant_id`; rejeitar SKU fora do catálogo do merchant em
  vez de fabricar preço. **Precisa de contrato** (dependência do `catalog`
  por porta/ACL, ADR 0002).

### P1 — Accept não valida que `accepted_skus` pertencem à sugestão (validação)
- **Onde:** `presentation/http/widget-cross-sell.controller.ts:43-54`;
  `CrossSellSuggestionEntity.accept()`.
- **Root cause:** `accept.execute()` e a entidade tomam `accepted_skus`
  verbatim (a entidade sobrescreve `ranked_items` com o que for passado). Não
  há checagem `accepted_skus ⊆ suggestion.ranked_items`. `addCrossSellItems`
  então adiciona esses SKUs ao carrinho.
- **Impacto:** buyer pode aceitar SKUs arbitrários fora da promoção
  (inclusive de outros merchants/promoções) e recebê-los no carrinho ao preço
  do resolver, com o desconto da promoção. Integridade de oferta quebrada.
- **Remediação decidida:** validar subconjunto antes do accept; senão
  `BadRequest`. **Sem mudança de contrato.**

### P1 — State + outbox sem transação compartilhada (dados)
- **Onde:** accept/decline/list-eligible (padrão do contexto).
- **Root cause:** `save(...)` e `appendOutbox(...)` são dois `await`
  separados sem transação.
- **Impacto:** estado sem evento ou evento duplicado no retry — quebra o
  at-least-once do outbox.
- **Remediação decidida:** transactional outbox (save + append atômicos,
  ADR 0003). **Bloqueado até repos Prisma** — amarrado ao ADR de persistência.

### P2 — Accept muta o array do carrinho in place e salva não-atomicamente (concorrência)
- **Onde:** `presentation/http/widget-cross-sell.controller.ts:85-106`.
- **Root cause:** `addCrossSellItems` espalha `session.cart.items` num novo
  array mas faz `existing.quantity += 1` — mutando o `CartItem` compartilhado
  da sessão original. O controller ainda faz accept → saveSession →
  appendChatTurn como três operações com estado, sem atomicidade.
- **Impacto:** mutação aliased corrompe o snapshot da sessão; a sequência
  multi-step pode interleavar com updates concorrentes e perder writes.
- **Remediação decidida:** deep-copy dos itens antes de mutar quantidade;
  consolidar accept + update de carrinho + chat append em um update atômico
  de sessão. **Sem mudança de contrato.**

### P2 — `ListEligibleCrossSells` cria sugestões e eventos duplicados a cada chamada (funcional)
- **Onde:** `application/use-cases/list-eligible-cross-sells.use-case.ts:29-54`.
- **Root cause:** cada invocação cria/persiste nova
  `CrossSellSuggestionEntity` por promoção e emite
  `cross-sell.offer.suggested`, sem dedup contra pendentes da mesma
  sessão/promo.
- **Impacto:** chamadas repetidas de "suggest" (a cada mudança de carrinho)
  acumulam sugestões pendentes e eventos duplicados, inflando métricas e
  deixando linhas pendentes obsoletas.
- **Remediação decidida:** upsert/skip quando já existe sugestão pendente
  para `(session_id, promo_id)`, ou expirar pendentes anteriores antes de
  criar nova. **Sem mudança de contrato.**

## Melhorias para produção

### Segurança
- `MerchantCrossSellController` atrás de JWT de merchant; `merchant_id` do
  principal, nunca do body (ver bug P3 análogo no ADR de coupons).
- Validação de subconjunto de `accepted_skus`.

### Desacoplamento
- Port do `rules-engine` para autorização e agregação de stacking; resolução
  de SKU via ACL para o `catalog` (ADR 0002); cross-sell respeita guardrails
  do agente (ADR 0016).

### Persistência & Consistência
- Repos Prisma (ADR 0004); save + outbox atômicos (ADR 0003); dedup de
  sugestões pendentes; update atômico de sessão no accept.

### Observabilidade
- Métricas de sugestões exibidas/aceitas/recusadas, descontos rejeitados por
  cap/stacking; logs com `correlation_id` + `merchant_id` + `session_id`.

### Otimização & Escala
- Cache de elegibilidade; índices por `merchant_id` e `(session_id, promo_id)`.

### Features faltantes
- Política de stacking unificada de contexto; contract test contra
  `rules-engine` e `catalog`.

## Alternativas consideradas
- **Honrar `computed_discount` da promoção.** Rejeitado: viola autoridade do
  `rules-engine`.
- **Cap de stacking por motor isolado.** Rejeitado: descontos de fontes
  diferentes nunca se somam; precisa de agregação única.
- **Manter `CATALOG` hardcoded.** Rejeitado: preços fictícios e cross-tenant.

## Consequências
**Positivas:** ofertas autorizadas, com integridade de SKU e cap agregado
respeitado; preços do catálogo real.
**Negativas/riscos:** acoplamento de runtime ao `rules-engine` e ao `catalog`
(mitigado por ports); a política de stacking unificada exige coordenação
entre quatro módulos.

**Barra de aceite:** DoD L3 do ADR 0007 + E2E de: desconto rejeitado pelo
`rules-engine`, stacking acima do cap negado, `accepted_skus` fora da
sugestão rejeitado, preço do item vindo do catálogo do tenant e save+outbox
atômicos verdes.
