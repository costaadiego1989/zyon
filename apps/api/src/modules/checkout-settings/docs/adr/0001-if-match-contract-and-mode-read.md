# ADR 0001 (checkout-settings) — Contrato If-Match e leitura do modo de checkout

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Checkout-settings), Plataforma, Produto
- **Relacionado:** [ADR 0016 — Merchant/agent-rules/checkout-settings](../../../../../../../docs/architecture/adr/0016-merchant-config-surface-hardening.md), [ADR 0005 — Multi-tenant isolation](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0028 — Merchant console integration API v1](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Origem: diagnóstico read-only do `apps/dashboard` cruzado com `CheckoutSettingsController` e `EntityTagService`.

## Contexto

`checkout-settings` expõe o modo do widget (silent/proactive/manual) e demais
preferências de checkout do tenant. O controller usa **concorrência otimista**:
`@Put()` chama `entityTags.assertIfMatch(ifMatch, current)`, que lança
`PreconditionRequiredException` (HTTP **428**) sempre que o header `If-Match`
estiver ausente ou em branco.

Portas/fluxos chave:
- **GET /checkout-settings** → retorna o estado atual (e o ETag para concorrência).
- **PUT /checkout-settings** → exige `If-Match`; valida via `EntityTagService`
  antes de aplicar a atualização.
- Página "Configurações de checkout" do console (botão "Guardar modo").

Invariantes que o módulo deve sustentar:
- `merchant_id`/escopo sempre do contexto de tenant, nunca do body (ADR 0005/0009).
- Toda escrita passa pela checagem de `If-Match` (ninguém grava sem precondição).
- O estado lido não pode ser sobrescrito por resposta obsoleta (sem corrida).

## Decisão

Tratar `If-Match` como parte **obrigatória do contrato** de escrita do
`checkout-settings` e exigir que todo cliente o envie:

- o cliente envia `If-Match` no `patchCheckoutSettings`, espelhando
  `updateWebhookEndpoint` (`headers:{'If-Match':'*'}`), ou — melhor — propaga o
  ETag capturado do GET anterior para concorrência otimista real;
- adicionar teste de regressão que afirma a presença do header;
- a leitura inicial usa guarda de in-flight para evitar que uma resposta antiga
  sobrescreva o estado mais novo.

## Melhorias para produção

### Segurança
- `merchant_id` sempre do contexto de tenant. Não aceitar escrita sem precondição.

### Desacoplamento
- Concorrência otimista isolada no `EntityTagService`; cliente apenas propaga ETag.

### Persistência & Consistência
- ETag propagado do GET para o PUT garante detecção de escrita concorrente
  (lost-update) em vez do bypass `'*'`.

### Observabilidade
- Métrica/log de `428` por rota para detectar clientes que não enviam `If-Match`.

### Otimização & Escala
- Cache do ETag por sessão de edição evita GET redundante antes do save.

### Features faltantes
- UX de conflito de concorrência (precondição falhou → recarregar e reaplicar).

## Bugs diagnosticados e remediação decidida

### BUG-CHKSET-1 (P0, contrato) — `patchCheckoutSettings` omite o header obrigatório `If-Match` → todo save retorna 428
- **Arquivo:** `apps/dashboard/src/api-client.ts:318-320`
- **Causa raiz:** `CheckoutSettingsController.@Put()` chama
  `entityTags.assertIfMatch(ifMatch, current)`, que lança
  `PreconditionRequiredException` (428) quando o `If-Match` está ausente/branco.
  O `patchCheckoutSettings` faz `PUT /checkout-settings` apenas com corpo JSON e
  **sem** `If-Match`, então a precondição falha antes do update. Comparar com
  `updateWebhookEndpoint` (linha 397), que corretamente envia
  `headers:{'If-Match':'*'}`.
- **Impacto:** o botão "Guardar modo" está **totalmente quebrado** — todo save
  falha e o usuário vê "Erro (...)". O modo do widget (silent/proactive/manual)
  nunca pode ser alterado pelo console.
- **Remediação decidida:** enviar `If-Match` no `patchCheckoutSettings`
  espelhando `updateWebhookEndpoint` (`headers:{'If-Match':'*'}` ou, idealmente,
  o ETag do GET anterior para concorrência otimista real); adicionar teste de
  regressão afirmando a presença do header.
- **Contrato/migração:** **mudança de contrato no cliente** (header passa a ser
  enviado sempre). Sem migração de dados. O contrato do servidor já exige
  `If-Match`; a correção alinha o cliente a ele.

### BUG-CHKSET-2 (P2, concorrência) — `useEffect` de load sem guarda de in-flight → resposta obsoleta sobrescreve estado novo
- **Arquivo:** `apps/dashboard/src/pages/checkout-settings-page.tsx:13-33`
- **Causa raiz:** o efeito `load()` depende de `[api, props.me]` mas não usa flag
  de active/abort (diferente do `onboarding-wizard`, que usa `let active`). Uma
  troca rápida de `me` ou remount pode deixar um GET anterior resolver depois de
  um posterior e `setSettings` com dado obsoleto.
- **Impacto:** janela de corrida em que o formulário mostra modo obsoleto após
  mudanças de auth/perfil. Baixa frequência, mas real.
- **Remediação decidida:** adotar o padrão `let active = true; return () => { active = false }`
  já usado em `onboarding-wizard.tsx`, ou `AbortController`.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

## Alternativas consideradas
- **Relaxar o controller para aceitar PUT sem `If-Match`.** Rejeitado: remove a
  proteção de lost-update; o caminho correto é o cliente enviar a precondição.
- **`If-Match:'*'` permanente.** Aceitável como mitigação imediata do P0, mas a
  meta é propagar o ETag real do GET para concorrência otimista efetiva.

## Consequências
**Positivas:** save do modo volta a funcionar; proteção de concorrência mantida;
estado de formulário sem corrida.
**Negativas/riscos:** com ETag real, o usuário pode encontrar conflito 428
legítimo (escrita concorrente) — exige UX de reload/reaplicação.

**Barra de aceite:** "Guardar modo" persiste sem `428`; teste de regressão
garante `If-Match` presente; remount rápido não aplica resposta obsoleta.
