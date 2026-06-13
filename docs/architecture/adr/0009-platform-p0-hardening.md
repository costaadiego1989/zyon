# ADR 0009 — Plataforma P0: tenant, persistência, outbox, CORS, secrets e rotas legadas

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Plataforma, Segurança, Engenharia
- **Relacionado:** [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0004](./0004-prisma-isolation-per-context.md), [ADR 0005](./0005-multi-tenant-isolation.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md). Baseline: `.specs/maturity/p0-blockers.md`.

## Contexto

São os **bloqueios transversais P0** do ADR 0007. Enquanto abertos,
nenhum módulo atinge `L3` e o piloto não inicia. Estado atual verificado:

- **Tenant (P0.1/P0.3):** `TenantGuard` não valida tenant; o middleware
  Prisma de tenant filter tem lista de modelos antiga/incompleta (ADR 0005,
  seção Contexto). Hoje só o `EmbedAuthGuard` protege parcialmente o
  caminho. Não há fuzz cross-tenant rodando em banco real como gate.
- **Persistência (P0.2):** 7 contextos importam `createPrismaClient` do
  `checkout` (ADR 0004, seção Contexto), criando o `checkout` como
  container de infra e abrindo risco de múltiplos pools.
- **Outbox (P0.4):** `MessagingModule` usa
  `apps/api/src/shared/messaging/infrastructure/in-memory-outbox.repository.ts`
  apesar de `OutboxMessage` existir no schema. Sem DLQ/retry/idempotência
  durável.
- **Secrets (P0.5):** segredo padrão de JWT e fallbacks fake de providers
  fora de dev (ex.: `JWT_SECRET = "athom-tech-jwt-secret"` em specs;
  fallbacks determinísticos do CLAUDE.md).
- **CORS/validação (P0.6):** `apps/api/src/main.ts:16` usa `origin: true`;
  falta validação global de request em runtime.
- **Rotas legadas (P0.7):** controllers legados de checkout/payment e
  controllers de cross-sell/coupons/shipping/scraping/fulfillment sem a
  proteção necessária para exposição externa.
- **Lint de boundaries (P0.1):** não é gate bloqueante e mistura violações
  reais com testes/module roots.

## Decisão

Fechar os oito bloqueios P0 como pré-condição única de L3, conforme
`.specs/maturity/p0-blockers.md`. Arquitetura alvo:

1. **PersistenceModule global** (ADR 0004): `PrismaService extends
   PrismaClient` com `onModuleInit/$connect`, `onModuleDestroy/$disconnect`,
   middleware de tenant e de observabilidade. Todos os repositórios injetam
   `PrismaService`. Apagar `modules/checkout/infrastructure/prisma/prisma-client.ts`.
2. **TenantContext** via `AsyncLocalStorage` + `TenantContextMiddleware`
   global que resolve `merchantId` do JWT (operator) ou embed token (buyer)
   e gera `correlationId` (ADR 0005, 5.1–5.2). Rotas públicas marcadas com
   `@PublicRoute()`.
3. **TenantGuard real:** valida que o `merchantId` do contexto bate com o
   da credencial; rejeita 403 se body/path trouxer `merchantId` divergente.
4. **Middleware Prisma de tenant filter** com lista de modelos completa e
   opt-in por modelo; RLS Postgres atrás de feature flag como última
   camada (ADR 0005, 5.4–5.5).
5. **Outbox durável** (ADR 0003): persistir `OutboxMessage`, dispatcher
   in-process com lock, retries com backoff, DLQ e idempotência por
   `event_id` nos handlers.
6. **Config segura:** carregamento de env que **falha de forma segura** em
   produção; sem segredo padrão e sem fallback fake de provider fora de dev.
7. **CORS restrito** a origins permitidas por ambiente + `ValidationPipe`
   global (`whitelist`, `forbidNonWhitelisted`, `transform`).
8. **Rotas legadas** desabilitadas ou protegidas em produção via flag.

## Melhorias para produção

### Segurança
- CORS allowlist por ambiente; `ValidationPipe` global; remoção de secrets
  default; rotas legadas off em prod; fuzz cross-tenant
  (`apps/api/test/cross-tenant-fuzz.e2e-spec.ts`, ADR 0005 5.6) como gate.

### Desacoplamento
- Prisma único no `PersistenceModule`; lint de boundaries bloqueante sem
  `continue-on-error`, separando violações reais de testes/module roots.

### Persistência & Consistência
- Outbox persistido + DLQ + retry; idempotência de handlers por `event_id`;
  writes de agregado + outbox atômicos na mesma transação.

### Observabilidade
- Middleware de log/observability no `PrismaService`; todo log com
  `correlation_id` + `merchant_id`; métricas de backlog/idade da outbox e
  taxa de DLQ.

### Otimização & Escala
- Pool único de conexões; dispatcher com cadência ~100 ms e lock para
  evitar processamento duplicado; rate limit base nas rotas públicas/embed.

### Features faltantes
- Painel/observador de DLQ e replay (runbook); flag de RLS por tenant
  enterprise.

## Alternativas consideradas
- **RLS como única defesa.** Rejeitado: nem todo ambiente suporta; mantemos
  RLS como camada final atrás de flag, não como substituto do guard.
- **Manter outbox em memória até o piloto.** Rejeitado: viola a DoD L3
  (estado crítico em memória) e perde fatos no restart.

## Consequências
**Positivas:** baseline confiável; isolamento de tenant verificável;
split futuro de contextos viável.
**Negativas/riscos:** refactor amplo (7 imports, middlewares, dispatcher);
maior latência percebida em "pagamento aprovado → pedido completo"
(mitigada por dispatcher de 100 ms, ADR 0003).

**Barra de aceite:** DoD L3 do ADR 0007, itens 1–8, com fuzz cross-tenant
e teste de restart em banco real verdes no CI.
