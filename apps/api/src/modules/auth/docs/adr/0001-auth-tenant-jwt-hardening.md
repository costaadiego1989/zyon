# ADR 0001 (auth) — Auth: JWT, refresh, rate limit e registro de tenant

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Auth/Identidade), Segurança, Plataforma
- **Relacionado (ADRs centrais):** [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0015](../../../../../../docs/architecture/adr/0015-auth-and-tenant-onboarding.md), [ADR 0012](../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0018](../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md). Este ADR vive ao lado do código (decisão do time).

## Contexto

`auth` é o contexto de identidade do **merchant**: registro de tenant + owner,
login por senha (JWT HS256), cookie de auth, refresh e rate limit de login.
Expõe também o `AuthGuard` e o `TenantPrincipal` que **todo** o restante da API
usa para resolver o `merchant_id` do tenant (ADR 0005).

### Responsabilidades
- `RegisterMerchantUseCase` — cria merchant + owner, devolve `access_token`.
- `LoginUseCase` + `LoginRateLimiter` — login por senha com proteção de abuso.
- `JwtService` — assina/verifica JWT HS256 (`sign`/`verify`/`verifyForRefresh`).
- `AuthGuard` — extrai o token (header/cookie), verifica e popula
  `request.user` + `setTenantPrincipal({ kind:"human", tenantId, ... })`.
- `AuthCookieService` — emite/limpa cookie de sessão.

### Portas / contratos
- `AUTH_REPOSITORY` (`findUserByEmail`, `createMerchantWithOwner`) — in-memory
  e Prisma.
- `setTenantPrincipal` / `currentTenantPrincipal` (shared) — fronteira que
  alimenta o `IdempotencyInterceptor` e os repositórios scoped.

### Invariantes que o módulo deve sustentar
- `merchant_id` é a fronteira de tenant; todo principal humano carrega um
  `tenantId` não-vazio (ADR 0005, CLAUDE.md).
- Segredo de JWT só de ambiente em produção (ADR 0009/P0.5); sem default fora
  de dev.
- Tokens de merchant e de buyer são **audiências distintas** e não podem ser
  intercambiáveis (ver ADR 0001 de `buyer-account`).

## Decisão

Endurecer o contexto de identidade do merchant em torno de quatro eixos —
isolamento de audiência do JWT, integridade do limitador de login, revogação de
refresh e integridade do registro — mantendo o `merchant_id` derivado **sempre**
do principal de tenant e nunca do body.

## Bugs encontrados e remediação decidida

### B1 — Confusão de audiência entre JWT de buyer e de merchant (P0, segurança)
- **Arquivos:** `domain/services/jwt.service.ts:36-50`,
  `presentation/auth.guard.ts:26-35` (em conjunto com `buyer-jwt.service.ts:20`).
- **Causa raiz:** `JwtService.verify` recomputa o HMAC-SHA256 sobre
  `header.payload` e aceita qualquer payload bem-assinado. Não verifica `aud`
  nem exige `merchant_id` não-vazio. Como `BuyerJwtService` usa o **mesmo**
  `JWT_SECRET`, um token de buyer (`aud:"buyer"`, sem `merchant_id`) passa a
  checagem de assinatura do `AuthGuard` de merchant; o guard então faz
  `setTenantPrincipal({ tenantId: decoded.merchant_id = undefined })`.
- **Impacto:** quebra total da fronteira de tenant. Onde a rota usa só
  `AuthGuard` + `currentUser` (ex.: `buyer-purchase-history.controller`),
  `merchantId` é `undefined` e cai num `where:{ merchantId: undefined }` que o
  Prisma descarta — retornando dados de **todos** os merchants.
- **Remediação:** em `verify`, **rejeitar** tokens cujo payload tenha
  `aud!==undefined` ou `role==="buyer"`, e exigir `merchant_id` não-vazio;
  o `BuyerJwtService` passa a usar `BUYER_JWT_SECRET` próprio (já em
  `PRODUCTION_REQUIRED_SECRETS`); o `AuthGuard` assevera
  `principal.tenantId` string não-vazia antes de qualquer query.
- **Contrato/migração:** sem migração de schema. Mudança de **contrato de
  segredo** (passa a exigir `BUYER_JWT_SECRET` no boot, ADR 0009). Tokens de
  buyer antigos param de funcionar em rotas de merchant — comportamento
  desejado.

### B2 — Rate limiter contornável via header `x-device-id` (P1, segurança)
- **Arquivos:** `presentation/auth.controller.ts:29-32`,
  `domain/services/login-rate-limiter.service.ts:53-55`.
- **Causa raiz:** a chave do bucket é `${ip}:${deviceId}`, e `deviceId` vem do
  header `x-device-id` controlado pelo cliente (default `"unknown-device"`).
  Rotacionar o header gera um bucket novo a cada request. `ip` ainda cai para
  `"unknown"` quando não resolvido.
- **Impacto:** a proteção de credential-stuffing/brute-force em `/auth/login`
  é efetivamente anulada variando um header.
- **Remediação:** chavear o limiter por identificador **confiável** (IP de
  cliente resolvido e/ou e-mail normalizado), tratando `x-device-id` apenas
  como telemetria.
- **Contrato/migração:** sem mudança de contrato público; ajuste interno de
  chave. Sem migração.

### B3 — Refresh aceita token expirado há 7 dias, sem revogação (P2, segurança)
- **Arquivos:** `domain/services/jwt.service.ts:56-71`,
  `presentation/auth.controller.ts:45-79`.
- **Causa raiz:** `verifyForRefresh` aceita tokens expirados há até 7 dias e
  `/auth/refresh` reemite um token fresco de 1h a partir dele. Não há
  denylist/versão de token no servidor, e `/auth/refresh` é não-autenticado e
  sem throttle. Cada refresh reseta a janela.
- **Impacto:** um único token capturado garante renovação de sessão
  praticamente indefinida; troca de senha não invalida sessões.
- **Remediação:** introduzir `token_version`/registro de refresh verificado no
  refresh; encurtar/justificar a janela de graça; rate-limit em
  `/auth/refresh`; incrementar versão em troca de senha/logout-all.
- **Contrato/migração:** **precisa de migração** (coluna `token_version` no
  usuário ou tabela de refresh tokens) e ajuste do contrato de refresh.
  Alinhar com ADR 0015 (refresh rotativo/revogável).

### B4 — Registro aceita `merchant_id` do cliente com checagem TOCTOU (P2, validação)
- **Arquivo:** `application/register-merchant.use-case.ts:30-41`.
- **Causa raiz:** `merchantId = input.merchant_id ?? gerado` — um endpoint
  público deixa o chamador escolher o id do tenant. A checagem
  `findUserByEmail` → `create` é TOCTOU: registros concorrentes do mesmo
  e-mail passam ambos e o segundo estoura unique-constraint em 500.
- **Impacto:** squatting/previsibilidade de `merchant_id` e 500 não-tratado em
  colisão de e-mail/id em vez de 409.
- **Remediação:** **sempre** gerar `merchant_id` no servidor (ignorar valor do
  cliente); confiar na constraint única do banco e mapear a violação para
  `ConflictException` (409).
- **Contrato/migração:** mudança de **contrato público** (campo
  `merchant_id` do body deixa de ser honrado). Sem migração de schema.

## Melhorias para produção

### Segurança
- Verificação de `aud`/`role` e `merchant_id` no `verify` do merchant (B1);
  segredos separados merchant/buyer; refresh revogável + `token_version` (B3);
  rate limit por identificador confiável (B2); `merchant_id` server-side (B4).
- Cookies `HttpOnly`, `SameSite`, `Secure` em produção; sem segredo default.

### Desacoplamento
- `TenantPrincipal` permanece a única fonte de `merchant_id` para o resto da
  API; nenhum contexto lê o `JWT_SECRET` diretamente além de `auth`/`buyer`.

### Persistência & Consistência
- Rate limit e refresh tokens em store compartilhado/persistido (ver ADR 0001
  de `buyer-account`, B5); registro de merchant atômico com mapeamento de
  unique-constraint → 409.

### Observabilidade
- Métricas de login (sucesso/falha/rate-limit), refresh e registro; log com
  `correlation_id` sem segredo/PII; alertar pico de `invalid_bearer_token`.

### Otimização & Escala
- Rate limit distribuído (Redis) para suportar escala horizontal sem multiplicar
  o limite por instância.

### Features faltantes
- Verificação de e-mail; reset de senha; logout-all; RBAC (`owner`/`admin`)
  com testes de abuso (ADR 0015).

## Alternativas consideradas
- **Manter um único segredo para buyer e merchant e só checar `aud`.**
  Rejeitado: defesa em profundidade exige segredos separados — um vazamento
  não deve cruzar audiências.
- **Continuar com rate limit por `x-device-id`.** Rejeitado: identificador
  controlado pelo cliente não oferece garantia.

## Consequências
**Positivas:** fronteira de tenant restaurada; abuso de login e refresh
contidos; registro íntegro.
**Negativas/riscos:** exige `BUYER_JWT_SECRET` no boot (falha segura);
migração para `token_version`; tokens de buyer antigos deixam de abrir rotas de
merchant (desejado).

**Barra de aceite:** E2E verde de (a) token de buyer **negado** em rota de
merchant, (b) rate limit que não cede a rotação de `x-device-id`, (c) refresh
revogado após troca de senha, (d) registro concorrente do mesmo e-mail → 409.
