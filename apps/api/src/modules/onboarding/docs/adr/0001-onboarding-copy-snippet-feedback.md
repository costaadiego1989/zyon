# ADR 0001 (onboarding) — Feedback de cópia de snippet no wizard de onboarding

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Onboarding), Produto, Design
- **Relacionado:** [ADR 0015 — Auth e onboarding](../../../../../../../docs/architecture/adr/0015-auth-and-tenant-onboarding.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0012 — Embed security hardening](../../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md). Origem: diagnóstico read-only do `apps/dashboard` (onboarding-wizard.tsx, embed-page.tsx).

## Contexto

O módulo `onboarding` conduz o tenant pelo setup inicial e entrega o snippet de
embed para colar na loja. O wizard (`onboarding-wizard.tsx`) e a `EmbedPage`
oferecem botões de "copiar" o snippet. O wizard já usa o padrão correto de guarda
de in-flight (`let active`), referência adotada por outros módulos.

Portas/fluxos chave consumidos pelo dashboard:
- **snippet de embed** — código que o merchant copia e cola na loja.
- **botões de cópia** — `navigator.clipboard?.writeText(snippet)`.

Invariantes que o módulo deve sustentar:
- toda ação visível ao usuário (copiar) precisa de feedback de sucesso/falha.
- comportamento consistente entre wizard e `EmbedPage` (mesmo helper de cópia).

## Decisão

Padronizar a cópia de snippet com feedback explícito, reutilizando o helper
`copyText()` da `integrations-page` que captura e reporta falha com fallback:

- substituir `navigator.clipboard?.writeText(...)` sem `await`/`catch` pelo helper
  compartilhado que trata contexto não-seguro / API indefinida e mostra mensagem.

## Melhorias para produção

### Segurança
- Cópia não expõe segredos; snippet de embed é público por natureza.

### Desacoplamento
- Helper `copyText()` único e reutilizado entre wizard, EmbedPage e Integrations.

### Persistência & Consistência
- N/A (ação de cliente sem persistência).

### Observabilidade
- Reportar falha de cópia (fallback de seleção/aviso) em vez de no-op silencioso.

### Otimização & Escala
- N/A.

### Features faltantes
- Estado visual "copiado!" consistente entre páginas.

## Bugs diagnosticados e remediação decidida

### BUG-ONB-1 (P3, funcional) — Cópia de snippet via `navigator.clipboard?.writeText` sem feedback de falha
- **Arquivo:** `apps/dashboard/src/pages/embed-page.tsx:82-83` (mesmo padrão em `onboarding-wizard.tsx:168`)
- **Causa raiz:** os botões de cópia chamam `navigator.clipboard?.writeText(snippet)`
  com optional chaining e sem `await`/`catch`. Em contextos não-seguros ou quando
  a API é `undefined`, o clique silenciosamente não faz nada — diferente de
  `integrations-page` `copyText()`, que reporta falha.
- **Impacto:** o botão de copiar parece funcionar mas falha silenciosamente em
  alguns contextos de browser; o usuário cola nada.
- **Remediação decidida:** reutilizar o helper `copyText()` da `integrations-page`,
  que captura e expõe uma mensagem de fallback.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

## Alternativas consideradas
- **Manter optional chaining sem feedback.** Rejeitado: falha silenciosa em
  contextos não-seguros (sem HTTPS), confundindo o operador.

## Consequências
**Positivas:** cópia confiável com feedback consistente em todas as páginas.
**Negativas/riscos:** mínimos; apenas centralizar o helper.

**Barra de aceite:** falha de cópia mostra mensagem/fallback; comportamento
idêntico entre wizard, EmbedPage e Integrations.
