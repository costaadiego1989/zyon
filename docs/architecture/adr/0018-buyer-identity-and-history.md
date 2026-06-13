# ADR 0018 — Buyer-account e buyer-purchase-history

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Segurança, Privacidade
- **Relacionado:** [ADR 0005](./0005-multi-tenant-isolation.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0023](./0023-widget-shell-identity-experience.md). Baseline: `.specs/maturity/buyer-account.md`, `.specs/maturity/buyer-purchase-history.md`.

## Contexto

Dois módulos de identidade/personalização do buyer:

- `buyer-account` — conta do buyer (login por sessão, perfil). Classificado
  **L2 (blocked), alvo L3, prioridade P2**. Tem
  `login-buyer-from-session.use-case.ts`, `update-buyer-profile.use-case.ts`,
  repositório Prisma e e2e.
- `buyer-purchase-history` — histórico de compras por merchant para
  personalização. Classificado **L2, alvo L3, prioridade P2**.

Invariantes do CLAUDE.md: `global_user_id` identifica o buyer
platform-wide, mas o **histórico é sempre filtrado por merchant**. Isso
cruza fronteira de tenant + privacidade: dados do buyer são globais, mas a
visão por tenant deve ser estritamente isolada. `buyer-account` está
`blocked` pelos P0 (tenant/persistência).

## Decisão

- Levar ambos a L3 com isolamento estrito: `global_user_id` global, leitura
  de histórico **sempre** filtrada por `merchant_id` do contexto; sessão de
  buyer persistida e segura.
- Perfil e histórico tratados como PII: minimização, sem PII desnecessária
  em logs, e suporte a exclusão/portabilidade quando exigido.

## Melhorias para produção

### Segurança
- Sessão de buyer com expiração; `merchant_id` do contexto; testes
  cross-tenant garantindo que um merchant não lê histórico de buyer em
  outro merchant; PII fora de logs.

### Desacoplamento
- `PersistenceModule` (P0.2); histórico consumido por porta; eventos de
  upsert de cliente (`customer.upserted`) para integrations.

### Persistência & Consistência
- Sessão e histórico persistidos; idempotência de upsert de perfil;
  consistência entre `global_user_id` e visão por merchant.

### Observabilidade
- Métricas de login de buyer, upserts, leituras de histórico; log com
  `correlation_id` sem PII sensível.

### Otimização & Escala
- Paginação do histórico; índices por `(merchant_id, global_user_id)`.

### Features faltantes
- Política de retenção/exclusão de PII; consentimento; export de dados do
  buyer.

## Alternativas consideradas
- **Histórico global sem filtro por merchant.** Rejeitado: viola invariante
  e vaza comportamento entre lojas.
- **Sessão de buyer só em memória.** Rejeitado: viola DoD L3.

## Consequências
**Positivas:** personalização segura e isolada por tenant.
**Negativas/riscos:** requisitos de privacidade (LGPD) ampliam escopo;
tratar como feature explícita.

**Barra de aceite:** DoD L3 + cross-tenant negado e isolamento de histórico
testados.
