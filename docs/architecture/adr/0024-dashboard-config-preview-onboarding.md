# ADR 0024 — Dashboard: configuração do checkout, live preview, onboarding e páginas

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Dashboard), Produto, Design, Segurança
- **Relacionado:** [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0012](./0012-embed-security-hardening.md), [ADR 0015](./0015-auth-and-tenant-onboarding.md), [ADR 0016](./0016-merchant-config-surface-hardening.md), [ADR 0017](./0017-integrations-api-keys-webhooks.md), [ADR 0023](./0023-widget-shell-identity-experience.md).

## Contexto

O painel do tenant (`apps/dashboard/src/pages/`) tem páginas para:
`checkout-settings-page`, `customers-page`, `embed-page`,
`integrations-page`, `merchant-rules-page`, `negotiation-page`,
`orders-shipments-page`, `overview-demo-page`, `support-settings-page`,
`theme-page`. O cliente HTTP (`apps/dashboard/src/api-client.ts`) já fala
com a API por cookie e tem `register`. A autenticação é um toggle
login/signup em tela única (`apps/dashboard/src/main.tsx`,
`AuthMode = "login" | "signup"`).

Lacunas que o produto pediu, confirmadas no código:

1. **Onboarding self-serve guiado** — só existe signup de uma tela; não há
   fluxo de provisionamento (registrar → configurar checkout → gerar embed
   → instalar → publicar) com retomada. O backend está parcialmente pronto
   (ADR 0015).
2. **Painel de configuração do checkout coeso** — as configs existem
   espalhadas (`checkout-settings-page`, `merchant-rules-page`,
   `theme-page`), mas não há um painel coeso que represente o comportamento
   do checkout end-to-end.
3. **Live preview do checkout** — só há preview de **tema**
   (`apps/dashboard/src/pages/theme-page.tsx`, bloco `theme-preview` com CSS
   vars `--preview-*`), não um preview do **widget de checkout real** com a
   config aplicada.

## Decisão

- **Onboarding guiado** no dashboard que consome o caso de uso de
  onboarding (ADR 0015): wizard com passos persistidos e retomáveis
  (conta → config básica → embed/instalação → publicar), refletindo o
  funnel do backend.
- **Painel de configuração do checkout** coeso que edita os contratos de
  `checkout-settings` + `merchant-rules` + tema (ADR 0016) com validação,
  preview e save por seção, sempre escopado ao `merchant_id` da credencial.
- **Live preview do checkout**: renderizar o **widget real** (via SDK,
  ADR 0023/0025) em modo preview, alimentado pela config em edição e por um
  token de embed de preview (ADR 0012), sem afetar dados de produção.
  Reaproveitar o padrão de preview do tema (CSS vars) como base visual,
  mas elevando para o widget de checkout funcional.

## Melhorias para produção

### Segurança
- Sessão de operador via cookie seguro (ADR 0015); todas as chamadas
  escopadas por tenant pela credencial (nunca `merchant_id` do body);
  preview usa token de embed de preview com origin/expiração (ADR 0012);
  segredos/API keys nunca exibidos em claro após criação (ADR 0017).

### Desacoplamento
- Dashboard consome **apenas** contratos públicos da API/SDK
  (`api-client.ts` + `@aacp/shared-types`); sem acesso direto a tabelas;
  preview via SDK do widget, não reimplementando o checkout.

### Persistência & Consistência
- Estado de onboarding lido/gravado por contrato idempotente (ADR 0015);
  saves de config otimistas com reconciliação; preview reflete a config
  efetivamente salva ou claramente marcada como rascunho.

### Observabilidade
- Telemetria do funil de onboarding e de uso das páginas de config; erros
  de save expostos ao usuário com mensagem clara (já há tratamento de
  `DashboardHttpError`).

### Otimização & Escala
- Carregamento por seção; debounce de preview; cache de config do tenant.

### Features faltantes
- **Wizard de onboarding self-serve**; **painel de config coeso**;
  **live preview do checkout real**; gestão de membros do tenant;
  visualização/reentrega de webhooks e DLQ (ADR 0017); allowlist de origins
  de embed (ADR 0012).

## Alternativas consideradas
- **Preview por screenshot estático/mock.** Rejeitado: não valida a config
  real; usamos o widget real em modo preview.
- **Onboarding como página única (atual).** Rejeitado: não cobre
  provisionamento nem retomada self-serve.
- **Dashboard acessando a API por rotas internas sem contrato.** Rejeitado:
  viola desacoplamento; só contratos públicos/SDK.

## Consequências
**Positivas:** go-to-market self-serve; tenant configura e vê o checkout
antes de publicar; menos suporte manual.
**Negativas/riscos:** live preview acopla dashboard ao SDK do widget
(versionar contratos, ADR 0025); token de embed de preview precisa de
isolamento rígido para não tocar produção.

**Barra de aceite:** wizard de onboarding retomável funcionando ponta a
ponta; painel de config salvando contratos validados; live preview do
widget real refletindo a config; tudo escopado por tenant e sem segredo
exposto.
