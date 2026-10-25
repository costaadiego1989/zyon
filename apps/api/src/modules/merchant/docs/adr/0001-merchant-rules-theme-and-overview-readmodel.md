# ADR 0001 (merchant) — Rules, theme e read-model de overview do console

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Merchant), Produto, Plataforma
- **Relacionado:** [ADR 0016 — Merchant/agent-rules/checkout-settings](../../../../../../../docs/architecture/adr/0016-merchant-config-surface-hardening.md), [ADR 0005 — Multi-tenant isolation](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009 — Platform P0 hardening](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0024 — Dashboard config/preview/onboarding](../../../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0025 — Packages/engines/SDK hardening](../../../../../../../docs/architecture/adr/0025-packages-engines-sdk-hardening.md). Origem: diagnóstico read-only do `apps/dashboard` cruzado com `merchant` controllers e `packages/shared-types`.

## Contexto

O módulo `merchant` é dono das regras comerciais do tenant (`MerchantRules` —
guardrails de desconto/margem via `rules-engine`), do tema/branding
(`MerchantTheme`) e do read-model de overview consumido pela página inicial do
console.

Portas/fluxos chave consumidos pelo dashboard:
- **putMerchantRules** — persistência dos guardrails comerciais (páginas Overview
  e Merchant Rules).
- **GET/PUT MerchantTheme** — leitura e gravação do branding (página Theme).
- **DashboardOverview** read-model — métricas de operação (ofertas, conversas,
  conversão, shipping) na Overview.

Invariantes que o módulo deve sustentar:
- desconto/margem só pelo `rules-engine`; guardrails persistidos só quando o
  servidor confirma (sem "save fantasma").
- `MerchantTheme` nunca deve ser sobrescrito por defaults se o GET prévio falhou.
- métricas de overview devem refletir read-models reais, não placeholders.
- inputs numéricos não podem enviar `NaN`/`null` para campos de regra.

## Decisão

Tornar explícitos o sucesso e a falha em todas as escritas de `merchant`, e
ancorar o read-model de overview em dados reais:

- `saveRules` envolve a chamada em `try/catch`, expõe `DashboardHttpError.responseBody`
  via banner e mantém o formulário sujo em falha, com confirmação em sucesso;
- `save` do tema só é permitido após um GET bem-sucedido (flag de "carregado"),
  recusando PUT de tema nunca carregado;
- a Overview busca o `DashboardOverview` real (endpoint de overview) em vez de
  sintetizar o objeto com zeros, ou a página é rotulada como parcial;
- campos numéricos coagem com fallback (`Number.isFinite`) e clamp min/max antes
  de enviar.

## Melhorias para produção

### Segurança
- `merchant_id` sempre do contexto de tenant (ADR 0005/0009); guardrails comerciais
  nunca derivados de input não validado.

### Desacoplamento
- Banner de erro/sucesso reutilizável; páginas não duplicam tratamento de erro.

### Persistência & Consistência
- Gate de "carregado" antes de PUT de tema evita clobber por defaults;
  considerar PATCH parcial server-side em vez de PUT do agregado inteiro.

### Observabilidade
- Distinguir loading/empty/error nas telas; relatar falha de save de regra
  explicitamente (commerce-risk).

### Otimização & Escala
- Read-model de overview paginado/projetado; evitar sintetizar métricas no cliente.

### Features faltantes
- Endpoint de overview real com ofertas/conversas/conversão; validação de range
  de regras no cliente espelhando o servidor.

## Bugs diagnosticados e remediação decidida

### BUG-MERCH-1 (P1, funcional) — `saveRules` sem tratamento de erro em Overview e Merchant Rules
- **Arquivo:** `apps/dashboard/src/pages/merchant-rules-page.tsx:47-56` (mesmo padrão em `overview-demo-page.tsx:134-143`)
- **Causa raiz:** `saveRules()` aguarda `api.putMerchantRules` em `try/finally`
  **sem `catch`**. Um PUT rejeitado (422/401/rede) é unhandled rejection;
  `saving=false` é restaurado mas o usuário não recebe feedback e o formulário
  retém edições não salvas como se persistidas.
- **Impacto:** saves de regra falhos parecem ter sucesso. O merchant pode crer
  que guardrails de desconto/margem foram persistidos quando não foram — perda
  silenciosa de dados com risco comercial.
- **Remediação decidida:** `try/catch`, expor `DashboardHttpError.responseBody`
  via banner, manter formulário sujo em falha, adicionar confirmação de sucesso.
- **Contrato/migração:** sem mudança de contrato/migração (correção de cliente).

### BUG-MERCH-2 (P2, dados) — Save de tema sem tema carregado persiste merge de `DEFAULT_MERCHANT_THEME` (clobber)
- **Arquivo:** `apps/dashboard/src/pages/theme-page.tsx:67-91`
- **Causa raiz:** `normalizedTheme()` espalha o `theme` local (semeado por
  `mergeTheme()` = defaults completos) e dá PUT do `MerchantTheme` inteiro. Se o
  GET falhou (erro setado, tema em defaults), o usuário ainda pode Salvar e
  sobrescrever o tema do servidor com defaults, pois `save()` não gate em load
  bem-sucedido.
- **Impacto:** uma falha transitória de GET seguida de Save pode resetar
  silenciosamente o branding salvo do merchant para defaults — destrutivo e
  difícil de notar.
- **Remediação decidida:** desabilitar Save até GET bem-sucedido, ou rastrear flag
  `loaded` e recusar PUT de tema nunca carregado; considerar update parcial
  (PATCH) server-side.
- **Contrato/migração:** correção de cliente imediata; PATCH parcial seria
  **mudança de contrato** opcional (novo verbo/rota) — recomendado, não obrigatório.

### BUG-MERCH-3 (P1, observabilidade) — `OverviewDemoPage` engole erros de load → página mostra traços sem estado de erro
- **Arquivo:** `apps/dashboard/src/pages/overview-demo-page.tsx:123-127`
- **Causa raiz:** o `catch` de `load()` reseta overview/rules/supportTickets para
  `null` sem state de mensagem e sem inspecionar `DashboardHttpError`. O componente
  não tem UI de erro nem render distinto de loading vs erro — `overview` nulo
  renderiza métricas '-' igual a "ainda carregando" e a "falhou".
- **Impacto:** em 401/500 o operador vê um dashboard de '-' e "Carregando regras..."
  para sempre, sem indicação de falha. Indistinguível de tenant vazio.
- **Remediação decidida:** adicionar state de message/error e banner de erro
  distinto; diferenciar loading, empty e error; em 401 emitir/relayar expiração
  de sessão em vez de nular silenciosamente.
- **Contrato/migração:** sem mudança de contrato/migração.

### BUG-MERCH-4 (P3, dados) — `buildPilotMetrics` divide ofertas mas overview força ambas a 0 nesta página
- **Arquivo:** `apps/dashboard/src/pages/overview-demo-page.tsx:97-112`
- **Causa raiz:** `load()` constrói o overview com `offers_viewed:0`,
  `offers_accepted:0`, `conversations_started:0`, `recent_offers:[]`,
  `recent_sessions:[]` hardcoded (valores reais não buscados), enquanto
  `buildPilotMetrics` computa acceptance/shipping/session a partir desses campos.
  Logo, a maioria das métricas de "Operação" é estruturalmente sempre 0/'-'.
- **Impacto:** a Overview reporta zeros enganosos para conversas, ofertas,
  conversão e shipping — são placeholders, não derivados de read-models reais
  apesar da cópia da página afirmar que são.
- **Remediação decidida:** buscar o `DashboardOverview` real (GET overview) em vez
  de sintetizar a partir de orders+payments, ou rerotular a página como parcial.
- **Contrato/migração:** **possível mudança de contrato** — requer endpoint de
  overview real entregando esses read-models, se ainda não existir. Sem migração.

### BUG-MERCH-5 (P3, validação) — `NumberField` aceita `NaN`/fora de range antes do save
- **Arquivo:** `apps/dashboard/src/pages/rules-form.tsx:179-185` (mesma coerção em `embed-page.tsx:72-74`)
- **Causa raiz:** `NumberField` usa `Number(event.target.value)`, que produz `NaN`
  para input vazio; min/max são atributos HTML advisórios, não impostos antes do
  save. O `NaN` flui direto para saves de `MerchantRules`.
- **Impacto:** um campo numérico vazio/inválido pode enviar `NaN` (serializado
  como `null`) ou valor fora de range, dependendo inteiramente da validação do
  servidor; campos de regra podem ser salvos como `null`.
- **Remediação decidida:** coagir com fallback (`Number.isFinite`) e clamp em
  min/max antes de enviar; desabilitar save em numéricos inválidos.
- **Contrato/migração:** sem migração; reforça o contrato de validação existente
  no cliente (servidor deve manter validação como defesa).

## Alternativas consideradas
- **Confiar só na validação do servidor para regras/numéricos.** Rejeitado:
  perda silenciosa de dados e UX ruim; validar no cliente como primeira barreira.
- **Manter overview sintético com zeros.** Rejeitado: métricas enganosas violam
  a promessa da página.

## Consequências
**Positivas:** saves de regra/tema confiáveis e auditáveis; overview honesto;
sem clobber de branding.
**Negativas/riscos:** depende de endpoint de overview real (esforço de backend);
gates de load adicionam estados de UI a manter.

**Barra de aceite:** save de regra falho mostra erro e mantém form sujo; Save de
tema bloqueado sem GET ok; Overview distingue loading/empty/error; numéricos
inválidos não chegam ao PUT; métricas de overview vêm de read-model real ou a
página é rotulada parcial.
