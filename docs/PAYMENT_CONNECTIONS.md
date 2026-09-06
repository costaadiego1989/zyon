# Payment Connections — Stripe Connect & Asaas Subaccounts

## Visão Geral

A AACP opera como **platform/marketplace**. O dinheiro do comprador entra na conta platform da AACP e é automaticamente dividido (split) para o merchant. Merchants não inserem chaves de API — eles completam um onboarding externo (KYC) e recebem pagamentos automaticamente.

```
Buyer paga → Platform AACP recebe → Split automático → Merchant recebe
                                   → Platform fee (configurável por plano)
```

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  AACP Platform Account                                      │
│  - STRIPE_SECRET_KEY (sk_live_...)                          │
│  - ASAAS_API_KEY ($$aact_prod_...)                          │
│  - Chaves pertencem à AACP, NÃO ao merchant                │
├─────────────────────────────────────────────────────────────┤
│  Merchant A          Merchant B          Merchant C         │
│  ┌──────────┐       ┌──────────┐       ┌──────────┐        │
│  │ Stripe   │       │ Asaas    │       │ Stripe   │        │
│  │ Connect  │       │ Subacct  │       │ Connect  │        │
│  │ acct_xxx │       │ wallet_y │       │ acct_zzz │        │
│  └──────────┘       └──────────┘       └──────────┘        │
└─────────────────────────────────────────────────────────────┘
```

---

## Stripe Connect (Cartão de Crédito/Débito)

### Modelo: Platform com Connected Accounts

- AACP cria um **Connected Account** no Stripe para cada merchant
- Buyer paga → PaymentIntent com `transfer_data.destination = acct_merchant`
- Platform fee automático via `application_fee_amount`
- Merchant recebe no bank account configurado no Stripe

### Fluxo do Merchant (Dashboard)

```
1. Merchant login no dashboard AACP
2. Navega: Pagamentos → Conectar Stripe
3. Clica "Conectar" → API cria Connected Account + gera Onboarding Link
4. Merchant é redirecionado para Stripe hosted onboarding
5. Completa KYC: dados pessoais, banco, documentos
6. Stripe redireciona de volta → AACP sync status
7. Connection status = "active" → merchant pode receber pagamentos
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|----------|
| POST | `/v1/payments/connections/stripe/onboarding-link` | Cria account + retorna URL onboarding |
| POST | `/v1/payments/connections/stripe/sync` | Sincroniza status do connected account |
| GET | `/v1/payments/connections` | Lista conexões do merchant |
| DELETE | `/v1/merchants/me/payment-connections/stripe` | Desconecta Stripe |

### Request/Response: Onboarding Link

```bash
POST /v1/payments/connections/stripe/onboarding-link
Authorization: Bearer <merchant_access_token>
Idempotency-Key: stripe_onboard_001
```

```json
// Response 201
{
  "url": "https://connect.stripe.com/setup/s/acct_xxx/xxx",
  "expires_at": "2026-07-27T03:00:00.000Z",
  "connection": {
    "id": "mrc_xxx:stripe",
    "provider": "stripe",
    "status": "pending",
    "account_id": "acct_xxx",
    "charges_enabled": false,
    "payouts_enabled": false,
    "requirements": ["individual.verification.document"]
  }
}
```

### Payment Intent com Connected Account

```typescript
// Quando buyer paga com cartão:
stripe.paymentIntents.create({
  amount: 2990, // R$ 29,90
  currency: 'brl',
  transfer_data: { destination: 'acct_merchant_xxx' },
  application_fee_amount: 120, // R$ 1,20 platform fee
  // client_secret retornado para frontend Stripe.js
});
```

### Webhook Stripe → AACP

| Evento | Ação |
|--------|------|
| `payment_intent.succeeded` | Completa pedido, notifica widget |
| `payment_intent.payment_failed` | Marca intent failed, mostra erro |
| `account.updated` | Sync status da connection |

**Rota webhook:** `POST /v1/webhooks/stripe`
**Secret:** `STRIPE_WEBHOOK_SECRET` (whsec_...)

### Env necessária (Platform AACP)

```env
STRIPE_SECRET_KEY=sk_live_...     # Chave da conta platform AACP
STRIPE_PUBLISHABLE_KEY=pk_live_...  # Chave pública para Stripe.js
STRIPE_WEBHOOK_SECRET=whsec_...     # Assinatura do webhook
```

### Status possíveis da Connection

| Status | Significado |
|--------|------------|
| `pending` | Account criado, onboarding não completado |
| `restricted` | KYC incompleto, precisa de documentos |
| `active` | Pronto para receber pagamentos |
| `degraded` | Erro de sync, tentar novamente |

---

## Asaas Subaccounts (PIX / Boleto)

### Modelo: Platform com Subaccounts + Split

- AACP cria uma **subaccount** no Asaas para cada merchant
- Subaccount tem seu próprio wallet e API key
- Buyer paga PIX → Asaas processa → Split automático
- Merchant recebe na conta bancária vinculada à subaccount

### Fluxo do Merchant (Dashboard)

```
1. Merchant login no dashboard AACP
2. Navega: Pagamentos → Conectar Asaas
3. Preenche dados empresariais (CNPJ, endereço, etc)
4. API cria subaccount no Asaas
5. Merchant recebe link de onboarding para enviar documentos
6. Asaas aprova documentação
7. Connection status = "active" → merchant pode receber PIX/boleto
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|----------|
| POST | `/v1/payments/connections/asaas` | Cria subaccount com dados do merchant |
| POST | `/v1/payments/connections/asaas/onboarding-link` | Retorna URL para envio de docs |
| POST | `/v1/payments/connections/asaas/sync` | Sincroniza status da subaccount |
| GET | `/v1/payments/connections` | Lista conexões do merchant |
| DELETE | `/v1/merchants/me/payment-connections/asaas` | Desconecta Asaas |

### Request: Criar Subaccount

```bash
POST /v1/payments/connections/asaas
Authorization: Bearer <merchant_access_token>
Idempotency-Key: asaas_sub_001
Content-Type: application/json
```

```json
{
  "name": "Loja do Merchant",
  "email": "merchant@loja.com",
  "cpf_cnpj": "12345678000195",
  "mobile_phone": "21999999999",
  "income_value": 10000.00,
  "address": "Rua Exemplo 456",
  "address_number": "456",
  "province": "Centro",
  "postal_code": "01001000"
}
```

```json
// Response 201
{
  "id": "mrc_xxx:asaas",
  "provider": "asaas",
  "status": "pending",
  "account_id": "sub_asaas_xxx",
  "wallet_id": "wal_xxx",
  "charges_enabled": false,
  "requirements": ["documentation"]
}
```

### Cobrança PIX com Subaccount

```typescript
// API usa a api_key da subaccount do merchant para criar cobrança:
asaas.createPayment({
  customer: 'cus_buyer_xxx',
  billingType: 'PIX',
  value: 29.90,
  // Credenciais da subaccount do merchant (armazenadas encriptadas)
});
// Retorna QR code + copia-e-cola para o buyer
```

### Webhook Asaas → AACP

| Evento | Ação |
|--------|------|
| `PAYMENT_RECEIVED` | Completa pedido, notifica widget |
| `PAYMENT_OVERDUE` | Marca intent como failed |
| `PAYMENT_DELETED` | Marca intent como failed |
| `PAYMENT_REFUNDED` | Marca como refunded |

**Rota webhook:** `POST /v1/webhooks/asaas`
**Autenticação:** Header `asaas-access-token` ou `x-aacp-signature` (HMAC sha256)
**Validação:** `hash_equals(expected, received)` + timestamp freshness (5 min)

### Env necessária (Platform AACP)

```env
ASAAS_API_KEY=$$aact_prod_...       # Chave master da platform AACP
ASAAS_WEBHOOK_TOKEN=whsec_...        # Token de validação webhook
ASAAS_SANDBOX=false                  # true para sandbox/teste
ASAAS_BASE_URL=https://www.asaas.com/api/v3
```

### Status possíveis da Connection

| Status | Significado |
|--------|------------|
| `pending` | Subaccount criada, documentação pendente |
| `restricted` | Documentos em análise pelo Asaas |
| `active` | Aprovado, pronto para receber |
| `degraded` | Erro de sync ou API Asaas indisponível |

---

## Modelo Alternativo: Direct Keys (WooCommerce Plugin)

Para merchants que já possuem conta Asaas própria e preferem usar suas chaves:

```bash
POST /v1/merchants/me/payment-connections/asaas
Authorization: Bearer <merchant_access_token>
Content-Type: application/json
```

```json
{
  "api_key": "$aact_...",
  "webhook_token": "whsec_...",
  "sandbox": false
}
```

Nesse modelo:
- Merchant insere suas próprias chaves
- Dinheiro vai direto para a conta do merchant
- Sem split/platform fee automático
- Chaves armazenadas com **authenticated encryption** (AES-256-GCM)
- Usado pelo WooCommerce plugin quando merchant já tem conta Asaas

---

## Segurança

| Aspecto | Implementação |
|---------|---------------|
| Chaves merchant | Encriptadas AES-256-GCM em repouso |
| Webhook validation | HMAC SHA256 + timestamp freshness (5 min) |
| Stripe webhook | Stripe signature verification nativa |
| Acesso endpoints | `TenantCredentialGuard` + `TenantAccessGuard` + role owner/admin |
| Idempotência | Header `Idempotency-Key` obrigatório em mutations |
| Secrets no log | Pino redaction em headers/payload sensíveis |

---

## Dashboard UX (Merchant)

### Página: Pagamentos → Conexões

```
┌─────────────────────────────────────────────────┐
│  Conexões de Pagamento                          │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──── Stripe (Cartão) ────────────────────┐    │
│  │ Status: ● Ativo                         │    │
│  │ Account: acct_xxx...xxx                 │    │
│  │ Charges: ✓  Payouts: ✓                  │    │
│  │ [Sincronizar] [Desconectar]             │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌──── Asaas (PIX/Boleto) ─────────────────┐   │
│  │ Status: ◐ Pendente                      │    │
│  │ Requisitos: documentação                │    │
│  │ [Enviar documentos] [Sincronizar]       │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Verificação: Tudo Implementado?

| Feature | Status | Evidência |
|---------|--------|----------|
| Stripe Connect account creation | ✅ | `StripePlatformAdapter.createConnectAccount` |
| Stripe onboarding hosted link | ✅ | `createConnectOnboardingLink` |
| Stripe sync/status check | ✅ | `SyncStripeConnectUseCase` |
| Stripe PaymentIntent com transfer_data | ✅ | `stripe-payment.adapter.ts:54-56` |
| Stripe platform fee | ✅ | `readPlatformFeeCents()` |
| Stripe webhook handler | ✅ | `HandleStripeWebhookUseCase` |
| Asaas subaccount creation | ✅ | `CreateAsaasSubaccountUseCase` |
| Asaas subaccount API key storage (encrypted) | ✅ | `PrismaPaymentPlatformRepository` |
| Asaas onboarding link | ✅ | `GetAsaasOnboardingLinkUseCase` |
| Asaas sync/status check | ✅ | `SyncAsaasSubaccountUseCase` |
| Asaas PIX payment creation | ✅ | `AsaasPaymentAdapter.createPayment` |
| Asaas webhook handler + HMAC | ✅ | `HandleAsaasWebhookUseCase` |
| Asaas webhook timestamp freshness | ✅ | 5 min window |
| Conexão Asaas automática no dashboard | ✅ | `CreateAsaasSubaccountUseCase` (recuperar ou criar) |
| Dashboard: listar conexões | ✅ | `GET /payments/connections` |
| Dashboard: desconectar | ✅ | `DELETE /merchants/me/payment-connections/:provider` |
| Billing plans + platform fee | ✅ | `BillingController` + `EnvironmentBillingConfig` |
| WooCommerce plugin: webhook receive | ✅ | `WebhookHandler.php` |
| WooCommerce plugin: order sync outbound | ✅ | `OrderSync.php` |

---

## O que NÃO está implementado (fora do escopo atual)

- Stripe Connect Express dashboard para merchant ver balanço
- Asaas split automático configurável por merchant (usa wallet transfer)
- Multi-provider por merchant (usar Stripe E Asaas simultaneamente)
- Payout scheduling customizado
- Chargeback/dispute handling automático

## Conexão automática do Asaas

No onboarding e em Conexões de pagamento, o lojista confirma os dados cadastrais e escolhe **Conectar Asaas**. Ambiente e credenciais são definidos no servidor.

- Uma conexão já salva é reutilizada e sincronizada com o Asaas.
- Uma subconta gerenciada pela plataforma pode ser recuperada pelo CPF/CNPJ quando o titular corresponde ao e-mail autenticado. A chave é gerada no servidor e armazenada pelo repositório criptografado.
- Quando não há conta recuperável, o servidor cria a subconta e salva a credencial antes das consultas de status. Se a consulta falhar, a próxima tentativa reutiliza a conexão salva.
- `ASAAS_PLATFORM_MERCHANT_ID` associa explicitamente a conta principal à loja operadora da plataforma. Configure apenas o ID confiável dessa loja; o servidor também compara o documento com o cadastro Asaas. Informar o CNPJ no formulário não autoriza outros lojistas a usar a conta principal.
- A aprovação continua sendo determinada pelo Asaas. Cadastro em análise permanece pendente.

A recuperação de chaves de subcontas depende da liberação de gerenciamento e do IP autorizado na conta-pai. Contas independentes fora da gestão da plataforma não podem ser apropriadas apenas pelo CPF/CNPJ. Consulte [gerenciamento de chaves](https://docs.asaas.com/docs/gerenciamento-de-chaves-de-api-de-subcontas) e [listagem de subcontas](https://docs.asaas.com/reference/listar-subcontas).
