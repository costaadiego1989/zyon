# ADR 0016 — Merchant, agent-rules e checkout-settings (config do tenant)

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Produto, Plataforma
- **Relacionado:** [ADR 0005](./0005-multi-tenant-isolation.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0015](./0015-auth-and-tenant-onboarding.md), [ADR 0024](./0024-dashboard-config-preview-onboarding.md), [ADR 0025](./0025-packages-engines-sdk-hardening.md). Baseline: `.specs/maturity/merchant.md`, `.specs/maturity/agent-rules.md`, `.specs/maturity/checkout-settings.md`.

## Contexto

Três módulos compõem a **superfície de configuração do tenant**, todos
**L2, alvo L3, prioridade P2**:

- `merchant` — regras e configuração do merchant;
- `agent-rules` — identidade, capacidades e guardrails do agente;
- `checkout-settings` — comportamento do widget, triggers e supressão.

São os contratos que o dashboard consome (ADR 0024) e que o onboarding
provisiona com defaults (ADR 0015). Invariantes do CLAUDE.md: desconto só
pelo `rules-engine`, frete só pelo `shipping-engine`, LLM não autoriza
oferta — portanto as **regras de negócio configuráveis não podem permitir
que o agente burle os engines**. `agent-rules` define guardrails;
`checkout-settings` define o modo (ex.: `silent_until_trigger`) e supressão.
Os três importavam Prisma do `checkout` (ADR 0004) — alvo do P0.2.

## Decisão

- Levar os três a L3 com config **persistida**, validada em runtime e
  versionada, sempre escopada por `merchant_id` do contexto (ADR 0009).
- `agent-rules` é a fonte de guardrails do agente; nenhuma config pode
  conceder desconto/frete fora dos engines (invariante).
- `checkout-settings` expõe um contrato estável consumido pelo widget e
  pelo live preview do dashboard (ADR 0024).
- Defaults de provisionamento de onboarding gerados por estes contratos
  (ADR 0015), não por escrita direta cross-context.

## Melhorias para produção

### Segurança
- Authz de merchant (RBAC) em todas as mutações; `merchant_id` nunca do
  body; validação de schema das configs; auditoria de quem alterou o quê.

### Desacoplamento
- Injetar `PersistenceModule` (remover Prisma local, P0.2); expor portas
  públicas; emitir eventos de mudança de config para o widget invalidar
  cache.

### Persistência & Consistência
- Config versionada com histórico; migração de schema de config segura;
  idempotência de mutações.

### Observabilidade
- Métricas de mudanças de config por tenant; log com `correlation_id` +
  `merchant_id`.

### Otimização & Escala
- Cache de config por tenant com invalidação por evento; leitura barata no
  caminho quente do widget.

### Features faltantes
- Defaults coesos de checkout para onboarding; validação de combinações de
  guardrails; preview-friendly read model (ADR 0024).

## Alternativas consideradas
- **Config só em memória/seed.** Rejeitado: viola DoD L3 e impede
  self-serve.
- **Permitir override de engine via config.** Rejeitado: viola invariantes
  do CLAUDE.md.

## Consequências
**Positivas:** superfície de config coesa e segura, base do dashboard e do
onboarding.
**Negativas/riscos:** schema de config precisa de versionamento cuidadoso
para não quebrar widget/preview.

**Barra de aceite:** DoD L3 + testes de validação de config, RBAC e
invariantes de guardrail.
