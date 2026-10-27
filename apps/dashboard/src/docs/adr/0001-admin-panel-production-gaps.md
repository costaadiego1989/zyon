# ADR 0001 (dashboard) — Lacunas do painel admin do tenant para produção (gap analysis)

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Dashboard/Plataforma), Produto, Segurança, Growth
- **Relacionado:** [ADR 0008](../../../../../docs/architecture/adr/0008-production-readiness-roadmap.md), [ADR 0016](../../../../../docs/architecture/adr/0016-merchant-config-surface-hardening.md), [ADR 0017](../../../../../docs/architecture/adr/0017-integrations-api-keys-webhooks.md), [ADR 0024](../../../../../docs/architecture/adr/0024-dashboard-config-preview-onboarding.md), [ADR 0026](../../../../../docs/architecture/adr/0026-production-readiness-tracker.md), [ADR 0028](../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Cross-context: `payment` (billing/connections), `audit`, `commerce`, `agent-rules`, `negotiation`, `coupons`, `cross-sell`, `auth`.

## Contexto

O painel admin do tenant (`apps/dashboard`) é um SPA de aba única
(`main.tsx`) com **12 abas** ligadas por um único `createDashboardApi`
(`api-client.ts`). As abas hoje montadas são:

| Aba (nav) | Página | Rotas de API consumidas |
| --- | --- | --- |
| Primeiros passos | `onboarding-wizard` | `/onboarding`, `/onboarding/steps/:step/complete` |
| Operação | `overview-demo` | read-model de overview |
| Pedidos e envios | `orders-shipments` | `/orders` |
| Clientes | `customers` | `/customers` |
| Desenvolvedores | `integrations` | `/integrations/api-keys`, `/webhook-endpoints*` |
| Embed | `embed` | `/embed/sessions` |
| Preview | `preview` | preview do widget |
| Tema | `theme` | `/merchants/me/theme` |
| Suporte | `support-settings` | `/support/settings`, `/support/tickets*` |
| Checkout | `checkout-settings` | `/checkout-settings` |
| Agente | `merchant-rules` | `/merchants/me/rules` |
| Negociação | `negotiation` | `/negotiations/evaluate` (apenas simulação) |

A API (`apps/api/src/modules`) já expõe um conjunto **bem maior** de
capacidades admin do que o painel consome. O levantamento dos controllers
(`*.controller.ts`) e use-cases (`*.use-case*.ts`) mostra rotas prontas e
guardadas por tenant que **não têm nenhuma superfície de UI**, além de
capacidades críticas para produção que **não existem nem na API**.

Este ADR cataloga as lacunas (o que a API já serve mas o painel não expõe,
e o que falta por completo), prioriza-as e indica a página sugerida.

### Critério de "API pronta"

- **Sim** — controller montado, escopado por tenant (ex.: `TenantCredentialGuard` /
  `merchant_id`) e **sem** `@NonProductionRoute`.
- **Parcial** — use-case existe mas sem rota HTTP admin estável, ou rota
  só de leitura/sem as ações de comando que a UI exigiria.
- **Não** — rota gated por `@NonProductionRoute`, ou capacidade inexistente
  no domínio.

## Decisão

Tratar o painel admin como **superfície incompleta para produção** e
priorizar o fechamento das lacunas abaixo. A ordem de execução segue a
prioridade P0 → P3. Itens cuja API ainda não está pronta (`coupons`,
`cross-sell`, gestão de usuários/papéis) exigem trabalho de backend antes
da UI e estão sinalizados para não serem confundidos com "só falta tela".

### Lacunas priorizadas

#### P0 — Bloqueadores de produção (API pronta, sem UI)

1. **Billing / Assinatura do tenant.** A API já tem `billing`
   (`payment-platform.controller`): `GET /billing/subscription`,
   `POST /billing/checkout-session`, `POST /billing/portal-session`.
   Sem UI, o tenant não vê plano, uso ou fatura, e não há caminho de
   monetização. **API pronta: Sim.** Página sugerida: nova aba
   **Faturamento** (`billing-page`).

2. **Conexões de pagamento (payout do merchant).** `payments/connections`
   expõe onboarding e sync de Stripe e Asaas
   (`POST /payments/connections/stripe/onboarding-link`, `/stripe/sync`,
   `/asaas`, `/asaas/onboarding-link`, `/asaas/sync`, `GET /payments/connections`).
   Sem UI, o merchant **não consegue conectar conta de recebimento** — bloqueia
   ir para produção transacional. **API pronta: Sim.** Página sugerida:
   nova aba **Pagamentos → Conexões** (`payment-connections-page`).

3. **Visualizador de log de auditoria.** `audit-events.controller`
   (`GET /audit-events`) já está guardado por `TenantCredentialGuard` +
   `TenantAccessGuard`. Requisito de segurança/compliance para produção
   (quem mudou o quê). Sem UI. **API pronta: Sim.** Página sugerida: nova
   aba **Auditoria** (`audit-log-page`).

#### P1 — Capacidades admin importantes (API pronta, sem UI)

4. **Conexões de commerce (Shopify et al.).** `commerce/connections`
   (`GET`, `POST`, `POST /test`, `POST /sync`, `DELETE`) está pronto e
   escopado. O painel só tem `integrations` (api-keys/webhooks), não a
   ligação com a plataforma de e-commerce. **API pronta: Sim.** Página
   sugerida: aba **Integrações → Loja/Commerce** (estender `integrations-page`
   ou `commerce-connections-page`).

5. **Editor do motor de regras do agente (`agent-rules`).** O módulo
   `agent-rules` expõe `GET/PUT /agent-rules`, `GET /agent-rules/context`,
   e regras por agente (`GET/PUT /agent-rules/:agentId`,
   `GET /agent-rules/:agentId/context`). A aba "Agente" do painel hoje só
   edita `merchant-rules` (`/merchants/me/rules`) — **não** alcança a
   profundidade do motor de regras nem regras por agente. **API pronta: Sim.**
   Página sugerida: estender `merchant-rules-page` com seção **Regras do agente**
   (ou nova `agent-rules-page`).

6. **Editor de política de negociação (persistente).** A aba "Negociação"
   só chama `POST /negotiations/evaluate` (simulador efêmero). A API tem
   `merchant-negotiation-policy.controller` (`GET/PUT`) para **persistir** a
   política do merchant. **API pronta: Sim.** Página sugerida: estender
   `negotiation-page` com editor de política (carregar/salvar via `GET/PUT`).

7. **Gestão de instalações + health.** `installations.controller`
   (`GET`, `POST`, `GET/PUT /:id`, `GET/POST /:id/health`) permite listar e
   inspecionar saúde das instalações do tenant. Sem UI. **API pronta: Sim.**
   Página sugerida: aba **Desenvolvedores → Instalações** (estender
   `integrations-page`).

#### P2 — Operação e governança (API parcial ou gated)

8. **Reconciliação de pagamentos.** Existe `reconcile-payment-intents.use-case`
   e `GET /payments` + `GET /payments/:paymentId` (via `operations`), mas
   **não há rota de comando** de reconciliação/estorno exposta para a UI;
   a aba "Pedidos" só lista. **API pronta: Parcial.** Página sugerida: aba
   **Pagamentos → Reconciliação**; requer expor o use-case como rota admin antes.

9. **Gestão de cupons (UI).** `merchant-coupons.controller`
   (`POST`/`GET`/`DELETE`) existe mas está sob `@NonProductionRoute` (P3/L1,
   ainda em memória conforme ADR 0020/coupons). **API pronta: Não** (gated).
   Página sugerida: aba **Growth → Cupons** (`coupons-page`), após hardening
   do backend (Prisma + idempotência).

10. **Gestão de cross-sell (UI).** `merchant-cross-sell.controller`
    (CRUD de `promotions`) também sob `@NonProductionRoute`. **API pronta: Não**
    (gated). Página sugerida: aba **Growth → Cross-sell** (`cross-sell-page`),
    após hardening.

#### P3 — Plataforma / multiusuário

11. **Gestão de usuários e papéis (RBAC).** `auth` só tem
    `login.use-case` e `register-merchant.use-case` — um único usuário por
    tenant, sem convites, papéis ou permissões. Não há como uma equipe operar
    o painel com acessos distintos. **API pronta: Não** (capacidade
    inexistente). Página sugerida: aba **Configurações → Equipe**
    (`team-page`); exige modelagem de usuários/papéis no contexto `auth`.

12. **Analytics / relatórios.** A aba "Operação" usa um read-model de
    overview (demo). `operations-read.use-cases` oferece leitura, mas não há
    relatórios exportáveis (faturamento por período, funil de checkout,
    conversão de negociação). **API pronta: Parcial.** Página sugerida: aba
    **Relatórios** (`analytics-page`), reaproveitando `operations` e
    `audit-events`, com endpoints de agregação a definir.

### Resumo de prioridade

| # | Lacuna | Prioridade | API pronta | Página sugerida |
| --- | --- | --- | --- | --- |
| 1 | Billing / assinatura | P0 | Sim | `billing-page` |
| 2 | Conexões de pagamento (Stripe/Asaas) | P0 | Sim | `payment-connections-page` |
| 3 | Visualizador de auditoria | P0 | Sim | `audit-log-page` |
| 4 | Conexões de commerce (Shopify) | P1 | Sim | `commerce-connections-page` |
| 5 | Editor de regras do agente | P1 | Sim | `merchant-rules-page` (estender) |
| 6 | Editor de política de negociação | P1 | Sim | `negotiation-page` (estender) |
| 7 | Instalações + health | P1 | Sim | `integrations-page` (estender) |
| 8 | Reconciliação de pagamentos | P2 | Parcial | `payment-connections-page` (estender) |
| 9 | Gestão de cupons | P2 | Não (gated) | `coupons-page` |
| 10 | Gestão de cross-sell | P2 | Não (gated) | `cross-sell-page` |
| 11 | Usuários e papéis (RBAC) | P3 | Não | `team-page` |
| 12 | Analytics / relatórios | P3 | Parcial | `analytics-page` |

## Consequências

### Positivas

- Roadmap claro de UI admin priorizado pelo que **já está servível** pela API,
  permitindo entregar P0/P1 sem trabalho de backend (exceto expor 1 use-case
  de reconciliação).
- Separação explícita entre "só falta tela" (P0/P1) e "falta backend"
  (cupons, cross-sell, RBAC) evita estimativas erradas.

### Negativas / riscos

- **P0 são bloqueadores reais de produção**: sem billing e sem conexão de
  pagamento o tenant não monetiza nem recebe; sem auditoria há risco de
  compliance. Devem entrar antes do GA.
- Itens gated (`@NonProductionRoute`) exigem hardening de backend (Prisma,
  idempotência) antes de qualquer UI — construir a tela antes seria desperdício.
- RBAC ausente significa que hoje o painel pressupõe **um único operador por
  tenant**; qualquer cliente com equipe vai esbarrar nisso.

## Alternativas consideradas

1. **Entregar tudo de uma vez (big bang de UI).** Rejeitado: mistura itens
   prontos com itens que dependem de backend, atrasando os P0.
2. **Adiar billing/pagamentos para pós-GA.** Rejeitado: são pré-requisito de
   monetização e recebimento; sem eles o produto não fecha o ciclo comercial.
3. **Expor cupons/cross-sell já (mesmo gated).** Rejeitado: violaria as
   invariantes de produção (estado em memória, sem idempotência) descritas nos
   ADRs de `coupons`/`cross-sell`.

## Próximos passos

1. P0 #1–#3: criar `billing-page`, `payment-connections-page`, `audit-log-page`
   e os métodos correspondentes em `createDashboardApi`.
2. P1 #4–#7: estender `integrations-page`, `merchant-rules-page`,
   `negotiation-page` e adicionar conexões de commerce.
3. P2 #8: expor `reconcile-payment-intents` como rota admin antes da UI.
4. Backlog de backend: hardening de `coupons`/`cross-sell` e modelagem de
   RBAC em `auth` antes das respectivas telas.
