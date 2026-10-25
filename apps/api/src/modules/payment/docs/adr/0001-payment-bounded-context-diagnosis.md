# ADR 0001 (payment) — Bounded context `payment`: arquitetura e diagnóstico do caminho de dinheiro

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Payment), Segurança, Plataforma
- **Relacionado:** [ADR 0002](../../../../../../docs/architecture/adr/0002-acl-pattern-cross-context.md) (ACL), [ADR 0003](../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md) (outbox/eventos), [ADR 0004](../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md) (Prisma por contexto), [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md) (tenant), [ADR 0009](../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md) (P0 plataforma), [ADR 0010](../../../../../../docs/architecture/adr/0010-checkout-pilot-path-hardening.md) (checkout), [ADR 0011](../../../../../../docs/architecture/adr/0011-payment-hardening.md) (payment hardening), [ADR 0027](../../../../../../docs/architecture/adr/0027-payment-crypto-evm.md) (crypto EVM). Baseline: `.specs/maturity/payment.md`.

> **Escopo deste ADR.** Diagnóstico do estado atual do contexto `payment`
> (`apps/api/src/modules/payment`); **nenhum código foi alterado**. Registra a
> arquitetura vigente (responsabilidades, portas, fluxos quentes, invariantes) e
> 16 bugs encontrados com causa-raiz e remediação decidida. As correções são
> rastreadas no Workflow B; este documento é a fonte da decisão.

## Contexto

`payment` é o contexto de **dinheiro**: cria payment intents, recebe e processa
webhooks de provedores (Asaas, Stripe), confirma cripto on-chain (EVM/USDC),
reconcilia estado pendente e expõe a superfície de plataforma
(payment-platform: conexões/segredos por merchant). É classificado **L2
(blocked), alvo L3, prioridade P1**.

### Responsabilidades

- **Domínio:** `PaymentIntentEntity` (máquina de estados
  `pending → requires_action → approved | failed | cancelled | refunded`,
  com guarda de transição e invariante `approvedAmountCents === amountCents`);
  `payment-platform.types` (conexões por provedor/merchant).
- **Aplicação (use-cases):** `create-payment-intent`, `handle-asaas-webhook`,
  `handle-stripe-webhook`, `reconcile-payment-intents`, `confirm-crypto-payment`,
  `confirm-stripe-payment`, `get-payment-intent-status`, `payment-platform`.
- **Infraestrutura:** repositórios Prisma (`prisma-payment`,
  `prisma-payment-platform`) e in-memory; adapters de roteamento
  (`routing-payment`) e por provedor (`asaas`, `stripe`, `evm-crypto`);
  `payment-secret-cipher` (cifragem de segredos de conexão do merchant);
  `evm-crypto-verifier` + `evm-crypto-quote` (verificação on-chain e cotação BRL→USDC).
- **Apresentação:** controllers HTTP (`payment`, `asaas-webhook`,
  `stripe-webhook`, `stripe-payment`, `crypto-payment`, `payment-platform`).

### Portas (contratos)

- `PaymentRepository` — persistência de intents, idempotência de eventos de
  provedor (`hasProcessedProviderEvent` / `recordProcessedProviderEvent`),
  `saveIntentWithOutbox` (intent + evento atômicos), `listStalePending`,
  lookups por idempotência / `providerPaymentId` / id de negócio.
- `PaymentProvider` — criação de cobrança e consulta de status por provedor
  (implementado por `routing-payment.adapter`, que escolhe Asaas/Stripe por
  merchant e aplica Connect/fees).
- `PaymentPlatformRepository` / `PaymentPlatformProvider` — conexões e
  capacidades de plataforma por merchant.
- `CheckoutPayment` — porta de saída para concluir pedido após aprovação
  (`completeAfterApproval`), comunicação por evento (ADR 0003).

### Invariantes que o contexto deve sustentar (CLAUDE.md)

1. **Tenant:** toda query/command escopado por `merchant_id`; `merchant_id` vem
   do contexto autenticado, nunca do body (ADR 0005/0009).
2. **Autorização determinística e verificada pelo provedor:** LLM/agente nunca
   autoriza pagamento; aprovação só com fato verificável do provedor.
3. **Idempotência de webhook:** entregas duplicadas (Asaas/Stripe reentregam) não
   podem duplicar efeito colateral (ADR 0011).
4. **Atomicidade intent + outbox:** conclusão de pedido dirigida por evento
   durável; nunca aprovar sem emitir o evento, nem emitir sem aprovar (ADR 0003).
5. **Matemática de oferta/pagamento determinística:** valor cobrado bate com o
   total autoritativo do commerce; dinheiro em inteiro de centavos.

### Fluxos quentes

- **Criar intent:** `create-payment-intent` → valida cart/sessão → `routing`
  cria cobrança no provedor → persiste intent + outbox.
- **Aprovar via webhook:** controller verifica autenticidade →
  `handle-asaas-webhook`/`handle-stripe-webhook` resolve intent → `markApproved`
  → `saveIntentWithOutbox` → `completeAfterApproval` + commerce-paid → grava
  evento processado.
- **Confirmar cripto:** `confirm-crypto-payment` → `evm-crypto-verifier`
  confere Transfer on-chain → `markApproved` → `completeAfterApproval`.
- **Reconciliar:** job varre `listStalePending` → consulta status no provedor →
  aplica transição autoritativa.

## Decisão

Levar `payment` a L3 (ADR 0007/0011) corrigindo os 16 achados abaixo, com
prioridade absoluta nos **dois P0** (idempotência de webhook não-atômica e
bypass de autorização de cripto), que quebram correção financeira e a invariante
de autorização verificada. As decisões de remediação por achado seguem em
**Bugs encontrados**. Princípios diretores:

- a **gravação do marcador de evento processado é o portão** (roda antes do
  efeito colateral, dentro da mesma transação que muda o estado) — não um
  `SELECT` check-then-act;
- toda aprovação é **amarrada a um discriminante único** do provedor (eventId
  Asaas/Stripe; `(chain, txHash)` + discriminante por-intent no cripto);
- o **boundary de tenant mora na porta** (`getIntentById` recebe `merchantId`),
  não em pós-checagens manuais por call site;
- conclusão downstream é dirigida pela **outbox transacional** com relay, não
  por `await` best-effort inline (ADR 0003).

## Melhorias para produção

### Segurança
- **Bind por-intent no cripto** (nonce de dust / sub-endereço / memo EIP-712) +
  unicidade global `(chain, txHash)` antes de `markApproved` (achado #2).
- **Boundary de tenant na porta** — `getIntentById(merchantId, …)`; webhook usa
  `getIntentByExternalReference` que devolve só `id+merchantId` e re-busca
  escopado (achado #3).
- **Asaas webhook fail-closed** — erro de config no boot se `ASAAS_WEBHOOK_TOKEN`
  ausente em produção; comparação constant-time; preferir assinatura Asaas
  (achado #12).
- **Stripe config fail-fast** — erro claro no init se `secretKey`/`webhookSecret`
  ausentes; verificação por conta Connect onde aplicável (achado #9).
- **Confirmations de finalidade** no EVM (block `finalized` / valor finality-safe
  na mainnet) e match único de Transfer (achado #13).
- **Segredos buyer-facing** (`clientSecret`/QR) não persistidos em claro ou
  cifrados em repouso como os segredos de conexão; status nunca ecoa
  `clientSecret` (achado #14).

### Desacoplamento
- Conclusão de pedido/commerce-paid **somente por outbox + relay** (ADR 0003),
  não `await` inline após o commit do intent (achados #1, #8).

### Persistência & Consistência
- **Portão atômico de idempotência** em ambos os webhooks: `record` antes do
  dispatch, dentro de uma transação; `hasProcessed` só como fast-path (achado #1).
- **Intent persistido antes da cobrança** (ou chave de idempotência do provedor
  derivada da tupla estável `merchantId+sessionId+idempotencyKey`) para alinhar
  dedupe local e do provedor (achado #5).
- **Dinheiro em inteiro de centavos** ponta-a-ponta; sem round-trip float em
  unidades maiores (achados #11, #15).
- Cobrar do **`trustedCart`** validado pelo commerce (com frete/desconto) ou
  assertar igualdade de centavos antes de criar o intent (achado #11).

### Observabilidade
- `illegal_transition` **distinguido** entre re-entrega idempotente (terminal) e
  corrupção real: métrica + log estruturado (intent id, event id) antes de
  qualquer swallow; mismatch verdadeiro vai para dead-letter/alerta, não consumo
  silencioso (achados #4, #5).
- Métricas de intents criados/aprovados/falhos, taxa de webhook duplicado,
  latência do provedor (ADR 0011).

### Otimização & Escala
- Reconcile com `try/catch` por candidato (uma falha não aborta o lote) e
  cota/round-robin por merchant sob o limite global (achado #10).
- Buscar o intent **uma vez** no webhook Asaas e carregar `FOR UPDATE` na
  transação do marcador (achados #6, #1).

### Features faltantes
- Reconciliação por `providerPaymentId` para cobranças órfãs (achado #5);
  runbook de webhook perdido/atrasado e de replay da outbox (ADR 0003/0011).

## Bugs encontrados

### P0

**#1 — Idempotência de webhook é check-then-act, não atômica (concorrência).**
`handle-asaas-webhook` (102-128) / `handle-stripe-webhook` (70-77) /
`prisma-payment.repository` (216-232).
*Causa-raiz:* `recordProcessedProviderEvent` foi construído como portão atômico
(INSERT, retorna `false` em P2002, repo:228-229), mas todos os chamadores
ignoram o boolean. Os use-cases fazem `hasProcessedProviderEvent` (SELECT),
ramificam, rodam todo o dispatch com efeito colateral (`markApproved`,
`completeAfterApproval`, métricas, commerce-paid) e **só então** chamam
`recordProcessedProviderEvent`. Duas entregas concorrentes do mesmo evento
passam ambas pelo SELECT, ambas executam dispatch; um INSERT perde a corrida e
devolve `false` — descartado. Resultado: evento `payment approved` duplicado na
outbox, `completeAfterApproval` duplicado, métrica dobrada.
*Remediação:* `record` vira o portão **antes** dos efeitos; short-circuit para
`{outcome:'duplicate'}` no `false`; manter `dispatch + record` na **mesma
transação**; rebaixar `hasProcessed` a fast-path opcional.
*Contrato/migração:* **sim** — exige transação envolvendo o marcador e a mudança
de estado; índice único do marcador já existe.

**#2 — Confirmação de cripto pode ser replayed/satisfeita por transfer não
relacionado (segurança / bypass de autorização).** `confirm-crypto-payment`
(55-89) / `evm-crypto-verifier` (63-93).
*Causa-raiz:* `verifyTransfer` autoriza só com fatos públicos/fornecidos pelo
cliente: log `Transfer` com `to===destinationAddress` (tesouraria compartilhada),
`value===amountAtomic` e `from===walletAddress` (do body). Nada amarra a tx a
**este** intent. Como tesouraria e valor são reusados entre intents, um comprador
pode submeter um `tx_hash` de outro transfer do mesmo valor USDC à mesma
tesouraria e aprovar um intent não relacionado. Pior: não há idempotência de
evento nem unicidade de `tx_hash` — o mesmo `tx_hash` aprova múltiplos intents.
A única guarda (`status!=='requires_action'`) não previne reuso cross-intent.
*Remediação:* amarrar cada quote a um discriminante on-chain único por-intent
(nonce de dust único em `amountAtomic`, sub-endereço por-intent, ou memo
assinado EIP-712) e verificá-lo; impor unicidade global `(chain, txHash) → 1
intent` via portão de evento/índice único antes de `markApproved`, espelhando a
tabela de idempotência de webhook.
*Contrato/migração:* **sim** — quote ganha discriminante por-intent; nova
restrição de unicidade `(chain, txHash)`.

### P1

**#3 — `getIntentById` não é tenant-scoped (segurança).** porta:44, repo:198-203.
*Causa-raiz:* `getIntentById(intentBusinessId)` não recebe `merchantId`; o Prisma
faz `findUnique({where:{id}})` sem filtro de merchant, contra a invariante de
tenant. Read use-cases compensam com pós-checagem manual
`snap.merchantId!==merchantId`, mas o webhook Asaas **resolve o tenant a partir
desse lookup não-escopado** (98) usando `externalReference` influenciado pelo
atacante. Qualquer call site que esqueça o pós-filtro vaza/atua cross-tenant.
*Remediação:* `merchantId` obrigatório em `getIntentById`; para o caso "merchant
desconhecido até o lookup", `getIntentByExternalReference` devolvendo só
`id+merchantId` e re-fetch escopado. Empurrar o boundary para o repositório.
*Contrato/migração:* **sim** — mudança de assinatura da porta + novo método.

**#4 — `illegal_transition` do Asaas é engolido e marcado como processado
(observabilidade).** `handle-asaas-webhook` (120-127).
*Causa-raiz:* o catch trata qualquer erro com `'illegal_transition'` na mensagem
como benigno: grava processado e retorna `{outcome:'ignored',
reason:'illegal_transition_swallowed'}`. Mas `illegal_transition` é lançado em
situações distintas — inclusive mismatch de `approvedAmountCents` (entity:161-163)
e eventos fora de ordem. Um mismatch real ou bug de lógica é absorvido sem
métrica/log/alerta, e o evento fica permanentemente consumido.
*Remediação:* distinguir re-entrega idempotente (já terminal) de transição
ilegal verdadeira; emitir métrica + warn estruturado (intent id, event id) antes
do swallow; só gravar processado em no-op genuíno; mismatch real vai para
dead-letter/alerta.
*Contrato/migração:* não.

**#5 — Stripe confia em `pi.amount_received` sem comparar ao valor do intent;
guarda da entidade lança e é descartado (data).** `handle-stripe-webhook`
(128-131) / `payment-intent.entity` (157-168).
*Causa-raiz:* `handleSucceeded` chama `markApproved({approvedAmountCents:
pi.amount_received})` sem checar igualdade contra `snap.amountCents`. A entidade
exige igualdade e lança `illegal_transition`. Diferente do Asaas, o dispatch
Stripe **não tem try/catch**: captura parcial / drift lança para fora do
dispatch, o evento **não** é gravado processado, Stripe reentrega e lança para
sempre — *poison event*. `reconcile` e `confirm-stripe` pré-checam valor →
semântica inconsistente entre os três pontos de entrada.
*Remediação:* pré-checar `pi.amount_received===snap.amountCents` em
`handleSucceeded`; em mismatch, `markFailed('stripe_value_mismatch')` + gravar
processado + alerta, espelhando o caminho `PAYMENT_RECEIVED` do Asaas; envolver
o dispatch Stripe com o mesmo tratamento de `illegal_transition`.
*Contrato/migração:* não.

**#6 — `create-payment-intent`: cobrança criada antes do intent persistido —
não-atômico, cobranças vivas órfãs (integração).** `create-payment-intent`
(223-268).
*Causa-raiz:* chama `provider.createPayment` (cobrança real com `providerPaymentId`
vivo, 223-246) e **depois** persiste via `saveIntentWithOutbox` (253). Se o save
lança, existe cobrança no provedor com `externalReference=intent.id` mas sem
linha local. Idempotência é chaveada no intent local (`getByIdempotency`, 127);
retry do cliente não acha nada e cria uma **segunda** cobrança. O adapter Stripe
passa `idempotencyKey:intentId` (stripe-payment.adapter:62), mas o id é aleatório
por tentativa → não dedupe entre retries.
*Remediação:* persistir o intent em `pending` **antes** de chamar o provedor
(reservar a linha de idempotência), ou derivar a chave de idempotência do
provedor da tupla estável `(merchantId,sessionId,idempotencyKey)` para alinhar
dedupe local e do provedor; considerar máquina de estados intent-first.
*Contrato/migração:* **sim** — ordem de escrita / origem da chave de idempotência
do provedor muda; índice de idempotência reservado pré-cobrança.

### P2

**#7 — Asaas webhook faz double-fetch do mesmo intent; segundo fetch pode
retornar snapshot diferente do que gatekeepou a idempotência (concorrência).**
`handle-asaas-webhook` (98 vs 135).
*Causa-raiz:* `execute()` busca o intent em 98 para resolver `merchantId` do event
key, e `dispatch()` busca **de novo** em 135 e opera no segundo instance. Dois
round-trips (N+1 menor), mas o snapshot da decisão de idempotência/tenant (98) e
o snapshot mutado (135) são lidos em instantes distintos sem row lock — alarga a
janela TOCTOU do achado #1.
*Remediação:* buscar uma vez, passar a entidade para `dispatch`, e carregar
`FOR UPDATE` na mesma transação do marcador.
*Contrato/migração:* não (decorre de #1).

**#8 — `completeAfterApproval` / commerce-paid rodam fora da transação do save —
conclusão parcial em falha no meio (data).** `handle-asaas-webhook` (207-229) /
`handle-stripe-webhook` (132-155) / `reconcile-payment-intents` (89-108).
*Causa-raiz:* na aprovação a sequência é `saveIntent` (commit
status=approved) → `recordPaymentStatusChanged` (outbox) →
`completeAfterApproval` (event bus separado + chat turn) → `markLinkedCommerceOrderPaid`
(write separado). `await`s independentes sem transação envolvente. Falha após
`saveIntent` e antes de `completeAfterApproval` deixa o intent permanentemente
`approved` sem completar checkout/commerce-paid; como não está mais `pending`,
`reconcile` (`listStalePending`) nunca o pega.
*Remediação:* dirigir a conclusão downstream pela outbox transacional
(`saveIntentWithOutbox`) consumida por um relay com retry, em vez de `await`s
best-effort inline; aprovação + enqueue atômicos; relay garante execução
eventual (ADR 0003).
*Contrato/migração:* **sim** — conclusão migra para consumo de outbox; relay
necessário.

**#9 — Stripe webhook instancia o próprio client com segredo de módulo,
ignorando roteamento Connect por-merchant (configuração).**
`handle-stripe-webhook` (40-42) / `confirm-stripe-payment` (28-30).
*Causa-raiz:* ambos constroem `new Stripe(secretKey ?? '__missing__')` do
`readStripeConnection()` global e verificam assinatura contra um único
`STRIPE_WEBHOOK_SECRET` global, enquanto cobranças passam pelo
`RoutingPaymentAdapter` com contas Connect/fees por-merchant. Sem contexto de
conta Connect na verificação; se o segredo está ausente, o client é `'__missing__'`
e só falha tarde com erro Stripe opaco.
*Remediação:* fail-fast quando `secretKey`/`webhookSecret` ausentes (erro de
config no init); rotear verificação de assinatura por conta Connect onde
aplicável.
*Contrato/migração:* não (config/boot).

**#10 — `reconcile-payment-intents` varre todos os tenants sem escopo e sem
isolamento por-intent (performance).** uc:55-72 / repo:156-166.
*Causa-raiz:* `listStalePending` consulta por `status+updatedAt` sem
`merchantId` e com LIMIT global (default 50), depois itera
`provider.fetchPaymentStatus` sequencialmente. É batch cross-tenant
(aceitável para job de sistema), mas um merchant com muitos intents stale
faminta os demais sob o limite global, e uma chamada lenta/lançando (sem
try/catch por iteração) aborta o passe inteiro.
*Remediação:* `try/catch` por candidato (uma falha não aborta o lote); registrar
outcome `error` por-intent; considerar round-robin/cap por-merchant sob o limite
global.
*Contrato/migração:* não.

**#11 — Valor do intent deriva de totais de sessão lidos não-atomicamente —
TOCTOU entre preço e cobrança (data).** `create-payment-intent` (137-142, 170).
*Causa-raiz:* `orderAmountCents` vem de `session.cart.total + shipping.customerPrice
- cart.currentDiscount` (123), mas o cart é re-validado
(`ensurePendingCommerceOrder`/`validateCommerceCart`) contra
`clientReportedTotalCents=Math.round(session.cart.total*100)` — que **exclui**
frete e desconto. O valor cobrado (`amountCents`) é o derivado da sessão, não o
`trustedCart` validado pelo commerce; divergência não é reconciliada antes de
cobrar. Aritmética float (unidades maiores ×100 + round) também.
*Remediação:* cobrar do total `trustedCart` validado (com frete/desconto
consistentes) ou assertar `centavos derivados da sessão === centavos validados
pelo commerce` antes de criar o intent; aritmética inteira de centavos ponta-a-ponta.
*Contrato/migração:* não (lógica), mas alinha com #15.

**#12 — Autenticação do webhook Asaas é opcional e bypassa quando
`ASAAS_WEBHOOK_TOKEN` ausente (segurança).** `handle-asaas-webhook` (62-67, 88).
*Causa-raiz:* `assertWebhookToken` é no-op quando `expectedToken` vazio/undefined.
Em qualquer ambiente sem `ASAAS_WEBHOOK_TOKEN`, `/webhooks/asaas` aceita POST não
autenticado e marca intents approved/failed com `externalReference`+`value` do
atacante. Sem assinatura criptográfica (diferente do Stripe) — depende de header
compartilhado que faz default open. Comparação `!==` (não constant-time) é
preocupação menor de timing.
*Remediação:* fail-closed — erro de config no startup se ausente em produção;
token sempre obrigatório; comparação constant-time; preferir mecanismo de
assinatura do Asaas se disponível.
*Contrato/migração:* não (config/boot).

### P3

**#13 — Verifier EVM não valida tx única / exposição a reorg na fronteira de
min-confirmations (validação).** `evm-crypto-verifier` (52-93).
*Causa-raiz:* confirmations = `currentBlock - receipt.blockNumber + 1` vs
`minConfirmations` (mainnet=3, testnet=1). 3 confirmações em Polygon/Base é raso
e dentro do range de reorg; sem checagem de finalidade, um transfer que casa em
exatamente 3 confirmações pode ser reorganizado depois com o intent ainda
`approved`. O matcher itera logs mas não assert que há exatamente um Transfer
correspondente.
*Remediação:* elevar min confirmations na mainnet a valor finality-safe (ou usar
block tag `finalized`) e exigir log Transfer único amarrado ao discriminante
por-intent do achado #2.
*Contrato/migração:* não (parâmetro + match), depende de #2.

**#14 — Segredos buyer-facing (`clientSecret`, `qrCode`,
`walletConnectProjectId`) persistidos em JSON claro e retornados pelo status
(segurança).** repo:32/41 / `get-payment-intent-status`:59.
*Causa-raiz:* o payload `buyerFacing` (clientSecret Stripe, QR PIX copia-cola,
invoice URL) é gravado em JSON claro na linha do intent. Chaves de conexão do
merchant **são** cifradas (`payment-secret-cipher`), mas os client secrets de
intent não. `get-payment-intent-status` retorna `receipt_url/invoiceUrl`; a
resposta de create retorna o `buyerFacing` completo com `clientSecret`. O
`clientSecret` Stripe é sensível (confirma o PaymentIntent client-side).
*Remediação:* não persistir `clientSecret` além da resposta de create
(regenerar/retrieve sob demanda) ou cifrar `buyerFacing` em repouso como os
segredos de conexão; garantir que o status nunca ecoe `clientSecret`.
*Contrato/migração:* talvez — se cifrar em repouso, formato da coluna muda.

**#15 — Conversão de dinheiro baseada em float (`cents = round(major*100)`) por
toda a matemática de pagamento (data).** `create-payment-intent` (137-141) /
`handle-asaas-webhook` (69-76) / `asaas-payment.adapter` (45-47).
*Causa-raiz:* valores convertem repetidamente entre unidades maiores (floats) e
centavos via `*100`/`÷100` com `toFixed`/`round`. Intermediários de ponto
flutuante podem produzir off-by-one-cent; o gate de igualdade do webhook
(`centsFromWebhook!==snap.amountCents`) então falha um pagamento exato ou passa
um quase-exato.
*Remediação:* representar dinheiro como inteiro de centavos ponta-a-ponta do cart
ao provedor e ao webhook; onde o provedor retorna unidades maiores, parse com
conversão decimal-safe.
*Contrato/migração:* não (correção interna), alinha #11.

## Alternativas consideradas

- **Manter `hasProcessedProviderEvent` como autoridade (check-then-act) e
  aceitar o risco de duplicidade.** Rejeitado: reentrega de provedor é
  comportamento normal; viola a invariante de idempotência (ADR 0011) na hot path.
- **Confirmar cripto só pelo trio público (to/value/from) sem bind por-intent.**
  Rejeitado: permite replay/colisão de valor; contraria a invariante de
  autorização verificada (ADR 0027).
- **Pós-checagem manual de tenant em cada call site.** Rejeitado: segurança
  passa a depender de todo chamador lembrar; boundary deve morar na porta
  (ADR 0005).
- **Concluir pedido síncrono ao webhook (await inline).** Rejeitado pelo ADR
  0003: perda em falha parcial; usamos outbox + relay.

## Consequências

**Positivas:** caminho de dinheiro idempotente e auditável; autorização de
cripto amarrada ao intent; boundary de tenant na persistência; conclusão
garantida por outbox; matemática determinística em centavos. Viabiliza L3
(ADR 0007/0011).

**Negativas/riscos:** mudanças de contrato (porta `getIntentById`, ordem de
escrita do create, unicidade `(chain, txHash)`, conclusão via relay) exigem
migração coordenada e maior superfície de teste (concorrência, TOCTOU, replay,
poison events). Latência percebida na conclusão migra para o relay (mitigada,
ADR 0003).

**Barra de aceite:** DoD L3 do ADR 0007 + E2E verdes de: webhook duplicado
(Asaas e Stripe) sem efeito duplicado; cripto replay/colisão de valor negado;
cross-tenant negado na porta; Stripe value-mismatch → falha limpa + alerta (sem
poison loop); create com falha de persistência sem cobrança órfã/duplicada;
reconcile com provider lançando não aborta o lote; aritmética de centavos sem
off-by-one.
