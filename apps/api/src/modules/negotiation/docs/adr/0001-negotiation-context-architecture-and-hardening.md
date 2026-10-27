# ADR 0001 (negotiation) — Arquitetura do contexto e hardening de produção

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Negotiation), Segurança, Plataforma
- **Relacionado (ADRs centrais):** [ADR 0001](../../../../../../../docs/architecture/adr/0001-modular-monolith-bounded-contexts.md), [ADR 0002](../../../../../../../docs/architecture/adr/0002-acl-pattern-cross-context.md), [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0004](../../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0007](../../../../../../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0010](../../../../../../../docs/architecture/adr/0010-checkout-pilot-path-hardening.md), [ADR 0019](../../../../../../../docs/architecture/adr/0019-negotiation-and-support.md), [ADR 0025](../../../../../../../docs/architecture/adr/0025-packages-engines-sdk-hardening.md). Baseline: `.specs/maturity/negotiation.md`.

> ADR local do módulo (mora ao lado do código, por decisão do time). Detalha
> e estende o [ADR 0019](../../../../../../../docs/architecture/adr/0019-negotiation-and-support.md)
> (umbrella de negotiation/support) com a arquitetura corrente verificada e os
> bugs encontrados em diagnóstico read-only (nenhum código foi alterado).

## Contexto

O bounded context `negotiation` (`apps/api/src/modules/negotiation/`) é
responsável pela **negociação máquina-a-máquina (M2M)** entre o agente do
comprador e a política do lojista, e pelo **cost ledger** que rastreia o custo
estimado de IA por sessão. Está classificado **L2, alvo L3, prioridade P2**
(`.specs/maturity/MATURITY-INDEX.md`).

### Camadas (DDD, ADR 0001)

- **domain/** — entidades e validadores puros: `merchant-negotiation-policy.entity.ts`
  (`assertValidMerchantNegotiationPolicy`), `buyer-agent-preferences.entity.ts`
  (`assertValidBuyerNegotiationPreferences`), `cart-fingerprint.ts`
  (fingerprint canônico SKU/qty/price/total para casar carrinho negociado com o
  carrinho do checkout), `negotiation-defaults.ts` (defaults seguros: tudo
  `enabled: false`), e a porta `ports/negotiation-store.port.ts`
  (`NEGOTIATION_STORE`).
- **application/** — casos de uso: `EvaluateNegotiationUseCase` (delega ao
  engine), `RecordNegotiationSessionUseCase` (persiste sessão + entrada de
  ledger), `ApplyNegotiationAgreementToCheckoutUseCase` (revalida no
  rules-engine e materializa `AuthorizedOffer`), e os use-cases de upsert/get de
  política do lojista e preferências do comprador.
- **infrastructure/** — `PrismaNegotiationStore` (implementa a porta;
  `InMemoryNegotiationStore` para testes).
- **presentation/http/** — `NegotiationController` (`POST /negotiations/evaluate`,
  `POST /negotiations/apply-checkout-offer`), `MerchantNegotiationPolicyController`
  (`GET/PUT /merchant-negotiation-policy`), `BuyerAgentNegotiationPreferencesController`
  (`GET/PUT /buyer-agent/preferences`). Todos sob `AuthGuard`.

### Dependências cross-context (ADR 0002 — ACL/portas)

- `packages/negotiation-engine` — `negotiateDiscount()`: matemática
  determinística que resolve a faixa do lojista por escopo (item > categoria >
  global), cruza com o mínimo aceitável do comprador e decide `agreement`.
- `packages/rules-engine` — `evaluateDiscountOffer()`: **única** autoridade que
  aprova desconto no apply-time (hard-cap `maxDiscountPercent`, margem mínima).
- `checkout` — `offer-factory` (`createAuthorizedOffer`),
  `CHECKOUT_SESSION_REPOSITORY` e `OFFER_REPOSITORY` (portas consumidas no apply).
- `merchant` — `MERCHANT_RULES_REPOSITORY` (regras vigentes para revalidação).
- `auth` — `AuthGuard` / `currentUser` (deriva `merchantId` do contexto).

### Invariantes que o contexto deve sustentar (CLAUDE.md)

1. **O LLM/agente nunca autoriza oferta** — a aprovação de desconto é exclusiva
   do `rules-engine` no apply-time, e compromissos de alto valor exigem humano no
   loop (`requiresHumanConfirmation`).
2. **Matemática de oferta determinística** — sem estado oculto; mesmo input,
   mesmo resultado.
3. **`merchant_id` sempre do contexto de tenant**, nunca do body (ADR 0005).
4. **Cost ledger é estado financeiro** — persistido, auditável, sem
   dupla-contagem (DoD L3).
5. **Mensagens geradas** validadas e com fallback determinístico.

### Fluxos principais

- **evaluate:** controller resolve política/prefs → `negotiateDiscount()` →
  `RecordNegotiationSessionUseCase` cria `NegotiationSession` + entrada
  `negotiation.evaluated` no ledger com `estimatedAiCostCents`.
- **apply:** carrega sessão de negociação → carrega checkout session → confere
  fingerprint → exige `agreement` e `requestedDiscountPercent ===
  selectedDiscountPercent` → revalida no `rules-engine` → cria `AuthorizedOffer`
  via offer-factory → grava entrada `negotiation.offer_applied`.

## Decisão

Levar `negotiation` a L3 mantendo a arquitetura DDD em camadas acima e
corrigindo o conjunto de bugs verificados abaixo, com prioridade para os **P1**
que ferem invariantes de segurança e integridade do ledger. Em resumo:

1. Reabilitar o guardrail de confirmação humana no apply-time (Bug 1).
2. Resolver política/preferências **sempre no servidor**, validadas pelo domínio
   (Bug 2).
3. Tornar `apply-checkout-offer` **idempotente** e atômico (Bug 3).
4. Persistir sessão/ledger só quando há negociação real, com idempotência (Bug 4).
5. Mapear erros de domínio para HTTP 4xx (Bug 5).
6. Escritas multi-tabela atômicas via `$transaction` (Bug 6).
7. Revalidar `policy.enabled` no apply-time (Bug 7).
8. Eliminar leituras duplicadas em GETs de dashboard (Bug 8).
9. Corrigir threshold `0` de confirmação humana no engine (Bug 9).
10. Registrar valor da oferta no ledger e adicionar observabilidade (Bug 10).

## Bugs encontrados (diagnóstico read-only)

### Bug 1 — [P1/segurança] Guardrail de confirmação humana ignorado no apply

- **Arquivo:** `application/apply-negotiation-agreement-to-checkout.use-case.ts:39-74`
- **Causa raiz:** `negotiateDiscount()` calcula
  `result.requiresHumanConfirmation` (true quando `cart.total >
  buyerPreferences.requireHumanConfirmationAbove`), mas
  `ApplyNegotiationAgreementToCheckoutUseCase.execute` **nunca lê esse campo**.
  Os únicos gates são presença de `agreement` e
  `requestedDiscountPercent === selectedDiscountPercent`.
- **Impacto:** um agente comprador autônomo converte uma negociação acordada em
  `AuthorizedOffer` persistida para carrinhos que o comprador explicitamente
  marcou como exigindo aprovação humana. O guardrail que mantém o humano no loop
  para compromissos de alto valor fica inerte — fere o princípio "o agente não
  autoriza sozinho".
- **Remediação decidida:** em `execute()`, após carregar `negRow.result`, se
  `r.requiresHumanConfirmation` for true exigir um token/flag explícito de
  confirmação humana no request de apply (ex.: `body.human_confirmed === true`
  atado a uma ação de owner/admin) e rejeitar com 403/400 caso contrário.
  Registrar o ator da confirmação no ledger.
- **Contrato/migração:** **Sim.** Novo campo opcional no body de
  `apply-checkout-offer` (`human_confirmed` + identidade do ator) e nova coluna
  de ator/confirmação na entrada de ledger.

### Bug 2 — [P1/validação] `evaluate` confia em policy/prefs do cliente e pula validação de domínio

- **Arquivo:** `presentation/http/negotiation.controller.ts:34-50`
- **Causa raiz:** `merchantPolicy = body.merchantPolicy ?? stored` e
  `buyerPreferences = body.buyerPreferences ?? stored` deixam o chamador
  sobrescrever integralmente a política persistida do tenant. Nenhum dos objetos
  passa por `assertValidMerchantNegotiationPolicy` /
  `assertValidBuyerNegotiationPreferences`; o engine só valida a faixa global
  (`isValidRange`) e ignora faixas de categoria/item e todos os limites de
  buyer-prefs.
- **Impacto:** um chamador negocia contra uma política fabricada (ex.:
  `maxDiscountPercent:100, enabled:true`) produzindo acordos e entradas de ledger
  que o lojista nunca configurou. Buyer-prefs fora de faixa (negativo ou >100)
  chegam ao engine e distorcem `selectedDiscountPercent`. A revalidação no
  rules-engine no apply-time ainda limita o desconto autorizado, então **nenhum
  desconto não-autorizado é concedido**, mas a integridade de dados de
  sessão/ledger é quebrada.
- **Remediação decidida:** resolver `merchantPolicy` e `buyerPreferences`
  **sempre no servidor** a partir do store para o lojista autenticado; remover os
  overrides do body (ou gateá-los atrás de uma flag de teste). Se overrides
  permanecerem para teste, passá-los pelos validadores `assertValid*` antes.
- **Contrato/migração:** **Sim (contrato).** Remoção dos campos
  `merchantPolicy`/`buyerPreferences` do body público de `evaluate` (breaking
  para chamadores que os enviavam). Sem migração de banco.

### Bug 3 — [P1/dados] Sem idempotência no apply (ofertas duplicadas + dupla-contagem no ledger)

- **Arquivo:** `application/apply-negotiation-agreement-to-checkout.use-case.ts:59-72`
- **Causa raiz:** `execute()` cria incondicionalmente uma nova `AuthorizedOffer`
  (`off_<uuid>`), chama `offers.saveOffer` e anexa uma entrada
  `negotiation.offer_applied` em **toda** invocação. Não há chave de idempotência
  no endpoint nem na persistência, nem checagem de oferta já aplicada para a
  sessão de negociação.
- **Impacto:** um retry de rede ou duplo-submit do agente comprador persiste
  múltiplas ofertas autorizadas para uma única sessão de negociação e grava
  entradas de ledger duplicadas, corrompendo o cost ledger e permitindo mais de
  uma oferta viva por acordo.
- **Remediação decidida:** aceitar uma chave de idempotência (ou derivá-la de
  `negotiationSessionId + checkoutSessionId`) e ou retornar a oferta existente se
  já houver uma para a sessão, ou impor constraint única na camada de DB.
  Envolver read+create numa transação.
- **Contrato/migração:** **Sim.** Header/campo de idempotência no endpoint +
  constraint única (`negotiationSessionId` ou `negotiationSessionId+checkoutSessionId`)
  na tabela de ofertas/ledger → migração Prisma.

### Bug 4 — [P1/dados] `evaluate` é não-idempotente e grava sessão/ledger até em negação
- **Arquivo:** `presentation/http/negotiation.controller.ts:52-59`
- **Causa raiz:** `evaluate()` sempre chama `recordSession.execute`, que cria uma
  linha `NegotiationSession` e anexa entrada `negotiation.evaluated` com
  `estimatedAiCostCents` — mesmo quando `negotiateDiscount` retorna uma negação
  determinística (ex.: `merchant_machine_negotiation_disabled`) onde **zero**
  chamadas reais de IA ocorrem. Não há chave de idempotência.
- **Impacto:** cada retry cria sessão duplicada e dupla-conta custo de IA
  estimado no ledger que o contexto existe para rastrear; avaliações negadas
  inflam números de custo e produzem crescimento ilimitado de linhas de sessão
  sem valor de negócio.
- **Remediação decidida:** só persistir sessão/ledger quando a negociação é de
  fato tentada (caminho de acordo ou gasto real de IA); aceitar chave de
  idempotência para retries; registrar custo estimado vs real como campos
  distintos.
- **Contrato/migração:** **Sim.** Campo de idempotência no `evaluate` + colunas
  separadas `estimatedCostCents`/`actualCostCents` no ledger → migração Prisma.

### Bug 5 — [P2/runtime] Validação de domínio lança Error puro, vira HTTP 500

- **Arquivo:** `domain/merchant-negotiation-policy.entity.ts:12-22` (idem `buyer-agent-preferences.entity.ts`)
- **Causa raiz:** `assertValidMerchantNegotiationPolicy` e
  `assertValidBuyerNegotiationPreferences` lançam `new Error(...)`. Isso propaga
  por `UpsertMerchantNegotiationPolicyUseCase` /
  `UpsertBuyerAgentPreferencesUseCase` até o controller, onde o Nest mapeia uma
  não-`HttpException` para 500 Internal Server Error.
- **Impacto:** input inválido de política do lojista ou preferência do comprador
  retorna 500 em vez de 400, mascarando erros do cliente como falhas do servidor
  e degradando clareza de contrato e alerting.
- **Remediação decidida:** lançar `BadRequestException` (ou um erro de domínio
  mapeado por exception filter) nos validadores, ou capturar e relançar nos
  use-cases. Mesmo tratamento em `buyer-agent-preferences.entity.ts`.
- **Contrato/migração:** Não. Apenas correção de status HTTP.

### Bug 6 — [P2/concorrência] Escrita multi-tabela não-atômica causa drift ledger/oferta

- **Arquivo:** `application/record-negotiation-session.use-case.ts:15-27`
- **Causa raiz:** `createNegotiationSession` e depois
  `appendNegotiationLedgerEntry` são duas chamadas Prisma independentes sem
  `$transaction`; o mesmo padrão existe no apply (`saveOffer` e depois
  `appendNegotiationLedgerEntry`). Uma falha entre as chamadas deixa sessão sem
  entrada de ledger, ou oferta persistida sem registro de auditoria.
- **Impacto:** falhas parciais dessincronizam silenciosamente o cost ledger das
  sessões/ofertas, tornando o rastreio de custo e a reconstrução de auditoria
  não-confiáveis.
- **Remediação decidida:** envolver cada par create+ledger num único
  `prisma.$transaction` para que ambas as linhas commitem ou revertam juntas;
  expor um método transacional na porta do store.
- **Contrato/migração:** Não (banco). Ajuste na porta `NegotiationStore` (método
  transacional) — mudança interna de contrato de porta, não de API pública.

### Bug 7 — [P2/contrato] Apply não revalida se a política de negociação ainda está habilitada

- **Arquivo:** `application/apply-negotiation-agreement-to-checkout.use-case.ts:26-44`
- **Causa raiz:** o apply valida o desconto contra as `MerchantRules` atuais
  (rules-engine) mas **nunca recarrega** a `MerchantNegotiationPolicy` corrente
  para confirmar que a negociação ainda está habilitada para o lojista. A
  autorização repousa na flag de `agreement` do snapshot capturado no evaluate.
- **Impacto:** um acordo registrado antes de o lojista desabilitar a negociação
  máquina permanece aplicável, então um recurso desabilitado ainda produz ofertas
  autorizadas até a sessão registrada expirar.
- **Remediação decidida:** recarregar a política do lojista no apply-time e
  rejeitar se `!policy.enabled`; opcionalmente limitar a aplicabilidade com um TTL
  de sessão.
- **Contrato/migração:** Parcial. Sem migração; se adotado TTL de sessão, novo
  campo de expiração na `NegotiationSession` → migração Prisma.

### Bug 8 — [P3/performance] Leituras de store duplicadas por GET

- **Arquivo:** `presentation/http/merchant-negotiation-policy.controller.ts:17-23`
- **Causa raiz:** `get()` chama `getPolicy.executeStored` **e**
  `getPolicy.executeResolved`, cada um disparando seu próprio
  `getMerchantPolicy`. O controller de buyer-agent lê a mesma linha duas vezes
  (`getPrefs.executeResolved` e depois `getPrefs.hasStoredPreferences`).
- **Impacto:** dois round-trips idênticos ao DB por GET em endpoints quentes de
  dashboard; dobra a carga de leitura sem ganho funcional.
- **Remediação decidida:** buscar a linha persistida uma vez e derivar tanto
  `has_custom` quanto `resolved` (fallback ao default) desse único valor.
- **Contrato/migração:** Não. Refator interno; resposta da API inalterada.

### Bug 9 — [P3/funcional] `requireHumanConfirmationAbove` de 0 é silenciosamente desabilitado

- **Arquivo:** `packages/negotiation-engine/src/index.ts:142-144`
- **Causa raiz:** `requiresHumanConfirmation` usa
  `Boolean(input.buyerPreferences.requireHumanConfirmationAbove) && cart.total >
  (... ?? Infinity)`. Um threshold de `0` (significando "sempre exigir
  confirmação") é falsy, então toda a exigência de confirmação é pulada.
- **Impacto:** um comprador que define o threshold mais conservador (`0`) não
  recebe nenhuma exigência de confirmação humana — o oposto da intenção. Agrava o
  Bug 1.
- **Remediação decidida:** testar presença com `typeof
  requireHumanConfirmationAbove === "number"` em vez de `Boolean()`, depois
  comparar `cart.total > threshold`.
- **Contrato/migração:** Não (correção no `negotiation-engine`, ADR 0025). Sem
  mudança de tipos públicos.

### Bug 10 — [P3/observabilidade] Ledger omite valor da oferta e falta observabilidade

- **Arquivo:** `application/apply-negotiation-agreement-to-checkout.use-case.ts:67-72`
- **Causa raiz:** `negotiation.offer_applied` é anexado com `amountCents: 0`,
  então o valor do desconto/subsídio concedido nunca é registrado. Não há logging
  estruturado nem métricas em nenhum use-case de negociação para negações, hits
  de cap de custo de IA, acordos ou desfechos de apply.
- **Impacto:** o cost ledger não consegue reconstruir o valor de desconto
  realizado, e operadores não têm sinal sobre taxas de negação/acordo nem
  rupturas de cap num fluxo cujo propósito primário é governança de custo.
- **Remediação decidida:** registrar o valor de desconto da oferta (e qualquer
  subsídio) na entrada de ledger, e adicionar logs/métricas estruturados
  (`denialReason`, escopo, custo estimado vs real) chaveados por `merchantId` e
  `negotiationSessionId`.
- **Contrato/migração:** Parcial. Novos campos na entrada de ledger
  (`amountCents` real + metadados) → migração Prisma. Sem mudança de API pública.

## Melhorias para produção

### Segurança
- Confirmação humana reabilitada no apply (Bug 1); `merchant_id` sempre do
  contexto (ADR 0005/0009), nunca do body; política/prefs resolvidas no servidor
  (Bug 2). Nenhuma concessão fora do `rules-engine` (invariante mantida no
  apply-time). Mensagens geradas validadas com fallback determinístico.

### Desacoplamento
- Comunicação com `checkout` por porta/evento (ADR 0002/0003); manter o consumo
  de offer-factory e session repo via portas; método transacional na porta do
  store em vez de chamadas Prisma soltas (Bug 6).

### Persistência & Consistência
- Idempotência no `evaluate` e no `apply` (Bugs 3 e 4); escrita
  sessão/oferta + ledger atômica via `$transaction` (Bug 6); revalidação de
  `policy.enabled` no apply (Bug 7); cost ledger como estado financeiro
  persistido (ADR 0019, DoD L3).

### Observabilidade
- Valor de oferta no ledger; logs estruturados com `correlation_id` +
  `merchant_id` + `negotiation_session_id`; métricas de
  avaliações/acordos/negações, custo estimado vs real e hits de cap (Bug 10).

### Otimização & Escala
- Eliminar leituras duplicadas em GETs de dashboard (Bug 8); limite de rodadas de
  negociação; paginação de sessões/ledger; índices por `merchant_id`.

### Features faltantes
- Reconciliação do cost ledger; runbook de replay de acordo; TTL/expiração de
  sessão de negociação; mapeamento de erros de domínio para HTTP via exception
  filter (Bug 5).

## Alternativas consideradas

- **Manter overrides de policy/prefs no body do `evaluate`** (Bug 2). Rejeitado:
  permite negociar contra política fabricada e corromper ledger; a fonte de
  verdade é o store do tenant. Se necessário para teste, atrás de flag e via
  validadores.
- **Desconto decidido na negociação/chat.** Rejeitado (ADR 0019): só o
  `rules-engine` aprova; o engine apenas propõe.
- **Cost ledger em memória.** Rejeitado (ADR 0019): estado financeiro crítico.
- **Idempotência só no cliente.** Rejeitada: retries de rede e duplo-submit
  exigem garantia no servidor + constraint de DB (Bugs 3/4).

## Consequências

**Positivas:** negociação determinística e auditável; guardrail humano efetivo;
ledger íntegro e reconciliável; contrato de erro claro (4xx vs 5xx).

**Negativas/riscos:** migrações Prisma para idempotência, campos de custo
estimado vs real e valor de oferta no ledger; breaking change no body do
`evaluate` (remoção de overrides) exige alinhar chamadores; maior superfície de
teste (idempotência, transação, confirmação humana).

## Barra de aceite

DoD L3 do [ADR 0007](../../../../../../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md) +:

- E2E: apply rejeitado sem confirmação humana quando
  `requiresHumanConfirmation` (Bug 1) e com threshold `0` (Bug 9).
- E2E: `evaluate` ignora overrides de body e valida policy/prefs (Bug 2).
- E2E: retry de `apply` e de `evaluate` idempotentes — sem ofertas/ledger
  duplicados (Bugs 3/4).
- Teste: input inválido retorna 400, não 500 (Bug 5).
- Teste: falha entre create e ledger reverte ambos (Bug 6).
- Teste: apply rejeitado quando `policy.enabled === false` (Bug 7).
- Teste: GET de política/prefs faz uma única leitura (Bug 8).
- Teste: ledger registra valor de desconto realizado + métricas de negação/acordo
  (Bug 10).
- Verde: hard-cap/margem do `rules-engine`, cross-tenant negado e mensagem segura.
