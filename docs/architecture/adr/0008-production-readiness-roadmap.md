# ADR 0008 — Roadmap de prontidão para produção (umbrella)

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Produto, Plataforma, Segurança
- **Relacionado:** [ADR 0001](./0001-modular-monolith-bounded-contexts.md), [ADR 0002](./0002-acl-pattern-cross-context.md), [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0004](./0004-prisma-isolation-per-context.md), [ADR 0005](./0005-multi-tenant-isolation.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), e os ADRs por módulo/superfície [0009](./0009-platform-p0-hardening.md)–[0025](./0025-packages-engines-sdk-hardening.md).

> O número `0006` permanece reservado ao ADR de pivot para WhatsApp já
> listado no índice. Este ADR não o usa.

## Contexto

A AACP é uma plataforma de checkout conversacional multi-tenant composta
por três superfícies: a **API** (`apps/api`, NestJS + Prisma, Clean
Architecture + DDD modular), o **widget** embarcado na loja
(`apps/widget`) e o **painel do tenant / dashboard** (`apps/dashboard`).
O limite de tenant é `merchant_id`.

O [ADR 0007](./0007-module-maturity-and-progressive-closure.md) já
estabeleceu, e é a fonte de verdade para:

- o modelo de maturidade `L0`–`L4` e a **Definition of Done (DoD) de L3**;
- a classificação atual de cada módulo/capacidade
  (`.specs/maturity/MATURITY-INDEX.md`);
- os **bloqueios transversais P0** (`.specs/maturity/p0-blockers.md`);
- a ordem de fechamento **P0 → P1 → P2 → P3 → P4**.

Hoje **nenhum módulo está em L3** porque os bloqueios P0 ainda estão
abertos. Evidências verificadas no código:

- CORS global com `origin: true` em `apps/api/src/main.ts:16` (P0.6).
- `CardForm` do widget transmite PAN/CVV ao backend
  (`apps/widget/src/components/checkout/CardForm.tsx`, `cvv` na linha 104,
  `ccv: cvv` na linha 164) (P0.8).
- Outbox em memória (`apps/api/src/shared/messaging/infrastructure/in-memory-outbox.repository.ts`)
  apesar da tabela `OutboxMessage` existir no schema (P0.4).
- Clientes Prisma instanciados fora do `PersistenceModule` em vários
  contextos (P0.2, ver ADR 0004 Contexto).
- `TenantGuard` que não valida tenant e middleware Prisma com lista de
  modelos incompleta (P0.1/P0.3, ver ADR 0005 Contexto).

Além dos P0, o usuário/produto apontou três lacunas de superfície que
bloqueiam o go-to-market mas não estão totalmente cobertas pelas planilhas
de maturidade:

1. **Onboarding self-serve do tenant** — existe `RegisterMerchantUseCase`
   (`apps/api/src/modules/auth/application/register-merchant.use-case.ts`)
   e um toggle login/signup no dashboard (`apps/dashboard/src/main.tsx`),
   mas não há fluxo de provisionamento guiado (criar merchant → configurar
   checkout → gerar embed → publicar) nem onboarding de produto.
2. **Painel de configuração do checkout** — páginas existem
   (`checkout-settings-page.tsx`, `theme-page.tsx`, `merchant-rules-page.tsx`),
   mas a configuração end-to-end do comportamento do checkout não é coesa
   nem completa.
3. **Live preview do checkout** dentro do dashboard — só existe preview de
   tema (`apps/dashboard/src/pages/theme-page.tsx`, bloco `theme-preview`),
   não um preview do widget de checkout real.

## Decisão

Adotar este ADR como o **roadmap umbrella de prontidão para produção**. Ele
não redefine o modelo de maturidade — **reusa integralmente os níveis
`L0`–`L4` e a DoD de L3 do ADR 0007 como barra de aceite** —, e organiza o
trabalho em ADRs focados por módulo/superfície, todos subordinados à mesma
DoD e à mesma ordem de fechamento.

Regras de governança deste roadmap:

- A barra de produção para o piloto é **L3 (pilot-ready)** conforme a DoD
  do ADR 0007. `L4` (SLOs, alertas, recuperação contínua) é meta
  pós-piloto e fica fora do gate de início.
- **Nenhum módulo chega a L3 enquanto os P0 não fecharem** (ADR
  [0009](./0009-platform-p0-hardening.md)).
- A ordem de execução segue P0 → P1 → P2 → P3 → P4. Itens P3/P4 não podem
  atrasar P0/P1.
- Cada ADR por módulo descreve o estado atual com evidência, a arquitetura
  alvo e as melhorias divididas em **Segurança / Desacoplamento /
  Persistência & Consistência / Observabilidade / Otimização & Escala /
  Features faltantes**, referenciando a planilha de maturidade do módulo
  como linha de base.
- As três lacunas de superfície (onboarding, painel de config, live
  preview) são tratadas explicitamente nos ADRs
  [0015](./0015-auth-and-tenant-onboarding.md) (backend de onboarding) e
  [0024](./0024-dashboard-config-preview-onboarding.md) (UX de dashboard,
  config e preview).

### Mapa de ADRs por superfície

| ADR | Título | Superfície | Prioridade |
|---|---|---|---|
| [0009](./0009-platform-p0-hardening.md) | Plataforma P0: tenant, persistência, outbox, CORS, secrets, rotas legadas | Plataforma/API | P0 |
| [0010](./0010-checkout-pilot-path-hardening.md) | Checkout — caminho transacional do piloto | API | P1 |
| [0011](./0011-payment-hardening.md) | Payment — Asaas, idempotência, tokenização de cartão | API | P1 |
| [0012](./0012-embed-security-hardening.md) | Embed — sessão, token e segurança de origem | API | P1 |
| [0013](./0013-commerce-shopify-sync-hardening.md) | Commerce — sincronização de pedidos Shopify | API | P1 |
| [0014](./0014-shipping-engine-hardening.md) | Shipping — cotação, subsídio e persistência | API | P1 |
| [0015](./0015-auth-and-tenant-onboarding.md) | Auth + onboarding self-serve do tenant | API | P2 |
| [0016](./0016-merchant-config-surface-hardening.md) | Merchant + agent-rules + checkout-settings (config do tenant) | API | P2 |
| [0017](./0017-integrations-api-keys-webhooks.md) | Integrations — API keys e webhooks de saída | API | P2 |
| [0018](./0018-buyer-identity-and-history.md) | Buyer-account + buyer-purchase-history | API | P2 |
| [0019](./0019-negotiation-and-support.md) | Negotiation + support | API | P2 |
| [0020](./0020-growth-cross-sell-coupons-fulfillment.md) | Cross-sell + coupons + fulfillment | API | P3 |
| [0021](./0021-post-pilot-self-checkout-scraping.md) | Self-checkout + scraping-agent | API | P4 |
| [0022](./0022-widget-transactional-path.md) | Widget transacional: cart, card, pix, shipping, confirmation | Widget | P1 |
| [0023](./0023-widget-shell-identity-experience.md) | Widget shell/embed, chat, auth-hub, support, tema, a11y, SDK | Widget | P2 |
| [0024](./0024-dashboard-config-preview-onboarding.md) | Dashboard: config do checkout, live preview, onboarding e páginas | Dashboard | P1–P2 |
| [0025](./0025-packages-engines-sdk-hardening.md) | Packages: engines, SDK e shared-types | Packages | transversal |

## Melhorias para produção

### Segurança

- Fechar todos os P0 de segurança antes de tráfego externo: CORS restrito,
  validação global de request, remoção de secrets/fallbacks inseguros,
  desativação de rotas legadas abertas e do formulário de cartão com
  PAN/CVV (ADR 0009, 0011, 0022).
- Garantir authz explícita por superfície (merchant JWT, buyer, API key,
  embed token) com testes cross-tenant, replay, expiração e escopo.

### Desacoplamento

- Centralizar Prisma no `PersistenceModule` e remover o `checkout` como
  container de infraestrutura compartilhada (ADR 0004 + 0009).
- Comunicação cross-context **apenas** por porta pública ou evento
  (ADR 0001/0002/0003); tornar o lint de boundaries gate bloqueante.

### Persistência & Consistência

- Outbox durável + retries + DLQ + idempotência de handlers (ADR 0003 +
  0009).
- Nenhum estado crítico de compra (sessão, intent de pagamento, cotação,
  cupom, shipment, idempotência) somente em memória em produção.

### Observabilidade

- Logs estruturados com `correlation_id` + `merchant_id`; métricas de
  sucesso/erro/latência/backlog; sem PAN/CVV/segredo/PII desnecessária em
  logs ou traces.

### Otimização & Escala

- Dispatcher de outbox com lock e cadência controlada; paginação em
  read-models; rate limiting nas rotas públicas/embed; timeouts e retry em
  todas as integrações externas via ACL (ADR 0002).

### Features faltantes (go-to-market)

- **Onboarding self-serve** do tenant (ADR 0015 + 0024).
- **Painel de configuração do checkout** coeso (ADR 0016 + 0024).
- **Live preview do checkout** no dashboard (ADR 0024).

## Gate de início do piloto

Reafirma o gate do ADR 0007: o piloto externo só inicia quando **P0
concluído**, **todo o caminho P1 em L3**, sem rota externa sem auth
deliberada/documentada, sem estado crítico de compra só em memória,
migration/restart/retry aprovados em banco real, CI bloqueando
lint/typecheck/build/testes/Prisma, e E2E cobrindo happy path,
cross-tenant negado, token/origin inválidos, retry idempotente, provider
indisponível e webhook duplicado.

## Alternativas consideradas

- **Um único ADR gigante de produção.** Rejeitado: vira documento ilegível
  e impede ownership por módulo. O ADR 0007 já previu ADRs próprios por
  decisão específica.
- **Pular L3 e ir direto para L4/produção plena.** Rejeitado pelo ADR 0007:
  promove risco financeiro e de vazamento de tenant sem baseline confiável.
- **Tratar onboarding/preview como features de produto fora de ADR.**
  Rejeitado: ambos mudam contratos públicos, fronteiras de auth e
  persistência, portanto exigem decisão arquitetural registrada.

## Consequências

**Positivas:**
- Visão única de prontidão, com barra de aceite objetiva (DoD L3) e
  rastreabilidade para cada módulo.
- Sequenciamento que protege o caminho financeiro do piloto primeiro.

**Negativas / riscos:**
- Volume de ADRs aumenta a carga de manutenção do índice (mitigado por
  README único).
- Risco de drift entre ADRs e planilhas de maturidade se atualizados em
  separado; a governança do ADR 0007 (planilha como fonte de status,
  ADR como fonte de decisão) deve ser respeitada.
