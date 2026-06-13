# ADR 0015 — Auth e onboarding self-serve do tenant

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Auth), Produto, Segurança
- **Relacionado:** [ADR 0005](./0005-multi-tenant-isolation.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0012](./0012-embed-security-hardening.md), [ADR 0016](./0016-merchant-config-surface-hardening.md), [ADR 0024](./0024-dashboard-config-preview-onboarding.md). Baseline: `.specs/maturity/auth.md`.

## Contexto

`auth` cobre registro de merchant, login JWT e cookie de auth. Classificado
**L2, alvo L3, prioridade P2**. O que falta para L3 (planilha):
remover segredo padrão fora de dev; refresh rotativo/revogável; rate limit
compartilhado; RBAC e abuso em E2E.

Estado verificado do código:

- `RegisterMerchantUseCase`
  (`apps/api/src/modules/auth/application/register-merchant.use-case.ts`)
  cria merchant + owner e devolve `access_token`; gera `merchant_id` como
  `mrc_${randomUUID}` quando não informado.
- Há `JwtService`, `PasswordHasher`, `LoginRateLimiter`, `AuthCookieService`
  e repositórios in-memory/Prisma.
- O teste `tenant-onboarding.spec.ts` cobre o fluxo
  **register → login → issue embed session**, mas usa segredos de exemplo
  (`JWT_SECRET`, `EMBED_SECRET` hardcoded de teste).
- No dashboard, o onboarding é um toggle login/signup numa única tela
  (`apps/dashboard/src/main.tsx`, `AuthMode = "login" | "signup"`), sem
  fluxo guiado de provisionamento (configurar checkout → gerar embed →
  publicar) nem onboarding de produto.

Conclusão: o **backend de registro existe (parcial)**, mas o
**onboarding self-serve como fluxo de provisionamento de tenant não
existe** — é a lacuna que o produto pediu.

## Decisão

- **Auth L3:** segredo de JWT só de ambiente (sem default, P0.5); refresh
  token rotativo e revogável; rate limit de login compartilhado/persistido;
  RBAC (`owner`/`admin`) com testes de abuso e cross-tenant em E2E.
- **Onboarding self-serve** como caso de uso de aplicação orquestrando, de
  forma idempotente, os passos de provisionamento do tenant:
  1. registrar merchant + owner (reusar `RegisterMerchantUseCase`);
  2. provisionar defaults (checkout-settings, agent-rules, tema) — ADR 0016;
  3. emitir credenciais de embed e instruções de instalação — ADR 0012;
  4. estado de onboarding persistido (passos concluídos) para retomada.
- A UX do fluxo guiado e o live preview ficam no ADR 0024; este ADR define
  o **contrato e a orquestração de backend**.

## Melhorias para produção

### Segurança
- Sem segredo default; refresh rotativo/revogável; rate limit
  persistido/compartilhado; RBAC explícito; cookies seguros (HttpOnly,
  SameSite, Secure em prod); E2E de abuso, replay e cross-tenant.

### Desacoplamento
- Onboarding orquestra outros contextos **só por porta/evento** (emite
  `merchant.provisioned`/`merchant.onboarding.completed` via outbox);
  não acessa tabelas de outro contexto diretamente.

### Persistência & Consistência
- Estado de onboarding persistido e idempotente (reentrância sem duplicar
  merchant/credenciais); registro de merchant atômico.

### Observabilidade
- Funnel de onboarding (registrado → configurado → embed gerado →
  publicado); métricas de login, falhas, rate-limit; log sem segredo/PII
  sensível.

### Otimização & Escala
- Rate limit distribuído; verificação de e-mail assíncrona quando aplicável.

### Features faltantes
- **Onboarding self-serve completo** (provisionamento guiado + retomada);
  verificação de e-mail; convite de membros do tenant; reset de senha.

## Alternativas consideradas
- **Provisionamento manual por operador.** Rejeitado: não escala para
  self-serve, que é o objetivo de go-to-market.
- **Onboarding como script único não idempotente.** Rejeitado: falha
  parcial deixaria tenant em estado inconsistente.

## Consequências
**Positivas:** entrada de tenant self-serve, segura e retomável.
**Negativas/riscos:** novo contrato público de onboarding; depende de
defaults de config (ADR 0016) e de credenciais de embed (ADR 0012).

**Barra de aceite:** DoD L3 + E2E de onboarding idempotente, refresh
rotativo, RBAC e abuso.
