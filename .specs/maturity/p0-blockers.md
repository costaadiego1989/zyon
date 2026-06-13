# P0 — Cross-platform Blockers (ADR-0007)

P0 = baseline confiável e segurança financeira. Nenhum módulo chega a L3
e o piloto externo não inicia enquanto estes itens não fecharem.

Fonte: ADR-0007, seções "Bloqueios transversais da API" + "Ordem de fechamento P0".

> Este arquivo rastreia apenas status de governança. As correções de
> código vivem nos respectivos módulos/PRs.

## Blockers

- [ ] **P0.1 — Lint/boundaries bloqueante no CI**
  - Corrigir `TenantGuard` (hoje não valida tenant), tenant middleware
    (lista de modelos antiga/incompleta) e lint de arquitetura.
  - Tornar o lint de arquitetura um gate sem `continue-on-error`.
  - Separar violações reais de testes/module roots na config do lint.
  - **Owner:** TBD · **Deadline:** TBD

- [ ] **P0.2 — Centralizar todo Prisma em `PersistenceModule`**
  - Vários módulos instanciam `PrismaClient` fora de `PersistenceModule`,
    contornando middleware e lifecycle global.
  - Injetar o cliente global; remover instâncias paralelas.
  - **Owner:** TBD · **Deadline:** TBD

- [ ] **P0.3 — Tenant context, middleware e fuzz com banco real**
  - Corrigir contexto de tenant e middleware; validar com banco real.
  - Fuzz cross-tenant para garantir isolamento por `merchant_id`.
  - **Owner:** TBD · **Deadline:** TBD

- [ ] **P0.4 — Outbox durável, retries, DLQ e idempotência de handlers**
  - `MessagingModule` usa outbox em memória apesar da tabela
    `OutboxMessage` existir.
  - Persistir outbox; implementar retries, DLQ e idempotência de handlers.
  - **Owner:** TBD · **Deadline:** TBD

- [ ] **P0.5 — Remover fallbacks inseguros de secrets/providers em produção**
  - Eliminar segredo padrão e fallbacks fake de providers fora de dev.
  - Configuração por ambiente deve falhar de forma segura.
  - **Owner:** TBD · **Deadline:** TBD

- [ ] **P0.6 — Restringir CORS e validação global de requests**
  - CORS global usa `origin: true`; restringir a origins permitidas.
  - Adicionar validação global de request/response em runtime.
  - **Owner:** TBD · **Deadline:** TBD

- [ ] **P0.7 — Desabilitar rotas legadas abertas em produção**
  - Controllers legados de checkout/payment e controllers de
    cross-sell/coupons/shipping/scraping/fulfillment sem proteção
    necessária para exposição externa.
  - Desabilitar/proteger em produção.
  - **Owner:** TBD · **Deadline:** TBD

- [ ] **P0.8 — Desativar formulário de cartão com PAN/CVV**
  - `CardForm` ativo envia PAN/CVV ao backend.
  - Desativar até tokenização provider-side (ex.: Stripe Elements);
    confirmar apenas por webhook.
  - **Owner:** TBD · **Deadline:** TBD

## Gate de início do piloto (resumo)

O piloto externo só inicia quando P0 concluído, todo o caminho P1 em L3,
sem rota externa sem auth deliberada/documentada, sem estado crítico de
compra só em memória, migration/restart/retry aprovados em banco real,
CI bloqueando lint/typecheck/build/testes/Prisma, e E2E cobrindo happy
path, cross-tenant negado, token/origin inválidos, retry idempotente,
provider indisponível e webhook duplicado.

## Links
- ADR: [0007](../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md)
- Index: [MATURITY-INDEX.md](./MATURITY-INDEX.md)
