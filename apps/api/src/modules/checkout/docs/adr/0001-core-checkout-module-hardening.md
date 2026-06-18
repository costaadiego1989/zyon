# ADR 0001 (checkout) — Core-checkout: arquitetura e hardening do módulo

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Checkout), Segurança, Plataforma
- **Relacionado:** ADR central [0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md) (outbox), [0004](../../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md) (Prisma), [0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md) (tenant), [0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md) (P0 plataforma), [0010](../../../../../../../docs/architecture/adr/0010-checkout-pilot-path-hardening.md) (caminho transacional do piloto), [0014](../../../../../../../docs/architecture/adr/0014-shipping-engine-hardening.md) (shipping-engine), [0018](../../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md) (histórico de compra), [0025](../../../../../../../docs/architecture/adr/0025-packages-engines-sdk-hardening.md) (engines/shared-types). ADR irmão: [checkout-settings 0002](../../../checkout-settings/docs/adr/0002-checkout-settings-module-hardening.md).

## Contexto

`checkout` é o núcleo transacional da AACP: sessão de checkout, eventos,
scoring de abandono, chat assistido por IA, ofertas (desconto/frete) e o
read-model do dashboard. É o agregado mais quente do sistema durante uma
compra ativa.

**Responsabilidades.** Materializa a `CheckoutSession` (carrinho, cliente,
frete, score, histórico de chat), avalia e aplica ofertas, registra eventos
operacionais, conclui pedidos (`CompleteOrderUseCase`) e projeta o dashboard.
Consome `payment.approved` por evento (ADR 0003) e emite `order.completed`,
`checkout.*` e `whatsapp.message.requested` pela outbox.

**Portas (domain/ports).** `CheckoutSessionRepository`, `OfferRepository`,
`OrderRepository`, `DashboardReadModel`, `CommerceOfferPort`,
`AgentContextPort`, `CheckoutSettingsPort`, `CheckoutInterventionLedgerPort`,
`ConversationPort`, `PurchaseHistoryPort`. A infra Prisma
(`PrismaCheckoutRepository`) implementa as quatro primeiras via um único
provider (`CHECKOUT_REPOSITORY` reusado por `useExisting`).

**Fluxos-chave.** start-checkout → track-event (scoring + gate de
intervenção pelo `checkout-settings` + ledger) → chat → evaluate-shipping
(via `@aacp/shipping-engine`) → offers/apply → orders/complete (commit
atômico do agregado + outbox; side-effects pós-commit).

**Invariantes que o módulo deve sustentar (CLAUDE.md).**
1. `merchant_id` é a fronteira de tenant — derivado do principal, nunca do body.
2. A LLM nunca autoriza ofertas.
3. Desconto só é autorizado pelo `rules-engine` (`evaluateDiscountOffer`).
4. Subsídio de frete só pelo `shipping-engine` (`evaluateShippingOffer`).
5. Matemática de oferta determinística e validada por margem.
6. Persistência só via Prisma (ADR 0004).
7. Nenhuma mensagem gerada afirma desconto/frete/estoque não autorizado.

Estado verificado: o módulo mantém repositório Prisma de checkout e de
intervention-ledger, outbox durável e specs de cross-tenant fuzz. Porém o
controller HTTP ainda é legado (`@NonProductionRoute`) sem tenant guard, e a
diagnose abaixo encontrou rupturas de invariante em apply/accept, conclusão
de pedido, semântica de `cart.total` e concorrência de sessão.

## Decisão

Manter `checkout` como núcleo dirigido por portas e eventos (ADR 0001/0003)
e endereçar os defeitos diagnosticados, com prioridade para os que quebram
as invariantes de tenant, autorização de oferta e correção monetária.
Espelhar o `checkout-settings` (ADR irmão) em duas frentes: **tenant guard
no controller** e **concorrência otimista por `updatedAt`** no agregado.

### Bugs diagnosticados e remediação decidida

#### P1 — Oferta autorizada não é vinculada à sua sessão no apply/accept (reuso cross-session no mesmo tenant)
- **Arquivos:** `application/use-cases/apply-offer.use-case.ts:29`; `accept-checkout-offer.use-case.ts:21`.
- **Causa-raiz:** `offers.getOffer(merchant_id, offer_id)` escopa por tenant
  mas nunca afirma `offer.sessionId === input.session_id`. O `AuthorizedOffer`
  carrega `sessionId`, mas ele é ignorado.
- **Impacto:** qualquer sessão do mesmo merchant pode aplicar/aceitar uma
  oferta autorizada para outra sessão; a margem validada contra o carrinho da
  sessão A é aplicada à sessão B. Quebra a autorização por sessão e a
  invariante de margem determinística (invariantes 2/3/5).
- **Remediação:** após `getOffer`, rejeitar quando
  `offer.sessionId !== input.session_id` (`offer_not_found_or_not_approved` /
  `NotFound`). Adicionar escopo de sessão na assinatura do lookup do repositório.
- **Contrato/migração:** **sim** — alterar a porta `OfferRepository.getOffer`
  para receber/validar `sessionId` (mudança de contrato da porta; sem migração de schema).

#### P1 — apply-offer re-deriva `discount_percent` do `cart.total` vivo, não da avaliação do rules-engine
- **Arquivo:** `application/use-cases/apply-offer.use-case.ts:72-83`.
- **Causa-raiz:** `applyOfferToSession` calcula `newDiscount = cart.total *
  (offer.value/100)` no momento do apply. A checagem de margem
  (`evaluateDiscountOffer` / `marginAfterOffer`) rodou na autorização contra o
  carrinho-na-autorização; o desconto absoluto aplicado é recomputado contra o
  `cart.total` atual — que em alguns caminhos é líquido (ver bug de `cart.total`).
- **Impacto:** o desconto aplicado pode divergir do montante autorizado e
  validado por margem quando o carrinho muda entre autorizar e aplicar, ou
  quando o total está líquido. Viola "matemática de oferta determinística" e
  "desconto só pelo rules-engine" (invariantes 3/5).
- **Remediação:** persistir o desconto absoluto autorizado no `AuthorizedOffer`
  no momento da avaliação e aplicar esse valor exato; re-rodar
  `evaluateDiscountOffer` contra o carrinho atual e re-checar margem antes de
  aplicar se o carrinho mudou.
- **Contrato/migração:** **sim** — novo campo de desconto absoluto autorizado em
  `AuthorizedOffer` (shared-types) e coluna correspondente em `AuthorizedOffer`
  (migração Prisma).

#### P1 — Semântica de `cart.total` inconsistente (bruto vs. líquido) causa dupla subtração de desconto
- **Arquivos:** `application/services/checkout-experience.service.ts:128-131`;
  `application/use-cases/update-cart.use-case.ts:16-19,66`.
- **Causa-raiz:** `recomputeTotal` do update-cart grava `cart.total = subtotal -
  currentDiscount` (líquido). `buildCheckoutExperience` então faz `subtotal =
  cart.total` e `total = subtotal + shipping - discount`, subtraindo
  `currentDiscount` de novo. `start-checkout`/`apply-offer` deixam `cart.total`
  bruto — o mesmo campo significa bruto num caminho e líquido em outro.
- **Impacto:** após um update de carrinho que segue um desconto, o subtotal
  exibido e o total computado subtraem o desconto duas vezes, mostrando total
  baixo demais ao comprador e ao histórico/analytics. Defeito de correção
  monetária dependente da ordem das chamadas.
- **Remediação:** definir `cart.total` como **bruto** (soma dos line totals) em
  todos os caminhos; nunca embutir `currentDiscount` em `cart.total`.
  `recomputeTotal` retorna bruto e a experiência deriva `total = bruto +
  shipping - discount` uma única vez.
- **Contrato/migração:** **não** (mudança de invariante de campo + alinhamento
  de código; sem migração — recálculo on-read). Documentar a semântica em shared-types.

#### P1 — Mensagem de WhatsApp de abandono promete `maxDiscountPercent` sem autorização do rules-engine
- **Arquivo:** `application/use-cases/track-checkout-event.use-case.ts:88-104`.
- **Causa-raiz:** em `checkout_abandoned` o use-case emite
  `whatsapp.message.requested` afirmando "Mantive {maxDiscountPercent}% de
  desconto" usando o teto bruto do merchant, sem chamar `evaluateDiscountOffer`
  nem checar `minimumMarginPercent`.
- **Impacto:** o agente comunica um desconto concreto nunca autorizado pelo
  rules-engine nem validado por margem. Viola "desconto só pelo rules-engine" e
  "nunca afirmar desconto não autorizado"; pode prometer desconto de margem
  negativa (invariantes 3/5/7).
- **Remediação:** passar o desconto pelo rules-engine (`evaluateDiscountOffer`)
  para obter oferta autorizada + valor antes de compor a mensagem; se não
  aprovado, não enviar afirmação de desconto.
- **Contrato/migração:** **não** (payload de evento permanece; muda a origem do
  valor). Recomenda-se referenciar `authorizedOfferId` no payload.

#### P1 — complete-order confia em `order_total` e `accepted_offer_id` do cliente sem validação server-side
- **Arquivo:** `application/use-cases/complete-order.use-case.ts:42-72,138-156`.
- **Causa-raiz:** `CompleteOrderUseCase` persiste `CompletedOrder` e emite
  `order.completed` usando `input.order_total` / `input.accepted_offer_id`
  direto. Não recomputa contra carrinho+frete+oferta da sessão, e
  `accepted_offer_id` não é verificado como pertencente à sessão/merchant.
- **Impacto:** cliente malicioso ou com bug pode concluir pedido com total
  arbitrário e atribuir offer id arbitrário, corrompendo analytics de receita,
  histórico de compra e consumidores de `order.completed`. Quebra de
  integridade / fronteira de confiança (invariantes 1/5).
- **Remediação:** recomputar o total esperado server-side a partir da sessão
  (carrinho bruto + frete selecionado − desconto autorizado aplicado) e
  rejeitar divergências; validar que `accepted_offer_id` é uma oferta aceita
  para `(merchant_id, session_id)`.
- **Contrato/migração:** **não** (validação server-side; o request pode passar a
  ignorar `order_total` como autoritativo). Endurecer o contrato HTTP.

#### P1 — Lost-update no agregado de sessão (sem concorrência otimista)
- **Arquivos:** `infrastructure/prisma/prisma-checkout.repository.ts:81-138`;
  `apply-offer.use-case.ts:43-44`; `track-checkout-event.use-case.ts:135-145`.
- **Causa-raiz:** `saveSession` faz upsert incondicional (last-write-wins)
  chaveado só por `merchantId_sessionId`; `updatedAt` é escrito mas nunca usado
  como token de concorrência. Use-cases seguem read-modify-write sem version guard.
- **Impacto:** requisições concorrentes na mesma sessão (apply-offer +
  update-cart, ou chat + track-event) sobrescrevem-se silenciosamente — um
  desconto, reset de frete, campo do cliente ou turno de chat pode ser perdido.
  Caminho quente durante checkout ativo.
- **Remediação:** coluna de versão/`updatedAt` como optimistic-lock e
  `updateMany(where version=expected)` como o `checkout-settings` já faz (ADR
  irmão); retry ou `OptimisticConcurrencyError`. Envolver sequências
  read-modify-write em transação.
- **Contrato/migração:** **sim** — coluna `version` (ou uso de `updatedAt` como
  token) em `CheckoutSession` (migração Prisma) e ajuste de assinatura de
  `saveSession` para receber `expectedUpdatedAt`.

#### P1 — CheckoutController confia em `merchant_id` do body/URL sem tenant/auth guard
- **Arquivo:** `presentation/http/checkout.controller.ts:31-115`.
- **Causa-raiz:** o controller tem apenas `@NonProductionRoute()`; cada handler
  lê `merchant_id` direto do body ou path param e o passa ao use-case. Sem
  `TenantCredentialGuard`/`TenantAccessGuard` e sem `currentTenantPrincipal`,
  diferente do `checkout-settings.controller` (ADR irmão) que aplica ambos.
- **Impacto:** sob `ENABLE_LEGACY_ROUTES` (e em todo ambiente não-produção)
  qualquer chamador lê/escreve sessões, ofertas, regras e overview de qualquer
  tenant fornecendo outro `merchant_id`. Leitura/escrita cross-tenant da
  fronteira de tenant. Mitigado só pelo 404 em `NODE_ENV=production` sem a flag
  legada (invariante 1; ADR 0005/0009).
- **Remediação:** aplicar `TenantCredentialGuard` + `TenantAccessGuard`, derivar
  `merchant_id` do principal autenticado e ignorar/validar qualquer
  `merchant_id` do payload contra o principal.
- **Contrato/migração:** **não** (mudança de presentation/guards; o `merchant_id`
  de path/body deixa de ser autoritativo). Fechar a rota legada (P0.7, ADR 0009).

#### P2 — `overview()` faz dois full-table scans ilimitados por merchant
- **Arquivo:** `infrastructure/prisma/prisma-checkout.repository.ts:397-420`.
- **Causa-raiz:** após `take:10` de sessões/ofertas recentes e todos os eventos,
  ainda faz `findMany({where:{merchantId}})` para TODAS as sessões e ofertas
  (`allSessions`, `allOffers`) e agrega em memória.
- **Impacto:** custo do overview cresce linearmente com o histórico do merchant;
  tenants grandes ficam lentos e consomem memória num endpoint de leitura.
- **Remediação:** substituir agregação em memória por `count`/`aggregate`/
  `groupBy` do Prisma e remover os `findMany` ilimitados.
- **Contrato/migração:** **não** (otimização interna). Índices por `merchant_id`
  nas consultas quentes (ADR 0010).

#### P2 — `findSessionsByEmail` carrega todas as sessões do merchant e filtra em memória
- **Arquivo:** `infrastructure/prisma/prisma-checkout.repository.ts:96-103`.
- **Causa-raiz:** query é `findMany({where:{merchantId}})` seguida de `.filter`
  em JS por `customer.email`; email mora em coluna JSON sem predicado/índice.
- **Impacto:** scan por merchant a cada lookup de email (hidratação de comprador
  recorrente), trabalho e memória O(sessões) por chamada.
- **Remediação:** persistir coluna de email normalizado (lowercase) com índice e
  filtrar na query, ou usar predicado JSON path.
- **Contrato/migração:** **sim** (opcional) — coluna indexada de email
  normalizado em `CheckoutSession` (migração Prisma) se adotada a primeira opção.

#### P2 — track-checkout-event refaz fetch de sessão e contexto de settings várias vezes por chamada
- **Arquivo:** `application/use-cases/track-checkout-event.use-case.ts:27-44,148-156`.
- **Causa-raiz:** `execute` busca a sessão, `recordEvent` lê+atualiza em sua
  própria transação, depois `getSession` é chamado de novo,
  `applyOperationalSettings` chama `getContext`, `execute` chama `getContext` de
  novo, e `applyInterventionLedgerGate` relê o ledger. Leituras redundantes no
  endpoint mais quente.
- **Impacto:** múltiplos round-trips no endpoint de maior frequência (tracking
  de evento); latência e carga extra.
- **Remediação:** buscar a sessão uma vez e propagá-la; buscar o contexto de
  settings uma vez e reusar; `recordEvent` retornar a sessão atualizada.
- **Contrato/migração:** **não** (refactor interno; `recordEvent` pode passar a
  retornar a sessão).

#### P2 — Defaults de `MerchantRules` divergem entre caminhos
- **Arquivos:** `application/use-cases/send-chat-message.use-case.ts:46-60`;
  `evaluate-shipping.use-case.ts:20-34`;
  `infrastructure/prisma/prisma-checkout.repository.ts:22-36`.
- **Causa-raiz:** três objetos default hardcoded com valores diferentes — os
  fallbacks dos use-cases usam `maxDiscountPercent:0`/`allowFreeShipping:false`/
  `maxShippingSubsidy:0`, enquanto o `DEFAULT_RULES` do Prisma usa `10`/`true`/`45`.
- **Impacto:** o comportamento da oferta depende de o repo do merchant estar
  ligado/retornar linha, produzindo resultados de desconto/frete não
  determinísticos para o mesmo merchant. Mina a matemática de oferta
  determinística (invariante 5).
- **Remediação:** uma única constante `DEFAULT_MERCHANT_RULES` compartilhada em
  `@aacp/shared-types` referenciada em todos os caminhos.
- **Contrato/migração:** **não** (constante compartilhada em shared-types, ADR 0025).

#### P2 — Side-effects pós-commit de complete-order não transacionais e sem retry durável
- **Arquivo:** `application/use-cases/complete-order.use-case.ts:104-157`.
- **Causa-raiz:** `purchaseHistory.recordCheckoutPurchase` e o envio BubbleWhats
  rodam após o commit, gated por `!idempotent`, como chamadas diretas fora da
  outbox. Falhas são engolidas (try/catch + `console.error`) sem retry, métrica
  ou evento de outbox.
- **Impacto:** o pedido commita mas o histórico de compra pode falhar
  silenciosamente (lacuna de personalização/analytics) e a confirmação de
  WhatsApp pode ser perdida sem sinal operacional. Side-effects at-most-once em
  caminho crítico.
- **Remediação:** dirigir histórico de compra e dispatch de WhatsApp pela outbox
  (já usada para `order.completed`/`whatsapp.message.requested`) e adicionar
  métricas de falha.
- **Contrato/migração:** **não** (mover side-effects para a outbox; ADR 0003).

#### P3 — Código de desconto previsível derivado do prefixo do session id
- **Arquivo:** `domain/services/offer-factory.ts:26`.
- **Causa-raiz:** `discountCode = `AI-${sessionId.slice(0,6).toUpperCase()}`` —
  determinístico a partir do session id (muitas vezes visível ao cliente) e com
  só 6 chars de entropia do prefixo.
- **Impacto:** códigos adivinháveis/enumeráveis e que podem colidir entre
  sessões com mesmo prefixo; fracos como token de autorização se tratados como tal.
- **Remediação:** gerar códigos via CSPRNG (ex.: derivado de `crypto.randomUUID`)
  sem relação com o session id.
- **Contrato/migração:** **não** (geração interna; valor já persistido em coluna existente).

#### P3 — Log via console e sem métricas em falha do notifier
- **Arquivo:** `application/use-cases/complete-order.use-case.ts:128-135`.
- **Causa-raiz:** integração BubbleWhats usa `console.log`/`console.error` direto,
  sem logger estruturado, correlation id ou contador de `MetricsService` em falha.
- **Impacto:** falhas de entrega de WhatsApp invisíveis a dashboards/alertas e
  difíceis de correlacionar a um pedido. Lacuna de observabilidade em notificação
  ao cliente.
- **Remediação:** usar o logger da aplicação com correlation/event ids e
  incrementar contador de métricas em falha de envio.
- **Contrato/migração:** **não** (observabilidade; convém junto da migração do
  P2 de side-effects para a outbox).

## Melhorias para produção

### Segurança
- Tenant guard no `CheckoutController` e `merchant_id` derivado do principal,
  nunca do body/URL (P1 controller; ADR 0005/0009). Vincular oferta à sessão no
  apply/accept (P1). Código de desconto via CSPRNG (P3). Garantir que nenhuma
  mensagem (chat ou WhatsApp de abandono) afirme desconto não autorizado (P1
  abandono; invariante 7).

### Desacoplamento
- Side-effects de complete-order (histórico, WhatsApp) só via outbox/porta (P2;
  ADR 0003). Manter comunicação com payment/shipping por evento/porta.

### Persistência & Consistência
- `cart.total` bruto em todos os caminhos, com `total` derivado uma vez (P1
  semântica). Concorrência otimista por versão/`updatedAt` no agregado de sessão
  (P1 lost-update), espelhando `checkout-settings`. Recompute server-side de
  `order_total`/`accepted_offer_id` em complete-order (P1).

### Observabilidade
- Logs estruturados com `correlation_id` + `merchant_id` + `session_id`;
  contador de falha no notifier BubbleWhats (P3); métricas de side-effect de
  complete-order (P2).

### Otimização & Escala
- `overview()` por `count`/`aggregate`/`groupBy` sem scans ilimitados (P2);
  email normalizado indexado para `findSessionsByEmail` (P2); fetch único de
  sessão/settings em track-event (P2).

### Features faltantes
- Constante única `DEFAULT_MERCHANT_RULES` em shared-types (P2 defaults; ADR
  0025). Persistir desconto absoluto autorizado no `AuthorizedOffer` (P1 apply).
  Reconciliação sessão↔pedido↔pagamento (ADR 0010).

## Alternativas consideradas
- **Validar oferta↔sessão só na presentation.** Rejeitado: a invariante é de
  domínio; o escopo de sessão deve estar na porta do repositório para valer em
  todos os caminhos.
- **Manter last-write-wins e resolver por retry de aplicação.** Rejeitado: perde
  escritas silenciosamente no caminho quente; concorrência otimista é o padrão
  já provado no `checkout-settings`.
- **Confiar no total do cliente e reconciliar offline.** Rejeitado: corrompe
  analytics/histórico no momento do commit; recompute server-side é barato.

## Consequências
**Positivas:** núcleo confiável e auditável; invariantes de tenant, autorização
de oferta e correção monetária sustentadas em todos os caminhos; paridade de
segurança/concorrência com `checkout-settings`.
**Negativas/riscos:** mudanças de contrato em `OfferRepository.getOffer`,
`AuthorizedOffer` e `saveSession` exigem migração Prisma e atualização de
specs; maior superfície de teste (cross-session negado, concorrência otimista,
recompute de total).

**Barra de aceite:** E2E verdes para — oferta de outra sessão negada no
apply/accept; desconto aplicado == desconto autorizado/validado por margem;
`total` correto após update-cart pós-desconto; abandono sem afirmar desconto
não autorizado; complete-order rejeita total/offer divergentes; corrida
apply-offer×update-cart sem perda (optimistic lock); controller nega
cross-tenant; `overview` sem full scans.
