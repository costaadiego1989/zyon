# ADR 0003 (widget/hooks) — `use-global-auth`: identificação do comprador (telefone/e-mail/OTP) e sessão global

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Segurança, Produto
- **Relacionado:** [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0015](../../../../../../docs/architecture/adr/0015-auth-and-tenant-onboarding.md), [ADR 0018](../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md), [ADR 0023](../../../../../../docs/architecture/adr/0023-widget-shell-identity-experience.md). Módulos irmãos: [`use-checkout-session`](./0002-use-checkout-session.md), [`GlobalAuthModal`](../../../components/checkout/docs/adr/0002-global-auth-modal.md).

## Contexto

`use-global-auth.ts` é o controlador de identidade do comprador no widget,
cobrindo três vias de autenticação e a sessão global persistida:

- **Senha:** `submit()` (login/register) → `/auth/login` ou `/auth/register`.
- **Telefone/OTP:** `sendPhoneCode` → `/buyer/phone/send`; `verifyPhoneCode`
  → `/buyer/phone/verify`.
- **A partir do checkout:** `loginFromCheckoutSession` /
  `refreshBuyerFromCheckoutSession` → `/buyer/login-from-session`.
- **Persistência:** `safeReadSession` / `persist` em `aacp_global_auth_session`;
  `stableDeviceId` em `aacp_global_device_id`.
- **`parseBuyerAuthPayload(payload, merchantId?)`** — normaliza payloads
  buyer/snake-case em `GlobalAuthSession`, carimbando `merchant_id`.

**Portas:** schemas Zod (`authResponseSchema`, `buyerAuthResponseSchema`,
`globalAuthSessionSchema`), `normalizeApiBase`.

**Invariantes que o módulo deve manter:**

1. Toda `GlobalAuthSession` persistida carrega o `merchant_id` ativo (o account
   hub depende dele — `use-checkout-agent-view-model.ts:111`).
2. Falha de rede em qualquer via produz feedback ao usuário.
3. Token expirado é tratado como ausência de sessão (re-auth proativo).
4. Sessão/identidade não cruza tenants (ver [`use-checkout-session`](./0002-use-checkout-session.md)).

## Decisão

Padronizar a propagação de `merchant_id`, o tratamento de expiração e o
feedback de erro entre as três vias de autenticação.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P1** | Sessão por OTP de telefone sem `merchant_id`, quebrando o account hub (312–346) | `verifyPhoneCode` chama `parseBuyerAuthPayload(payload)` **sem** `merchantId` (linha 331), então a `GlobalAuthSession` persistida fica com `merchant_id: undefined`. O view model só habilita `useAccountHub` quando `Boolean(auth.session?.merchant_id)`. Comprador verificado por telefone abre o hub mas os dados nunca carregam. | Passar o `merchantId` ativo a `parseBuyerAuthPayload` a partir de `verifyPhoneCode`, espelhando `refreshBuyerFromCheckoutSession`; garantir que o label de provider reflita telefone vs senha corretamente. | Não. |
| **P2** | Login/registro por senha engole erros de rede sem `catch` (186–282) | `submit()` envolve o fetch em `try { … } finally` sem `catch`. Uma rejeição de rede escapa como unhandled rejection; `loading` reseta mas nenhum estado de erro é setado — falha silenciosa, diferente das vias de telefone. | Adicionar `catch` que seta erro voltado ao usuário (`"Erro de rede ao autenticar."`) em torno dos fetches de login/register, igual a `sendPhoneCode`/`verifyPhoneCode`. | Não. |
| **P2** | Tokens de auth expirados tratados como válidos (16–27) | `safeReadSession` retorna qualquer sessão armazenada ignorando `expires_in`, e `loginFromCheckoutSession` retorna `true` em token presente-mas-expirado (366–369). A expiração nunca é checada → 401 garantido + flicker de logout na próxima chamada do buyer-hub em vez de re-auth limpo. | Persistir um timestamp de expiração absoluto junto da sessão; tratar tokens expirados como ausência de sessão em `safeReadSession` e `loginFromCheckoutSession`, disparando refresh proativo. | **Sim (leve)** — adiciona campo `expires_at` ao objeto persistido; `globalAuthSessionSchema` deve aceitá-lo. Sessões legadas sem o campo tratadas como expiradas. |

## Melhorias para produção

### Segurança
- `merchant_id` sempre presente e validado contra o tenant ativo (ADR 0005).
- Token expirado nunca reutilizado; re-auth proativo.

### Desacoplamento
- Normalização de payload concentrada em `parseBuyerAuthPayload`; respostas
  validadas por schema (ADR 0025).

### Persistência & Consistência
- `expires_at` absoluto persistido; sessões legadas degradam para expiradas.

### Observabilidade
- Estado de erro setado em todas as vias (sem falha silenciosa); log de token
  expirado descartado.

### Otimização & Escala
- Refresh proativo evita 401 + flicker no buyer-hub.

### Features faltantes
- Unificar o `provider` (phone vs password) corretamente no payload buyer.

## Alternativas consideradas
- **Confiar no 401 do servidor para detectar expiração.** Rejeitado: produz
  flicker de logout e UX ruim; checagem local de expiração é proativa.
- **Manter `submit` sem `catch` e capturar globalmente.** Rejeitado: sem
  feedback contextual ao usuário.

## Consequências
**Positivas:** hub funcional após OTP; feedback consistente; re-auth limpo.
**Negativas/riscos:** schema da sessão muda (campo de expiração); sessões
legadas precisam re-login.

**Barra de aceite:** comprador via OTP abre o hub com dados carregados; falha de
rede no login por senha mostra erro; token expirado dispara re-auth sem 401.
