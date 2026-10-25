# ADR 0001 (embed) — Sandbox do iframe de preview e validação de inputs do snippet

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Embed), Segurança, Produto
- **Relacionado:** [ADR 0012 — Embed security hardening](../../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0023 — Widget shell identity experience](../../../../../../../docs/architecture/adr/0023-widget-shell-identity-experience.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md). Origem: diagnóstico read-only do `apps/dashboard` (preview-page.tsx, embed-page.tsx).

## Contexto

O módulo `embed` é dono do snippet de embed e do live preview do widget dentro do
console. A `PreviewPage` renderiza o bundle do widget num iframe; a `EmbedPage`
gera o snippet e expõe inputs (ex.: TTL) que parametrizam o embed. O bundle do
widget é carregado da origem da API e recebe um token escopado por tenant.

Portas/fluxos chave consumidos pelo dashboard:
- **iframe de preview** — carrega o bundle do widget com token escopado.
- **inputs do snippet** — TTL e similares que viram parâmetros do embed.

Invariantes que o módulo deve sustentar:
- isolamento do bundle de terceiros: a sandbox do iframe deve impedir acesso à
  origem/sessão do dashboard.
- inputs numéricos validados (range, finitude) antes de chegar ao `issue()`.

## Decisão

Endurecer a sandbox do iframe de preview e validar os inputs do snippet:

- remover `allow-same-origin` da sandbox se o widget rodar sem ele, ou hospedar o
  preview numa origem separada; no mínimo, **documentar** por que ambos são
  necessários;
- coagir inputs numéricos com fallback (`Number.isFinite`) e clamp em min/max antes
  de emitir; desabilitar `issue()`/save em numéricos inválidos.

## Melhorias para produção

### Segurança
- Evitar a combinação `allow-scripts` + `allow-same-origin` (anti-padrão de escape
  de sandbox); defesa em profundidade na página que roda bundle quase-terceiro.

### Desacoplamento
- Preview numa origem separada isola a sessão do dashboard do bundle do widget.

### Persistência & Consistência
- Inputs validados não enviam `NaN`/`null` ao embed.

### Observabilidade
- N/A direto; logar tentativa de emitir com input inválido.

### Otimização & Escala
- N/A.

### Features faltantes
- Documentação explícita do modelo de origem/sandbox do preview (ADR 0012/0023).

## Bugs diagnosticados e remediação decidida

### BUG-EMB-1 (P2, segurança) — Sandbox do iframe de preview usa `allow-scripts` + `allow-same-origin` juntos (escape de sandbox)
- **Arquivo:** `apps/dashboard/src/pages/preview-page.tsx:121-132`
- **Causa raiz:** o iframe de preview é renderizado com
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`. A
  combinação `allow-scripts` + `allow-same-origin` permite que o script enquadrado
  remova o próprio atributo `sandbox` e rode com os privilégios da origem do parent.
  O bundle do widget é carregado da origem da API e recebe um token escopado por
  tenant, o que mitiga parcialmente, mas é o anti-padrão documentado.
- **Impacto:** se o bundle do widget (ou scripts transitivos) for comprometido, a
  sandbox não oferece isolamento da origem do dashboard (cookies, sessão). Lacuna
  de defesa em profundidade numa página que roda código de bundle quase-terceiro.
- **Remediação decidida:** remover `allow-same-origin` se o widget puder rodar sem
  ele, ou hospedar o preview numa origem separada; no mínimo documentar por que
  ambos são necessários.
- **Contrato/migração:** sem migração de dados. Hospedar em origem separada seria
  **mudança de configuração/deploy** (nova origem), não de contrato de API.

### BUG-EMB-2 (P3, validação) — Inputs de TTL/numéricos aceitam `NaN` e fora de range antes do `issue()`
- **Arquivo:** `apps/dashboard/src/pages/embed-page.tsx:72-74` (mesmo padrão em `rules-form.tsx:179-185` — ver ADR de merchant)
- **Causa raiz:** o input de TTL usa `Number(event.target.value)`, que produz `NaN`
  para input vazio; min/max são atributos HTML advisórios, não impostos antes do
  `issue()`.
- **Impacto:** um campo numérico vazio/inválido pode enviar `NaN` (serializado como
  `null`) ou um TTL fora de range à API, dependendo inteiramente da validação do
  servidor.
- **Remediação decidida:** coagir com fallback (`Number.isFinite`) e clamp em
  min/max antes de enviar; desabilitar `issue()` em numéricos inválidos.
- **Contrato/migração:** sem migração; reforça validação no cliente (servidor
  mantém validação como defesa).

## Alternativas consideradas
- **Manter `allow-same-origin` "porque o widget precisa".** Aceitável apenas se
  documentado e com o bundle servido de origem confiável; a meta é remover ou
  isolar por origem.
- **Confiar só na validação do servidor para TTL.** Rejeitado: envia `null`/fora
  de range desnecessariamente.

## Consequências
**Positivas:** menor superfície de escape de sandbox; inputs do snippet válidos.
**Negativas/riscos:** isolar por origem exige trabalho de deploy; remover
`allow-same-origin` pode quebrar o preview se o widget depender dele (validar).

**Barra de aceite:** sandbox do preview sem `allow-same-origin` ou origem separada
(ou justificativa documentada); TTL inválido não chega ao `issue()`.
