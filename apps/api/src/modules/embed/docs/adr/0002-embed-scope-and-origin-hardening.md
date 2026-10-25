# ADR 0002 (embed) — Embed: sessão, escopos de token e binding de origem

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Embed), Segurança, Plataforma
- **Relacionado (ADRs centrais):** [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0012](../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0011](../../../../../../docs/architecture/adr/0011-payment-hardening.md), [ADR 0022](../../../../../../docs/architecture/adr/0022-widget-transactional-path.md). Este ADR vive ao lado do código (decisão do time).

## Contexto

`embed` é a porta de entrada pública do widget na loja. Emite tokens de sessão
(`EmbedTokenService`/`IssueEmbedSessionUseCase`) e os valida no `EmbedAuthGuard`,
que resolve o `merchant_id` para todo o caminho público (ADR 0005, 0012).

### Responsabilidades
- `IssueEmbedSessionUseCase` — assina claims (`merchantId`, `scopes`,
  `allowedOrigin`, `environment`, TTL) num token HMAC-SHA256.
- `EmbedAuthGuard` — verifica assinatura/expiração/tipo, aplica origem
  (`enforceOrigin`) e escopo (`enforceScope`), popula `request.embedClaims`.
- `EmbedCheckoutController` — start/track/chat/cart/offers + intents de
  pagamento (create/confirm/status), sempre forçando `merchant_id` do token.

### Portas / contratos
- `EmbedTokenClaims` / `EmbedScope` (`checkout:start|track|chat`, `offers:apply`,
  `coupons:apply`, `payment:intents:create`).
- Use-cases de checkout/payment consumidos por composição no controller.

### Invariantes que o módulo deve sustentar
- O token é a **única** fonte de `merchant_id`; nenhum endpoint embed confia em
  `merchant_id` do body (ADR 0005/0012).
- Operações sensíveis exigem **escopo declarado** no token.
- Token de produção com escopo de pagamento/ofertas/cupom deve ser **vinculado
  a origem**, mitigando replay (ADR 0012).
- Segredo de embed só de ambiente, falha segura sem ele (ADR 0009).

## Decisão

Fechar o modelo de escopo (todo handler sensível declara escopo), tornar o
binding de origem obrigatório para tokens com escopo transacional, endurecer a
validação de input na emissão e definir o tratamento de `tenantPrincipal` para
o caminho embed quando a idempotência for ligada.

## Bugs encontrados e remediação decidida

### B1 — Confirm/status de pagamento embed sem guard de escopo (P1, segurança)
- **Arquivo:** `presentation/http/embed-checkout.controller.ts:190-249`.
- **Causa raiz:** `confirmCryptoFromEmbed`, `confirmStripeFromEmbed` e
  `paymentStatusFromEmbed` não têm `@RequireEmbedScope`, diferente de
  `create-intent` (que exige `payment:intents:create`). O `EmbedAuthGuard` só
  aplica escopo quando o handler declara um.
- **Impacto:** qualquer token de sessão embed — mesmo um emitido com
  `scopes:["checkout:start"]` — pode confirmar pagamentos crypto/Stripe e ler
  status de intent. O modelo de escopo é contornado nas operações de pagamento
  mais sensíveis.
- **Remediação:** adicionar `@RequireEmbedScope("payment:intents:create")` (ou
  escopos dedicados `payment:intents:confirm`/`payment:intents:read`) aos três
  handlers e estender o contrato `EMBED_SCOPES`/`EmbedScope` conforme.
- **Contrato/migração:** mudança de **contrato de escopos do token** (novos
  valores em `EmbedScope` e em `EMBED_SCOPES` no `IssueEmbedSessionUseCase`).
  Sem migração de schema. Tokens antigos sem o escopo passam a ser negados nos
  confirms (desejado).

### B2 — Binding de origem opcional deixa token usável de qualquer origem (P2, segurança)
- **Arquivo:** `presentation/http/embed-auth.guard.ts:76-82`.
- **Causa raiz:** `enforceOrigin` retorna cedo quando `claims.allowedOrigin`
  está ausente, e `issue-embed-session` só seta `allowedOrigin` quando uma
  installation resolve um — então o caminho comum emite tokens sem restrição de
  origem.
- **Impacto:** um token embed vazado (que pode carregar escopos de
  pagamento/ofertas/cupom) é replayável de qualquer site, pois a origem não é
  fixada. Enfraquece a garantia de binding à loja.
- **Remediação:** exigir `allowedOrigin` para qualquer token que conceda escopos
  de pagamento/ofertas/cupom, ou default-deny quando a origem estiver ausente
  para esses escopos; tornar a origem obrigatória na emissão em ambiente
  `live`.
- **Contrato/migração:** mudança de **contrato de emissão** (origem obrigatória
  para escopos transacionais em live). Sem migração de schema.

### B3 — Rotas embed nunca setam `tenantPrincipal`; `@Idempotent()` ali daria 500 (P2, integração)
- **Arquivos:** `presentation/http/embed-auth.guard.ts:53-74`,
  `../../../shared/http/idempotency/idempotency.interceptor.ts:53`.
- **Causa raiz:** o `EmbedAuthGuard` seta `request.embedClaims` mas não
  `request.tenantPrincipal`. O `IdempotencyInterceptor` global chama
  `currentTenantPrincipal(request)`, que lança `missing_tenant_principal`
  quando nenhum principal foi setado. A criação de payment-intent embed carrega
  `idempotency_key` no body e **não** é decorada com `@Idempotent()`, então a
  idempotência real depende inteiramente do use-case downstream.
- **Impacto:** latente — ligar `@Idempotent()` em qualquer rota embed falha com
  500 em vez de deduplicar. Hoje, requests repetidos de payment-intent só são
  deduplicados se `CreatePaymentIntentUseCase` impor a chave; caso contrário,
  intents duplicados são possíveis.
- **Remediação:** o `EmbedAuthGuard` passa a setar um `tenantPrincipal` de tipo
  service a partir de `claims.merchantId`, e padronizamos que a criação de
  payment-intent embed é idempotente (decorator ou checagem de chave no
  use-case).
- **Contrato/migração:** sem migração; ajuste interno de guard + confirmação de
  contrato de idempotência. **needsAdr=false** no inventário, registrado aqui
  por tocar o contrato transversal de idempotência.

### B4 — `allowed_origin` inválido lança erro de URL cru → 500 em vez de 400 (P3, validação)
- **Arquivo:** `application/issue-embed-session.use-case.ts:60-69`.
- **Causa raiz:** `validateAllowedOrigin` faz `new URL(trimmed)` sem try/catch;
  input malformado lança `TypeError` genérico que vira 500 não-tratado.
- **Impacto:** input ruim do cliente gera 500 (observabilidade/contrato ruim)
  em vez de 400 com código claro.
- **Remediação:** envolver o parse de URL e lançar
  `BadRequestException("embed_allowed_origin_invalid")` na falha.
- **Contrato/migração:** nenhuma.

## Melhorias para produção

### Segurança
- Escopo obrigatório em todo handler sensível (B1); origem obrigatória para
  escopos transacionais em live (B2); `tenantPrincipal` derivado do token (B3);
  validação de origem na emissão (B4). Segredo de embed por ambiente, sem
  default (ADR 0009/0012).

### Desacoplamento
- Embed expõe porta de emissão/validação; outros contextos não leem o segredo
  diretamente (ADR 0012). Pagamento/checkout consumidos por use-case/porta.

### Persistência & Consistência
- Idempotência da criação de payment-intent embed garantida (decorator ou
  use-case), evitando intents duplicados em retry (B3, ADR 0011).

### Observabilidade
- Métricas de sessões emitidas/recusadas por motivo (origin, expiração,
  assinatura, escopo); log com `correlation_id` + `merchant_id`.

### Otimização & Escala
- Rate limit em `/embed/start` por origin/merchant (ADR 0012).

### Features faltantes
- Allowlist de origins por tenant no dashboard (ADR 0024); escopos dedicados de
  confirm/read de pagamento; rotação de segredo em runbook.

## Alternativas consideradas
- **Manter confirm/status sem escopo confiando no `assertSessionBelongsToEmbedMerchant`.**
  Rejeitado: a checagem de sessão garante tenant, não **autorização** — um token
  de menor privilégio não deveria confirmar pagamento (B1).
- **Origem opcional para todos os tokens.** Rejeitado: permite replay de token
  transacional vazado em outra loja (B2, ADR 0012).

## Consequências
**Positivas:** modelo de escopo íntegro nas operações de pagamento; replay de
token mitigado; emissão valida input.
**Negativas/riscos:** novos escopos exigem reemissão de tokens e configuração
de origem pelo tenant (cobrir no onboarding, ADR 0024); ligar idempotência no
embed exige o `tenantPrincipal` de service (B3).

**Barra de aceite:** DoD L3 (ADR 0012) + E2E verde de (a) confirm de pagamento
**negado** sem escopo, (b) token transacional sem origem **negado** em live,
(c) `allowed_origin` inválido → 400, (d) retry de payment-intent deduplicado.
