# ADR 0002 (commerce) — Commerce: idempotência no boundary do provider e fallback de credenciais

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Commerce), Segurança, Plataforma
- **Relacionado:** [ADR 0002](../../../../../../../docs/architecture/adr/0002-acl-pattern-cross-context.md), [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0011](../../../../../../../docs/architecture/adr/0011-payment-hardening.md), [ADR 0013](../../../../../../../docs/architecture/adr/0013-commerce-shopify-sync-hardening.md). Invariantes: `CLAUDE.md` (idempotência de webhook no boundary do provider; `merchant_id` de tenant; Prisma como única persistência).

## Contexto

O módulo `commerce` é o ACL (ADR 0002) para Shopify/Woo: valida carrinho, cria
pedido pendente, marca pago e lê catálogo. Responsabilidades atuais:

- **Use-cases:** `ValidateCartForPaymentUseCase`, `SyncPendingOrderUseCase`
  (dedup local por `(merchant, session)` via `PendingCommerceOrderIndex`),
  `MarkCommerceOrderPaidUseCase` (dedup por `(merchant, paymentReference)`),
  `manage-commerce-connection.use-cases`.
- **Factory/adapter:** `TenantCommerceAdapterFactory` resolve o adapter do
  provider por `merchant_id`, com `retryWithBackoff` em torno das chamadas; em
  não-produção cai num store global `SHOPIFY_*` por env quando o merchant não
  tem conexão.
- **Portas:** `COMMERCE_CART_PORT`, `COMMERCE_ORDER_PORT`,
  `COMMERCE_CATALOG_PORT`, `COMMERCE_PROVIDER_RUNTIME`,
  `COMMERCE_CONNECTION_PORT`, `COMMERCE_PAID_WEBHOOK_DEDUP`,
  `COMMERCE_PENDING_ORDER_INDEX` (todas com repo Prisma).
- **Eventos:** `commerce.order.pending`, `commerce.order.paid` via outbox.

Invariantes que o módulo deve sustentar: idempotência de webhook **garantida
no boundary do provider** (não só localmente); toda credencial/leitura
escopada por `merchant_id` (ADR 0005); persistência só via Prisma.

## Decisão

Garantir idempotência no boundary do provider e fechar o fallback de tenant:

- a linha de dedup é **reservada antes** da chamada ao provider (insert,
  captura `P2002` → já processado), ou passa-se uma **idempotency key** do
  provider derivada de `paymentReference`/`(merchant, session)`;
- só se re-tenta mutações de provider que aceitem idempotency key;
- o fallback global `SHOPIFY_*` fica atrás de um **flag opt-in** explícito para
  dev local, escopado a um merchant demo conhecido, e **fail-closed** caso
  contrário;
- mensagens de erro do provider **não** são refletidas ao cliente.

## Bugs registrados nesta análise

### P1 — Dedup do webhook de pago é não atômico com `markOrderPaid` retried e não idempotente
- **Classificação:** concorrência. **Precisa de mudança de contrato/migração:** sim (idempotency key no boundary do provider).
- **Arquivos:** `application/mark-commerce-order-paid.use-case.ts:34-52`,
  `infrastructure/tenant-commerce-adapter.factory.ts:101-108`,
  `infrastructure/commerce-retry.ts:24-29`.
- **Causa-raiz:** a linha de dedup é escrita **depois** da chamada externa, não
  atomicamente. Dois webhooks concorrentes com o mesmo `paymentReference`
  passam ambos por `isProcessed=false` e ambos invocam `markOrderPaid` (o
  `P2002` da constraint única só é engolido no insert do dedup, após o efeito
  colateral). Além disso `retryWithBackoff` re-tenta `markOrderPaid` em
  network/5xx — um POST não idempotente sem idempotency key, então uma resposta
  perdida após o provider commitar dispara um segundo mark-paid.
- **Impacto:** pedido do provider marcado pago duas vezes (efeitos de
  fulfillment/financeiro duplicados no Shopify/Woo) sob redelivery concorrente
  ou erro de rede transitório. Invariante de idempotência de webhook não
  garantida no boundary do provider.
- **Remediação decidida:** reservar a linha de dedup primeiro (insert, captura
  `P2002` → já processado) **antes** de chamar o provider, ou passar uma
  idempotency key do provider derivada de `paymentReference`. Só re-tentar
  mutações de provider que aceitem idempotency key.

### P2 — `createPendingOrder` retried em erro transitório sem idempotency key do provider
- **Classificação:** integração. **Precisa de mudança de contrato/migração:** sim (idempotency key no create).
- **Arquivos:** `infrastructure/tenant-commerce-adapter.factory.ts:92-99`,
  `application/sync-pending-order.use-case.ts:33-54`.
- **Causa-raiz:** `retryWithBackoff` re-tenta `createPendingOrder` em
  429/5xx/network. O único dedup é o `PendingCommerceOrderIndex` local por
  `(merchant, session)`, checado antes da chamada; se o provider commitar mas
  a resposta se perder, o retry cria um segundo pedido no provider, e o index
  só registra o id retornado pelo caminho da primeira tentativa (falha).
- **Impacto:** pedidos pendentes duplicados no provider sob falhas de rede
  transitórias, pois o create é um POST não idempotente sendo re-tentado.
- **Remediação decidida:** passar idempotency key estável (ex.: derivada de
  `merchant+session`) ao `createPendingOrder` do provider, ou não re-tentar
  creates sem ela.

### P2 — Fallback global de credenciais Shopify em não-produção serve dados cross-tenant
- **Classificação:** segurança. **Precisa de mudança de contrato/migração:** não (gate por flag).
- **Arquivos:** `infrastructure/tenant-commerce-adapter.factory.ts:24-40,76-84`.
- **Causa-raiz:** quando um merchant não tem conexão de commerce, em
  não-produção `resolve()` cai num único store global `SHOPIFY_*` por env para
  validação de carrinho, criação de pedido e leitura de catálogo — chaveado por
  env, não por merchant.
- **Impacto:** qualquer merchant sem conexão própria transaciona contra um
  único store compartilhado em dev/staging, misturando dados de tenant
  (carrinhos, pedidos, catálogo). Arriscado se staging espelha dados de prod ou
  com `NODE_ENV` mal configurado.
- **Remediação decidida:** gatear o fallback global atrás de um flag opt-in
  explícito só para dev local, escopá-lo a um merchant demo conhecido e
  fail-closed caso contrário.

### P3 — Mensagens de erro do provider refletidas ao cliente via `provider_code`
- **Classificação:** segurança. **Precisa de ADR:** não.
- **Arquivos:** `application/manage-commerce-connection.use-cases.ts:159-173`.
- **Causa-raiz:** `errorCode()` slugifica a mensagem crua do adapter e a retorna
  como `provider_code` no corpo da `BadGatewayException`.
- **Impacto:** texto de erro do provider/interno (e potencialmente fragmentos
  de credenciais ou URLs embutidos nas mensagens) pode vazar para clientes da
  API.
- **Remediação decidida:** mapear erros do provider para uma allow-list fixa de
  códigos estáveis; logar a mensagem crua só no servidor.

## Melhorias para produção

### Segurança
- Fallback global de credenciais gateado por flag e escopado a merchant demo
  (ADR 0005/0009). `provider_code` mapeado a allow-list, sem reflexão de erro
  interno.

### Desacoplamento
- ACL de provider mantém Shopify/Woo atrás das portas (ADR 0002); comunicação
  com payment/checkout só por evento/porta (ADR 0003).

### Persistência & Consistência
- Dedup de pago reservado **antes** do efeito no provider; idempotency key em
  `markOrderPaid`/`createPendingOrder`; retry só de mutações com chave
  (ADR 0011/0013).

### Observabilidade
- Logs com `correlation_id` + `merchant_id`; métricas de retries, P2002
  engolidos e quedas para fallback.

### Otimização & Escala
- Backoff com jitter; circuit breaker por provider.

### Features faltantes
- Reconciliação pedido pendente↔provider; teste de webhook duplicado e de
  resposta perdida após commit do provider.

## Alternativas consideradas
- **Manter dedup após a chamada do provider.** Rejeitado: deixa janela de
  dupla escrita no provider sob concorrência (ADR 0011).
- **Re-tentar todos os POSTs do provider.** Rejeitado: creates/mark-paid sem
  idempotency key não são seguros para retry.

## Consequências
**Positivas:** efeitos no provider idempotentes e auditáveis; fallback de
tenant fail-closed. **Negativas/riscos:** depende de suporte a idempotency key
nos adapters do provider; mudança no fluxo de dedup (ordem do insert).

**Barra de aceite:** E2E de webhook de pago duplicado sem dupla marcação no
provider; create pendente com resposta perdida não duplica; fallback global
negado sem flag; `provider_code` sem texto interno.
