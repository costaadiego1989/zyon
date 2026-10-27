# ADR 0002 (integrations) — Arquitetura do módulo e correções de segurança/concorrência

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Integrations), Segurança, Plataforma
- **Relacionado (ADRs centrais):** [ADR 0002](../../../../../../../docs/architecture/adr/0002-acl-pattern-cross-context.md), [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0004](../../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0017](../../../../../../../docs/architecture/adr/0017-integrations-api-keys-webhooks.md), [ADR 0028](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Relacionado local: [ADR 0001 (integrations) — Log de entregas e exposição do signing secret](./0001-webhook-deliveries-and-signing-secret-exposure.md).

## Contexto

`integrations` é o contexto de saída do AACP: emite **API keys de merchant**
(escopadas, com hash em repouso) e entrega **webhooks assinados** para os
sistemas externos do tenant. Decisão de arquitetura: ADRs vivem ao lado do
código (este diretório), com cross-link para os ADRs centrais.

Responsabilidades e portas:

- **Domínio:** `api-key.service.ts` (geração `rawKey` + `keyHash` sha256),
  `webhook-signature.service.ts` (HMAC), `api-key-scope.ts`,
  `api-key-access-policy.ts` (normalização de CIDRs), tipos em
  `integrations.types.ts`. Porta de persistência:
  `ports/integrations.repository.port.ts`. Porta de saída de rede:
  `ports/webhook-target-policy.port.ts`.
- **Aplicação:** `integrations.use-cases.ts` (CRUD de API keys e endpoints,
  `TenantWebhookPublisher`), `authenticate-merchant-api-key.service.ts`,
  `webhook-delivery-dispatcher.service.ts` (poller `setInterval` +
  `dispatchDelivery` inline).
- **Infra:** `prisma-integrations.repository.ts`,
  `dns-webhook-target-policy.ts` (allow-list anti-SSRF por resolução DNS),
  `event-handlers/tenant-webhooks-on-checkout.handler.ts` (assina
  `order.completed` e faz fan-out de `order.created`/`order.approved`/
  `customer.upserted`).
- **Apresentação:** `integrations.controller.ts`,
  `webhook-endpoints.controller.ts`, `tenant-tracking.controller.ts`, guards
  de credencial/escopo/tenant.

Fluxos-chave: (1) console cria API key → retorna `secret_key` uma única vez;
(2) `order.completed` → publica deliveries (`status=pending`) e dispara inline
+ poller de background; (3) entrega faz POST assinado HMAC com retry/backoff
até `MAX_ATTEMPTS=5`.

Invariantes que o módulo deve sustentar (CLAUDE.md / ADR 0017):
- API key **nunca em claro** após criação — só `keyHash` (sha256) em repouso;
- `merchant_id` sempre do contexto de tenant, nunca do body (ADR 0005/0009);
- entrega `at-least-once` com idempotência por entrega e sem fila só em memória;
- nenhuma resposta/saída pode vazar segredo em log ou store de uso geral.

## Decisão

Manter a arquitetura porta/adaptador atual e **corrigir quatro defeitos**
(dois P0/P1 de segurança, um P1 de concorrência, um P2 de idempotência),
além de saldar dívidas P2 de persistência/performance. As correções que
alteram contrato ou schema estão marcadas abaixo.

## Melhorias para produção

### Segurança

**[P0 — SSRF via DNS rebinding (validate/use TOCTOU)] — precisa de contrato.**
`DnsWebhookTargetPolicy.assertAllowed()` resolve o hostname com `dns.lookup`,
valida que os IPs são unicast público e então retorna `url.toString()` (o
HOSTNAME, não um IP fixado). O dispatcher chama `fetch(endpointUrl)`, que faz
uma resolução DNS **independente**. Um atacante que controla o DNS do próprio
endpoint de webhook devolve um IP público no momento da checagem e um IP
privado/link-local (`169.254.169.254` metadata, `10.x`, `127.0.0.1`) no
momento do `fetch`. A garantia de IP público nunca recai sobre a conexão real.
- **Causa-raiz:** checagem e uso não compartilham o endereço resolvido (TOCTOU).
- **Impacto:** SSRF a partir do egress da API — leitura de metadata da instância
  (credenciais IAM), alcance a serviços internos, port-scan da VPC. Qualquer
  merchant pode disparar via endpoint normal + dispatcher de background.
- **Remediação decidida:** resolver uma vez e **fixar a conexão ao IP
  validado** — a policy passa a retornar o IP (ou conjunto) vetado; o dispatch
  usa um `http(s).Agent` com `lookup` customizado que só entrega o endereço
  pré-validado (ou `fetch` com override de servername/Host). Re-validar todo
  endereço resolvido (já feito) **e** vincular o `fetch` a esse endereço exato.
- **Contrato:** `WebhookTargetPolicy.assertAllowed` muda de `Promise<string>`
  (URL) para retornar `{ url, pinnedAddresses: string[] }`.

**[P1 — segredos em claro no store de idempotência] — precisa de contrato.**
`POST /integrations/api-keys` (`@Idempotent`) retorna `{ secret_key }` e a
criação de endpoint retorna `{ signingSecret }`. O `IdempotencyInterceptor`
chama `repository.complete(..., { responseBody: body })` e persiste o corpo
completo por 24h para replay. O segredo cru fica gravado em claro na tabela de
idempotência, derrotando o modelo de só-hash do `MerchantApiKey`.
- **Causa-raiz:** rotas que retornam segredo são persistidas integralmente
  pelo interceptor genérico.
- **Impacto:** credenciais de vida longa em claro em repouso numa tabela de uso
  geral; amplia o raio de qualquer leitura de DB/backup/log.
- **Remediação decidida:** adicionar opção de rota `doNotPersistBody` ao
  `@Idempotent` (pular persistência do corpo para rotas de segredo) **ou**
  redigir campos conhecidos (`secret_key`, `signingSecret`) antes de
  `complete()`. No replay, devolver `409`/referência em vez do segredo.
- **Contrato:** novo campo em `IdempotencyOptions` (`doNotPersistBody`/
  `redactResponseFields`); replay de POST de segredo deixa de devolver o segredo.

### Desacoplamento
- Manter consumo de fatos só por evento (`order.completed`) e ACL de entrega
  HTTP (ADR 0002/0003). A policy de target é a fronteira de egress — manter
  como porta.

### Persistência & Consistência

**[P1 — webhooks duplicados: dispatch inline corre com o poller] — precisa de
migração.** Em `order.completed` o handler publica deliveries
(`status=pending`, `nextAttemptAt=now`) e chama `dispatcher.dispatchDelivery()`
inline. O timer de background também roda `dispatchOnce()` →
`listDueWebhookDeliveries(['pending'])`. `process()` faz o POST **antes** de
qualquer transição de status para um estado in-flight, então uma linha
`pending` pode ser selecionada pelo poller enquanto o dispatch inline está em
pleno `fetch` (ou por dois ticks sobrepostos quando o endpoint é mais lento que
o intervalo de 10s). Não há claim por linha / `SELECT … FOR UPDATE` / flip
atômico de status.
- **Impacto:** POSTs duplicados para o mesmo `event_id` (at-least-once sem
  single-flight); merchants reprocessam pedidos salvo dedupe próprio.
- **Remediação decidida:** **claim atômico antes de enviar** —
  `updateMany(where status='pending' AND id=…, data status='sending')` e só
  fazer POST se `count===1`; resetar para `pending`/`failed` no `finally`. Como
  alternativa, remover o dispatch inline e confiar só no poller com claim.
- **Migração:** adicionar `'sending'` a `WebhookDeliveryStatus`
  (`"pending" | "sending" | "delivered" | "failed"`) — coluna de status do
  schema Prisma.

**[P2 — fan-out de order.completed sem idempotência contra redelivery] — sem
ADR de contrato.** `TenantWebhookPublisher.publish()` gera `event_id` novo
(`evt_${randomUUID()}`) a cada chamada. O upsert de `saveWebhookDelivery`
deduplica por `(endpointId,eventId)`, mas como o `event_id` é sempre novo a
constraint nunca colide. Se o bus reentregar `order.completed`
(at-least-once), o handler re-emite tudo com `event_id` novo → deliveries
duplicadas.
- **Remediação decidida:** derivar `event_id` determinístico da fonte (hash de
  `merchantId+externalOrderId+eventType`) para que o upsert
  `(endpointId,eventId)` deduplique entre redeliveries; ou consumir o evento de
  domínio idempotentemente via chave de dedupe da outbox/inbox (ADR 0003).

**[P2 — listagem por endpoint filtra após limite merchant-wide] — sem ADR de
contrato.** `GET /webhook-endpoints/:id/deliveries` chama
`listDeliveries(merchantId, limit)` (merchant-wide, teto 100) e filtra
`d.endpointId === endpointId` em memória. Para um merchant com vários endpoints
movimentados, as deliveries do endpoint pedido podem estar ausentes das
primeiras 100 linhas. `has_more`/`next_cursor` são `false`/`null` fixos.
- **Remediação decidida:** método de repo
  `listWebhookDeliveriesByEndpoint(merchantId, endpointId, cursor, limit)` que
  filtra em SQL e devolve cursor/`has_more` reais.

**[P2 — `update()` com `merchantId` não-único no where (extendedWhereUnique)]
— sem ADR de contrato.** `setApiKeyExpiry` e `revokeApiKey` chamam
`prisma.merchantApiKey.update({ where: { id, merchantId } })`. `update/delete`
aceita só inputs únicos salvo `extendedWhereUnique` ligado; o cast
`(this.prisma as any)` esconde isso do type-checker. O repo de `installations`
usa corretamente `updateMany({where:{id,merchantId}})` + checagem de `count`.
- **Remediação decidida:** espelhar o padrão de `installations` —
  `updateMany({where:{id,merchantId}})` + `count===1`, depois refetch; ou
  confirmar e documentar que `extendedWhereUnique` é intencional. Não foi
  possível verificar a versão do Prisma neste passo read-only.

### Observabilidade

**[P2 — write amplification em `lastUsedAt`] — sem ADR de contrato.**
`AuthenticateMerchantApiKeyService.execute` faz `await touchApiKeyLastUsed()`
em toda requisição autenticada → UPDATE síncrono na linha da chave por
chamada. Em alto RPS isso martela uma linha (contenção de lock, churn de
WAL/replicação) e adiciona latência ao caminho crítico de auth.
- **Remediação decidida:** throttle do touch (só atualizar se `lastUsedAt` mais
  velho que N minutos), torná-lo fire-and-forget (não-aguardado, erro
  engolido), ou mover o tracking para sink assíncrono/em lote.

### Otimização & Escala
- Backoff exponencial já existe (`Math.pow(2, attempts) * 30`, teto 3600s);
  considerar circuit breaker por endpoint e limite de concorrência por tenant
  (ADR 0017).

### Features faltantes
- DLQ + reentrega manual visíveis no dashboard (ADR 0017/0024);
- contract test do dispatcher cobrindo single-flight e SSRF pinning.

## Alternativas consideradas
- **Continuar com dispatch inline + poller sem claim.** Rejeitado: duplicação
  garantida sob endpoint lento.
- **Re-resolver DNS no fetch (status quo).** Rejeitado: é exatamente o vetor de
  rebinding; o IP precisa ser fixado.
- **Marcar todas as rotas idempotentes como não-persistir corpo.** Rejeitado:
  quebra replay legítimo de rotas sem segredo; a opção é por rota.

## Consequências
**Positivas:** egress de webhook resistente a SSRF; entrega sem duplicação;
segredos fora do store de replay; auth de leitura sem hot row.
**Negativas/riscos:** o pinning de IP exige agente HTTP customizado (mais
superfície de teste de TLS/SNI); novo status `sending` exige migração e
varredura de linhas presas em `sending` (timeout de reset).

**Barra de aceite:** E2E verdes de — SSRF negado por rebinding (IP privado no
fetch bloqueado), entrega duplicada impedida sob endpoint lento, replay de
criação de API key não devolve `secret_key`, e redelivery de `order.completed`
não gera webhooks repetidos.
