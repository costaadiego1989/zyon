# ADR 0001 (shipping) — Shipping: cotação, subsídio de frete e rotas embed

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Shipping), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0012](../../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0014](../../../../../../../docs/architecture/adr/0014-shipping-engine-hardening.md), [ADR 0022](../../../../../../../docs/architecture/adr/0022-widget-transactional-path.md). Invariantes: `CLAUDE.md` (subsídio de frete só pelo `shipping-engine`; `merchant_id` de tenant; matemática determinística).

## Contexto

O módulo `shipping` cota frete para o checkout/widget e persiste a cotação
para reuso. Responsabilidades atuais:

- **Use-cases:** `QuoteShippingUseCase` (monta `quoteKey` via
  `@zyon/shipping-engine`, consulta cache por chave, dispara transportadoras
  em `Promise.allSettled`, aplica política de frete grátis, persiste via
  `saveWithEvents`) e `SelectShippingMethodUseCase`.
- **Portas:** `CARRIER_ADAPTERS` (lista de `CarrierPort`),
  `SHIPPING_QUOTE_REPOSITORY`, `MERCHANT_RULES_REPOSITORY` (origem das regras
  do lojista, ex.: `originZip`, `freeShippingMinCartValue`, `allowFreeShipping`).
- **Adapters:** `MelhorEnvioCarrierAdapter` (live) e `FlatRateCarrierAdapter`
  (fallback). A ordem registrada é `[melhorEnvio, flat]`.
- **Domínio:** `ShippingQuoteEntity` (resultados, `selectCarrier` por
  `carrier_key`), `applyFreeShippingPolicy`.
- **Controllers:** `EmbedShippingController` (autenticado por
  `EmbedAuthGuard`, deriva `merchant_id` do token e valida posse da sessão) e
  `WidgetShippingController` legado (`@NonProductionRoute`, confia
  `merchant_id` do body).

Invariantes que o módulo deve sustentar: o **subsídio de frete só pode ser
aprovado pelo `shipping-engine`/regras do lojista**, nunca pelo cliente;
toda consulta é escopada por `merchant_id` (ADR 0005); a matemática da
cotação é determinística e estável na ordenação.

Estado verificado: a `freeShippingMinCartValue` do lojista é buscada
(`originZip` é usado) mas o threshold de frete grátis aplicado vem do
request; duas controllers registram o mesmo path `embed/shipping`.

## Decisão

Endurecer o caminho de cotação para respeitar as invariantes:

- o threshold de frete grátis é **sempre derivado do servidor** a partir de
  `MerchantRulesRepository` (`freeShippingMinCartValue` + `allowFreeShipping`),
  nunca do body; o `shipping-engine`/regras do lojista são a única autoridade
  de subsídio;
- a rota `embed/shipping` é servida por **uma única controller autenticada**
  em todos os ambientes;
- a política de frete grátis **muta os resultados existentes** em vez de
  anexar linhas paralelas, mantendo `carrier_key` único no conjunto final;
- falhas de transportadora são **observáveis** (log + métrica), não engolidas.

## Bugs registrados nesta análise

### P0 — Threshold de frete grátis vem do request, contornando shipping-engine/regras do lojista
- **Classificação:** segurança. **Precisa de mudança de contrato/migração:** sim (parar de aceitar `free_shipping_threshold` do cliente).
- **Arquivos:** `presentation/http/embed-shipping.controller.ts:55`,
  `presentation/http/widget-shipping.controller.ts:17-19`,
  `application/use-cases/quote-shipping.use-case.ts:77-84`.
- **Causa-raiz:** ambas as controllers repassam `body.free_shipping_threshold`
  direto para `QuoteShippingUseCase`, que aplica `applyFreeShippingPolicy()`
  zerando preços quando `cart_total >= threshold`. O valor autoritativo
  `rules.freeShippingMinCartValue` é carregado mas o threshold em si nunca é
  originado das regras. Um chamador envia `free_shipping_threshold: 0` e
  recebe frete zero em qualquer carrinho.
- **Impacto:** comprador/agente se auto-autoriza frete grátis em qualquer
  carrinho — viola "subsídios de frete aprovados só pelo `shipping-engine`" e
  a regra `freeShippingMinCartValue`. Perda direta de margem.
- **Remediação decidida:** ignorar `free_shipping_threshold` do cliente;
  derivar server-side de `MerchantRulesRepository` (`allowFreeShipping`
  habilita; `freeShippingMinCartValue` define o piso) e passar esse valor ao
  use-case. Manter a política do `shipping-engine` como única autoridade.

### P0 — Rota `embed/shipping` duplicada: controller não autenticada colide com a autenticada
- **Classificação:** contrato. **Precisa de mudança de contrato/migração:** sim (paths/registro de controllers).
- **Arquivos:** `shipping.module.ts:20`,
  `presentation/http/widget-shipping.controller.ts:7-9`,
  `presentation/http/embed-shipping.controller.ts:31-33`.
- **Causa-raiz:** as duas controllers registram `POST embed/shipping/quote` e
  `/select`. `WidgetShippingController` não tem `EmbedAuthGuard` e confia no
  `merchant_id` do body; `EmbedShippingController` exige token embed + posse
  da sessão. O Express resolve o primeiro handler registrado, então a widget
  não autenticada sombreia a segura em não-produção. Em produção a widget é
  bloqueada com 404 pelo `NonProductionRouteGuard`, então o path resolve para
  404 em vez de cair na controller embed.
- **Impacto:** não-prod — qualquer chamador cota/seleciona frete para um
  `merchant_id` arbitrário sem auth nem posse de sessão (bypass de fronteira de
  tenant, agrava o P0 de frete grátis). Prod — `embed/shipping` retorna 404,
  quebrando o contrato de frete do storefront.
- **Remediação decidida:** dar paths distintos às duas controllers (ex.: widget
  sob prefixo dev-only) ou remover a `WidgetShippingController` legada.
  Garantir que a controller embed autenticada seja dona de `embed/shipping` em
  todos os ambientes.

### P2 — Política de frete grátis anexa entradas duplicadas; seleção escolhe a paga
- **Classificação:** funcional. **Precisa de ADR:** não (registrado aqui por proximidade).
- **Arquivos:** `application/use-cases/quote-shipping.use-case.ts:78-86`,
  `domain/policies/free-shipping.policy.ts`,
  `domain/entities/shipping-quote.entity.ts:82`.
- **Causa-raiz:** `applyFreeShippingPolicy` mapeia todo resultado para
  `price 0`/`is_free true`; o filtro então anexa essas variantes grátis ao lado
  das pagas originais (mesmo `carrier_key`). Não há dedupe após esse segundo
  `addResults`, então a cotação guarda uma linha paga e uma grátis por
  transportadora. `ShippingQuoteEntity.selectCarrier` usa `.find` por
  `carrier_key` e retorna a primeira (paga).
- **Impacto:** carrinho elegível continua sendo cobrado; opções duplicadas;
  ordenação não-determinística após o append.
- **Remediação decidida:** aplicar frete grátis **mutando** os resultados
  existentes (ou substituir+re-dedupe) em vez de anexar linhas paralelas;
  garantir `carrier_key` único no conjunto final.

### P3 — Falhas de cotação de transportadora silenciosamente engolidas
- **Classificação:** observabilidade. **Precisa de ADR:** não.
- **Arquivos:** `infrastructure/adapters/melhor-envio.carrier.ts:65,79-81`,
  `application/use-cases/quote-shipping.use-case.ts:55-72`.
- **Causa-raiz:** `MelhorEnvio` retorna `[]` em qualquer não-OK/timeout/parse
  sem log nem métrica; `quote-shipping` descarta resultados rejeitados do
  `allSettled` sem registrá-los. Usa `fetch` cru em vez do
  `HttpClientService` compartilhado.
- **Remediação decidida:** logar + emitir métrica na falha da transportadora e
  nas entradas rejeitadas do `allSettled`; rotear a chamada pelo
  `HttpClientService` para timeout/retry/observabilidade consistentes.

### P3 — Cotação reusada retorna snapshot de outra sessão (vazamento de `session_id`)
- **Classificação:** dado. **Precisa de ADR:** não.
- **Arquivos:** `application/use-cases/quote-shipping.use-case.ts:36-39`,
  `infrastructure/repositories/prisma-shipping-quote.repository.ts:64-75`.
- **Causa-raiz:** `findValidByKey` casa por `(quoteKey, merchantId)` e retorna
  a cotação mais recente independentemente de `session_id`; o snapshot
  retornado carrega o `session_id` original, que pode pertencer a outro
  comprador do mesmo lojista.
- **Impacto:** baixo (mesmo tenant, sem PII no snapshot), mas é vazamento de
  identificador entre sessões e um *smell* de correção em leituras escopadas
  por sessão.
- **Remediação decidida:** incluir `session_id` na chave de reuso, ou
  remover/rebindar o `session_id` à sessão solicitante ao retornar reuso.

## Melhorias para produção

### Segurança
- Threshold de frete grátis sempre server-side; `merchant_id` sempre do token
  embed, nunca do body (ADR 0005/0009/0012). Uma só rota `embed/shipping`
  autenticada.

### Desacoplamento
- Transportadoras via `HttpClientService` compartilhado; subsídio
  exclusivamente pelo `shipping-engine` (ADR 0014).

### Persistência & Consistência
- `findValidByKey` com semântica de escopo de sessão documentada; conjunto de
  resultados sem `carrier_key` duplicado.

### Observabilidade
- Log + métrica por falha/timeout de transportadora e por degradação para
  fallback; `correlation_id` + `merchant_id` + `session_id`.

### Otimização & Escala
- Cache de cotação determinístico e estável; TTL revisado.

### Features faltantes
- Métricas de taxa de fallback por transportadora; teste de regressão de
  subsídio com regras do lojista.

## Alternativas consideradas
- **Manter `free_shipping_threshold` no contrato como override do cliente.**
  Rejeitado: viola a invariante de subsídio (CLAUDE.md / ADR 0014).
- **Manter as duas controllers e desambiguar por ordem de registro.**
  Rejeitado: frágil e dependente do Express; mascara o bypass de auth.

## Consequências
**Positivas:** subsídio confiável e auditável; rota embed única e segura;
cotações determinísticas. **Negativas/riscos:** mudança de contrato do widget
(remoção de `free_shipping_threshold`); necessidade de migração de chamadores
legados.

**Barra de aceite:** E2E de frete grátis dirigido por regras do lojista verde;
cross-tenant negado em `embed/shipping`; cotação sem `carrier_key` duplicado;
seleção resolve para a linha grátis quando elegível; falha de transportadora
gera métrica.
