# ADR 0025 — Packages: engines, SDK e shared-types

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Plataforma, Segurança
- **Relacionado:** [ADR 0001](./0001-modular-monolith-bounded-contexts.md), [ADR 0002](./0002-acl-pattern-cross-context.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0011](./0011-payment-hardening.md), [ADR 0014](./0014-shipping-engine-hardening.md), [ADR 0019](./0019-negotiation-and-support.md), [ADR 0022](./0022-widget-transactional-path.md), [ADR 0023](./0023-widget-shell-identity-experience.md), [ADR 0024](./0024-dashboard-config-preview-onboarding.md).

## Contexto

Os pacotes em `packages/` são o núcleo puro e os contratos compartilhados:
`rules-engine`, `decision-engine`, `conversation-engine`,
`shipping-engine`, `negotiation-engine`, `commerce-adapters`,
`agentic-checkout-js` (SDK do widget) e `shared-types`. Regra do CLAUDE.md:
**pacotes não importam NestJS nem framework**; `shared-types` guarda
**apenas interfaces**. Esses pacotes concentram invariantes financeiras e
de segurança:

- `rules-engine` é o **único** que aprova desconto
  (`evaluateDiscountOffer` com hard-cap de `maxDiscountPercent`, rejeição
  abaixo de `minimumMarginPercent`, margem por `cost`/default 50%, fee 4%).
- `shipping-engine` é o **único** que aprova subsídio de frete.
- `conversation-engine` **classifica objeção e escreve copy**, nunca
  autoriza oferta; mensagens validadas por `isSafeGeneratedMessage`.
- `agentic-checkout-js` é o SDK consumido pelo widget e pelo live preview
  do dashboard (ADR 0023/0024).
- `commerce-adapters` hospeda o mapping puro dos vendors (ADR 0002).

## Decisão

- Endurecer os pacotes como base confiável e versionada: pureza
  (sem framework), determinismo das funções financeiras, contratos
  estáveis em `shared-types`, e SDK com versionamento semântico para o
  widget e o dashboard.

## Melhorias para produção

### Segurança
- Garantir, por teste, que só `rules-engine`/`shipping-engine` decidem
  desconto/subsídio e que `conversation-engine` nunca emite oferta;
  `isSafeGeneratedMessage` com fallback determinístico coberto.

### Desacoplamento
- Reforçar boundary lint: pacotes sem NestJS; `shared-types` só interfaces;
  mapping de vendor isolado em `commerce-adapters` (ADR 0002).

### Persistência & Consistência
- Pacotes permanecem puros/stateless; qualquer estado vive nos módulos da
  API. Funções financeiras determinísticas e idempotentes.

### Observabilidade
- Os pacotes expõem resultados/razões estruturados para a API logar;
  não logam diretamente.

### Otimização & Escala
- Bundle do SDK enxuto e tree-shakeable; sem dependências desnecessárias
  (CLAUDE.md).

### Features faltantes
- Versionamento semântico publicável do SDK; contratos de evento/DTO
  centralizados em `shared-types`; testes de propriedade para invariantes
  financeiras.

## Alternativas consideradas
- **Mover lógica de engine para a API.** Rejeitado: quebra reuso e a
  garantia de pureza/determinismo.
- **Permitir framework nos pacotes.** Rejeitado pelo CLAUDE.md.

## Consequências
**Positivas:** invariantes financeiras centralizadas, testáveis e
reutilizadas por API, widget e preview.
**Negativas/riscos:** mudanças de contrato em `shared-types`/SDK exigem
disciplina de versionamento para não quebrar widget/dashboard.

**Barra de aceite:** boundary lint verde; testes de invariantes
financeiras e de mensagem segura; SDK versionado consumido por widget e
dashboard.
