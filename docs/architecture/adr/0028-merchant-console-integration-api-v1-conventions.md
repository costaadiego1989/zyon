# AACP Integration API V1: convencoes HTTP

## Base e representacao

- Base publica: `/v1`.
- `Content-Type`: `application/json`.
- Campos: `snake_case`.
- Datas: ISO 8601 UTC.
- Valores monetarios: inteiros em minor units.
- Tenant: sempre derivado da credencial.
- `merchant_id` ou `tenant_id` em payload autenticado deve ser rejeitado.

## Autenticacao

```http
Authorization: Bearer aacp_test_example
```

O header `x-aacp-api-key` e temporario e sera removido apos o cutover. Sessoes
do Merchant Console usam cookie `HttpOnly`; chaves de servico nunca devem ser
armazenadas no navegador.

### Chaves de servico

- sandbox: prefixo `aacp_test_*`;
- producao: prefixo `aacp_live_*`;
- o segredo e exibido somente na criacao ou rotacao;
- cada chave possui ambiente, escopos, expiracao opcional e CIDRs opcionais;
- rotacao cria uma nova chave e limita a anterior a uma janela de overlap;
- revogacao e imediata;
- chaves legadas `aacp_sk_*` continuam validas apenas durante o cutover.

Escopos V1:

```text
checkout:read          checkout:write
configuration:read     configuration:write
orders:read            orders:write
customers:read
catalog:read
embed:sessions:create
tracking:read          tracking:write
commerce:read          commerce:write
payments:read
support:read           support:write
webhooks:read          webhooks:write
audit:read
```

## Paginacao

```json
{
  "data": [],
  "next_cursor": "opaque_cursor_or_null",
  "has_more": false
}
```

Cursores sao opacos, tenant-scoped e estaveis para a ordenacao documentada.

## Erros

Erros seguem `application/problem+json`:

```json
{
  "type": "https://docs.aacp.dev/problems/validation_failed",
  "title": "Validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "One or more fields are invalid.",
  "fields": {
    "email": ["must be a valid email address"]
  },
  "correlation_id": "corr_01J..."
}
```

## Idempotencia

Mutacoes externas exigem `Idempotency-Key` com 8 a 255 caracteres URL-safe.
A chave e persistida por tenant por 24 horas junto do fingerprint canonico de
metodo, rota, query e payload. Reutilizar a chave com outro request retorna
`409 idempotency_key_reused`; uma chamada concorrente ainda em processamento
retorna `409 idempotency_request_in_progress`.

Uma repeticao concluida devolve o mesmo status e corpo, preserva headers
relevantes e inclui:

```http
Idempotency-Replayed: true
```

## Concorrencia

Leituras de configuracao retornam `ETag`. Atualizacoes exigem `If-Match`; uma
revisao desatualizada retorna `412 precondition_failed`. A ausencia do header
retorna `428 precondition_required`. A comparacao final tambem ocorre no
repositorio para impedir lost updates entre a leitura e a escrita.

## Correlacao

Toda resposta inclui `x-correlation-id`. Um identificador valido enviado pelo
cliente e propagado; valores ausentes ou invalidos sao substituidos por um
identificador gerado pela API. O mesmo valor aparece em logs e em
`correlation_id` nos erros RFC 7807.

## Comercio e catalogo

- A V1 permite uma conexao Shopify ou WooCommerce por tenant.
- Credenciais sao criptografadas em envelope versionado e nunca retornam pela API.
- Shopify usa Admin GraphQL para health e catalogo, Storefront GraphQL para
  validar o cart real e a versao padrao `2026-04`.
- WooCommerce usa REST `wc/v3` com Basic Auth sobre HTTPS.
- URLs WooCommerce locais, IP literals e hosts `.local` sao rejeitados.
- A conexao registra `pending`, `healthy` ou `degraded`, ultimo teste,
  ultima sincronizacao e codigo de erro sanitizado.
- `/v1/catalog` retorna produto, variantes, preco em minor units e estoque do
  provedor; o widget consome a mesma fonte tenant-scoped.
- O adapter fake deixou de participar da composicao do `CatalogModule`.

## Pagamentos e billing

- Signup cria somente o tenant, owner e trial local de 14 dias na mesma
  transacao. Nenhuma chamada externa Stripe ou Asaas ocorre durante cadastro.
- Stripe Connect usa conta Express e Account Link hospedado, curto e recriavel.
  O checkout com cartao exige conexao tenant `active`; a plataforma nao absorve
  silenciosamente uma cobranca de merchant sem onboarding concluido.
- Asaas cria uma subconta por tenant. A `apiKey` retornada uma unica vez pelo
  provider e criptografada em repouso e nunca aparece em respostas HTTP.
- O link documental Asaas e obtido por `/v3/myAccount/documents` somente apos a
  janela minima de disponibilidade indicada pelo provider.
- PIX, boleto e cartao Asaas resolvem a credencial da subconta do tenant. Nao ha
  compartilhamento de chave entre merchants.
- Stripe Billing e separado do fluxo de pagamento do comprador. Planos publicos
  usam nomes estaveis; os `price_id` permanecem exclusivamente no servidor.
- Eventos `account.updated`, `checkout.session.completed` e
  `customer.subscription.*` atualizam read models de conexao e assinatura.
- Operacoes de onboarding financeiro e billing exigem sessao humana `OWNER` ou
  `ADMIN`; API keys de servico recebem `403 human_session_required`.
- Provider fake e recusado em producao, inclusive quando habilitado por variavel
  de ambiente ou seed E2E.

Endpoints:

```text
GET  /v1/payments/connections
POST /v1/payments/connections/stripe/onboarding-link
POST /v1/payments/connections/stripe/sync
POST /v1/payments/connections/asaas
POST /v1/payments/connections/asaas/onboarding-link
POST /v1/payments/connections/asaas/sync
GET  /v1/billing/subscription
POST /v1/billing/checkout-session
POST /v1/billing/portal-session
```

## Rate limit

Respostas incluem:

```http
RateLimit-Limit: 120
RateLimit-Remaining: 87
RateLimit-Reset: 42
```

Ao exceder o limite, a API retorna `429` e `Retry-After`.

## Deprecacao

Rotas sem versao retornam `Deprecation: true` durante a migracao. Mudancas
incompativeis exigem nova versao principal, changelog e janela de sobreposicao.

## Documentacao

- Scalar: `/docs`
- OpenAPI JSON: `/openapi.json`
- Sandbox: `https://sandbox-api.aacp.dev/v1`
- Producao: `https://api.aacp.dev/v1`

Somente operacoes explicitamente aprovadas entram no OpenAPI publico.

Referencias de provider:

- https://shopify.dev/docs/api/admin-graphql/latest
- https://shopify.dev/docs/api/storefront/latest/queries/cart
- https://developer.woocommerce.com/docs/apis/rest-api/
- https://woocommerce.github.io/woocommerce-rest-api-docs/
- https://docs.stripe.com/connect/marketplace/tasks/onboard
- https://docs.stripe.com/billing/subscriptions/build-subscriptions
- https://docs.asaas.com/docs/criacao-de-subcontas
- https://docs.asaas.com/docs/onboarding-and-sending-documents-via-link
