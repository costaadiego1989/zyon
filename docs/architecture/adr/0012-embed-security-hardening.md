# ADR 0012 — Embed: sessão, token e segurança de origem

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Embed), Segurança, Plataforma
- **Relacionado:** [ADR 0005](./0005-multi-tenant-isolation.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0023](./0023-widget-shell-identity-experience.md). Baseline: `.specs/maturity/embed.md`.

## Contexto

`embed` emite tokens de sessão para o widget na loja (`EmbedTokenService`,
`IssueEmbedSessionUseCase`). É a porta de entrada do buyer no widget e o
ponto onde o `merchant_id` é resolvido para todo o caminho público (ADR
0005, 5.2). Classificado **L2 (blocked), alvo L3, prioridade P1**. O
`EmbedAuthGuard` é hoje a única proteção parcial de tenant (ADR 0005,
Contexto). `/embed/start` é rota pública (`@PublicRoute()`).

Estado verificado: o teste de onboarding usa
`EMBED_SECRET = Buffer.from("athom-tech-embed-secret-32bytes!!")` — segredo
de exemplo que não pode existir em produção (P0.5).

## Decisão

- Token de embed assinado, com `merchant_id`, expiração curta e binding de
  origem; renovação controlada. Segredo só de ambiente, falha segura sem
  ele (ADR 0009).
- `/embed/start` valida origin/referer contra a allowlist do merchant
  (alinhado ao CORS restrito, ADR 0009/P0.6).
- O token é a fonte do `merchant_id` no `TenantContext`; nenhum endpoint
  embed confia em `merchant_id` do body.

## Melhorias para produção

### Segurança
- Segredo de embed por ambiente, sem default. Expiração + rotação;
  validação de origin; escopo mínimo no token. Testes de token
  expirado/inválido e origin inválida.

### Desacoplamento
- Embed expõe porta de emissão/validação; outros contextos não leem o
  segredo diretamente.

### Persistência & Consistência
- Se houver estado de sessão de embed crítico, persistir; replay seguro.

### Observabilidade
- Métricas de sessões emitidas/recusadas por motivo (origin, expiração,
  assinatura); log com `correlation_id` + `merchant_id`.

### Otimização & Escala
- Rate limit em `/embed/start` por origin/merchant.

### Features faltantes
- Allowlist de origins configurável por tenant no dashboard (ADR 0024);
  rotação de segredo documentada em runbook.

## Alternativas consideradas
- **Token de embed sem binding de origin.** Rejeitado: permite replay do
  token em outra loja.
- **Sessão de embed sem expiração.** Rejeitado: aumenta janela de abuso.

## Consequências
**Positivas:** entrada pública controlada e isolada por tenant.
**Negativas/riscos:** binding de origin exige configuração correta de
domínios pelo tenant (cobrir no onboarding, ADR 0024).

**Barra de aceite:** DoD L3 + E2E de token/origin inválidos e expiração.
