# ADR 0001 (buyer-account) — Buyer: login por telefone/OTP, JWT de buyer e histórico

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Identidade do Buyer), Segurança, Privacidade
- **Relacionado (ADRs centrais):** [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0018](../../../../../../docs/architecture/adr/0018-buyer-identity-and-history.md), [ADR 0015](../../../../../../docs/architecture/adr/0015-auth-and-tenant-onboarding.md). Este ADR vive ao lado do código (decisão do time).

## Contexto

`buyer-account` é a conta do **buyer** platform-wide (`global_user_id`): login
por e-mail/senha, login a partir de sessão de checkout, **login por telefone
(OTP)**, perfil, agentes M2M e a leitura de `me/purchases`.

### Responsabilidades
- `RegisterBuyerUseCase` / `LoginBuyerUseCase` / `LoginBuyerFromSessionUseCase`.
- `SendBuyerPhoneCodeUseCase` + `VerifyBuyerPhoneCodeUseCase` — fluxo OTP
  público e não-autenticado (`/buyer/phone/send`, `/buyer/phone/verify`).
- `GetBuyerPurchasesUseCase` — agrega histórico do buyer (Prisma ou repo).
- `BuyerJwtService` — JWT de buyer (`aud:"buyer"`, `role:"buyer"`).
- `BuyerJwtAuthGuard` / `currentBuyer` — popula `request.user` com o principal.

### Portas / contratos
- `BUYER_ACCOUNT_REPOSITORY` (`findByPhone`, `save`, ...).
- `BUYER_PURCHASE_HISTORY_REPOSITORY`, `ORDER_REPOSITORY`,
  `INTEGRATIONS_REPOSITORY` (opcionais) para enriquecer compras.

### Invariantes que o módulo deve sustentar
- `global_user_id` é global, mas o **histórico é sempre filtrado por
  merchant** (CLAUDE.md, ADR 0018).
- Segredo do JWT de buyer separado do de merchant (`BUYER_JWT_SECRET`).
- Sem estado global oculto; Prisma é a única persistência de runtime
  (CLAUDE.md).
- Segredos de autenticação (OTP) nunca em log; PII minimizada.

## Decisão

Endurecer o fluxo de identidade do buyer com foco no caminho público de OTP
(throttling, persistência, CSPRNG, não-log do segredo), no isolamento de
audiência do JWT de buyer e na política explícita de histórico cross-merchant.

## Bugs encontrados e remediação decidida

### B1 — JWT de buyer compartilha segredo com merchant (P0, segurança)
- **Arquivo:** `domain/services/buyer-jwt.service.ts:20`.
- **Causa raiz:** `BuyerJwtService` usa `requireSecret("JWT_SECRET", ...)` — o
  **mesmo** segredo do `JwtService` de merchant — apesar de
  `secret-config.ts` já declarar `BUYER_JWT_SECRET` como segredo obrigatório de
  produção. Como o `verify` do merchant não checa `aud`, um token de buyer abre
  rotas de merchant (detalhe completo em ADR 0001 de `auth`, B1).
- **Impacto:** quebra de fronteira de tenant; ver ADR 0001 de `auth`.
- **Remediação:** `BuyerJwtService` passa a usar `BUYER_JWT_SECRET` próprio.
  (`BuyerJwtService.verify` já valida `aud==="buyer"` e `role==="buyer"`, o que
  protege o lado buyer; a falha simétrica está no `verify` de merchant.)
- **Contrato/migração:** mudança de **contrato de segredo** — `BUYER_JWT_SECRET`
  obrigatório no boot em produção (ADR 0009). Sem migração de schema.

### B2 — OTP de telefone sem throttling — código de 6 dígitos brute-forçável (P0, segurança)
- **Arquivo:** `application/use-cases/verify-buyer-phone-code.use-case.ts:20-45`.
- **Causa raiz:** o `verify` só apaga o OTP em caso de sucesso; no mismatch
  lança erro mas não mantém contador de falhas nem lockout. O espaço é 10^6 e o
  código vive 5 minutos. O login de merchant tem `LoginRateLimiter`; o caminho
  de telefone não tem nenhum. As rotas `/buyer/phone/send` e `/buyer/phone/verify`
  são públicas e não-autenticadas.
- **Impacto:** quem conhece um número pode brute-forçar o OTP e obter um JWT de
  buyer (account takeover / criação de conta sob o telefone da vítima).
- **Remediação:** contar tentativas por telefone com lockout (ex.: 5 erros
  invalidam o código), apoiado em store persistente/compartilhado; rate limit
  por IP+telefone em `/buyer/phone/send` e `/buyer/phone/verify`; considerar
  códigos de 8+ dígitos.
- **Contrato/migração:** **precisa de migração** (tabela de OTP/tentativas com
  TTL) — ver B3. Sem mudança de contrato HTTP público.

### B3 — OTP e rate limiter em `Map` de processo (P1, infraestrutura)
- **Arquivos:** `application/use-cases/send-buyer-phone-code.use-case.ts:9`
  (`otpStore = new Map`), `../../auth/domain/services/login-rate-limiter.service.ts:14`.
- **Causa raiz:** códigos OTP e buckets de tentativa vivem em memória de
  módulo/instância. O CLAUDE.md proíbe estado global oculto e manda usar Prisma
  como única persistência de runtime.
- **Impacto:** sob escala horizontal, um OTP emitido no nó A não é verificável
  no nó B (login por telefone quebrado), e contadores de rate-limit são por
  instância (limite global multiplicado pelo nº de instâncias). Estado some a
  cada restart/deploy.
- **Remediação:** persistir OTP e contadores num store compartilhado (tabela
  Prisma ou Redis) com TTL; injetar via porta em vez de `Map` de módulo.
- **Contrato/migração:** **precisa de migração** (tabela de OTP/tentativas com
  TTL e índice por telefone). Sem mudança de contrato HTTP.

### B4 — OTP gerado com `Math.random` (P2, segurança)
- **Arquivo:** `application/use-cases/send-buyer-phone-code.use-case.ts:23`.
- **Causa raiz:** `Math.floor(100000 + Math.random()*900000)` usa PRNG
  não-criptográfico para gerar um segredo de autenticação.
- **Impacto:** valores de OTP estatisticamente previsíveis, baixando o custo de
  adivinhação.
- **Remediação:** usar `crypto.randomInt(100000, 1000000)` (ou faixa maior).
- **Contrato/migração:** nenhuma.

### B5 — OTP escrito em log em texto puro (P2, segurança)
- **Arquivo:** `application/use-cases/send-buyer-phone-code.use-case.ts:29`.
- **Causa raiz:** `console.log("[OTP] phone=... code=...")` imprime o segredo
  vivo e PII (telefone) no stdout/sink de log.
- **Impacto:** qualquer um com acesso a log (agregadores, CI, ops) lê OTPs
  ativos e os correlaciona a telefones — contorna o OTP e vaza PII.
- **Remediação:** remover o código dos logs; atrás de flag dev-only, logar
  apenas um marcador redigido; entrega real via provedor SMS/WhatsApp.
- **Contrato/migração:** nenhuma.

### B6 — Conta só-telefone guarda UUID cru em `passwordHash` e e-mail sintético (P3, dados)
- **Arquivo:** `application/use-cases/verify-buyer-phone-code.use-case.ts:31-42`.
- **Causa raiz:** contas auto-criadas por telefone setam `passwordHash` para
  `crypto.randomUUID()` (não um hash scrypt) e `email` para
  `phone_<num>@buyer.aacp`. `PasswordHasher.verify` faz split em `:` e retorna
  false, então não é explorável por login, mas é um hash malformado e um e-mail
  fake ocupando o espaço de e-mails únicos.
- **Impacto:** se a mesma pessoa registrar depois com e-mail real, surge conta
  duplicada/órfã; o hash-lixo confunde e o e-mail sintético polui o índice
  único de e-mail.
- **Remediação:** marcar contas de telefone como passwordless explícito
  (`passwordHash` nullable + flag `auth_method`) e reconciliar/mesclar quando um
  e-mail real for verificado.
- **Contrato/migração:** **precisa de migração** (`passwordHash` nullable +
  coluna `auth_method`; e-mail opcional para contas de telefone).

### B7 — `me/purchases` agrega entre todos os merchants quando `merchant_id` é omitido (P2, contrato)
- **Arquivo:** `application/use-cases/get-buyer-purchases.use-case.ts:14,76,184`.
- **Causa raiz:** `merchantId` é opcional; quando ausente, a query Prisma omite
  o filtro `merchantId` e `listPurchasesAcrossMerchants` retorna registros de
  todos os merchants daquele `globalUserId`. É buyer-scoped (dados próprios),
  mas contradiz diretamente a invariante do CLAUDE.md "histórico é sempre
  filtrado por merchant".
- **Impacto:** ou é uma visão cross-merchant intencional do próprio buyer que
  viola uma invariante declarada, ou um alargamento de escopo não-intencional.
  Afeta também a semântica de metering.
- **Remediação (decisão):** carved-out explícito — a **visão do próprio buyer**
  (`/buyer/me/purchases` autenticado por `BuyerJwtAuthGuard`) PODE ser
  cross-merchant porque é estritamente dados do próprio `global_user_id`; a
  invariante "filtrado por merchant" passa a valer para acessos
  **merchant-scoped** (ex.: `buyer-purchase-history` via `AuthGuard` de
  merchant). Atualizar a redação da invariante no ADR 0018 e fixar o
  comportamento com teste. Rotas merchant-scoped continuam obrigadas a filtrar.
- **Contrato/migração:** mudança de **contrato/documentação de invariante**
  (ADR 0018); sem migração de schema. Requer teste pinando a política.

### B8 — Cursor de paginação e params de data/limit não-validados → 500 (P3, validação)
- **Arquivos:** `application/use-cases/get-buyer-purchases.use-case.ts:262-269`,
  `presentation/http/buyer-account.controller.ts:122-136`.
- **Causa raiz:** `decodeCursor` faz `new Date(slice)` sem validação; cursor
  malformado vira `Invalid Date` passado a comparações Prisma. `date_from`/
  `date_to` (`new Date`) e `limit` (`Number`) também são não-validados no
  controller.
- **Impacto:** params forjados produzem erros Prisma/`Invalid Date` (500) em
  vez de 400, e um `limit` `NaN` pode degradar a query. Gap de robustez num
  endpoint autenticado público-ish.
- **Remediação:** validar estrutura do cursor e rejeitar datas/limites `NaN`
  com `BadRequest`; fazer clamp do limit; tratar `Invalid Date` como 400.
- **Contrato/migração:** nenhuma.

### B9 — Lookups N+1 de shipment/order/tracking no caminho de repositório (P3, performance)
- **Arquivo:** `application/use-cases/get-buyer-purchases.use-case.ts:192,209-215`.
- **Causa raiz:** `executeRepository` mapeia cada compra por `toRepositoryRecord`,
  que dispara `getShipmentByExternalOrderId` +
  `findCompletedOrderByExternalOrderId` + `listTrackingEvents` por registro
  (3 queries × N). O caminho Prisma faz batch; o de repositório não.
- **Impacto:** fan-out de query por página escala com o nº de resultados.
  Baixo impacto em produção (este branch é o caminho in-memory/test-double,
  `usesPrismaPurchaseHistory` false), mas é regressão latente se for usado em
  runtime.
- **Remediação:** fazer batch dos lookups por merchant+orderId como o caminho
  Prisma, ou manter este branch só para teste.
- **Contrato/migração:** nenhuma.

## Melhorias para produção

### Segurança
- Throttling+lockout de OTP (B2); CSPRNG no código (B4); OTP fora de log (B5);
  segredo de buyer separado (B1); validação de cursor/datas (B8).

### Desacoplamento
- OTP/tentativas atrás de porta de store, não `Map` de módulo (B3);
  enriquecimento de compras por porta (`ORDER_REPOSITORY`/`INTEGRATIONS`).

### Persistência & Consistência
- OTP, tentativas e contas de telefone persistidos em Prisma com TTL/flags;
  reconciliação de conta telefone↔e-mail (B6).

### Observabilidade
- Métricas de envio/verificação de OTP, lockouts e leituras de histórico; log
  com `correlation_id` sem PII/segredo (B5).

### Otimização & Escala
- Batch nos lookups de tracking (B9); índices por `(merchant_id, global_user_id)`
  e por `completedAt,id` para o cursor; store de OTP compartilhado (B3).

### Features faltantes
- Política de retenção/exclusão de PII; consentimento; export de dados do buyer
  (ADR 0018); merge de contas telefone↔e-mail.

## Alternativas consideradas
- **Exigir `merchant_id` em `me/purchases`.** Rejeitado: o produto pede uma
  visão consolidada do próprio buyer; preferimos carve-out documentado (B7) a
  remover a feature.
- **Manter OTP em memória.** Rejeitado: viola "sem estado global oculto" e quebra
  sob escala horizontal (B3).

## Consequências
**Positivas:** login por telefone resistente a brute-force e escalável;
audiências de token isoladas; histórico com política explícita.
**Negativas/riscos:** novas migrações (OTP, `auth_method`, `token_version` no
lado auth); carve-out de B7 exige atualizar a invariante do ADR 0018 e cobrir
com teste.

**Barra de aceite:** E2E verde de (a) OTP bloqueado após N tentativas,
(b) OTP nunca aparece em log, (c) token de buyer negado em rota de merchant,
(d) `me/purchases` cross-merchant pin-testado e rota merchant-scoped filtrada,
(e) cursor/datas malformados → 400.
