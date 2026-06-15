# ADR 0026 — Tracker de prontidão para produção (source of truth)

- **Status:** aceito
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Produto, Plataforma, Segurança
- **Relacionado:** [ADR 0007](./0007-module-maturity-and-progressive-closure.md) (modelo de maturidade), [ADR 0008](./0008-production-readiness-roadmap.md) (roadmap umbrella), e os ADRs por módulo/superfície [0009](./0009-platform-p0-hardening.md)–[0025](./0025-packages-engines-sdk-hardening.md).

> O número `0006` permanece reservado ao ADR de pivot para WhatsApp. Este
> ADR não o usa.

## Contexto

O [ADR 0007](./0007-module-maturity-and-progressive-closure.md) define o
modelo de maturidade `L0`–`L4` e a Definition of Done de `L3`. O
[ADR 0008](./0008-production-readiness-roadmap.md) organiza o trabalho em
ADRs por módulo/superfície (0009–0025) na ordem `P0 → P4`.

Falta uma **superfície única de acompanhamento**: hoje o status real está
espalhado entre o índice (`README.md`), as planilhas de maturidade
(`.specs/maturity/`) e o texto de cada ADR. Sem um tracker central, é
difícil responder de forma objetiva "quanto falta para o piloto".

## Decisão

Este ADR é o **tracker operacional e a fonte de verdade de progresso**
para a execução dos ADRs 0009–0025. Ele não cria decisão arquitetural
nova — reusa a DoD de `L3` do ADR 0007 como barra de aceite e a ordem
`P0→P4` do ADR 0008.

### Governança

- **Fonte de verdade de decisão:** cada ADR de módulo (0009–0025).
- **Fonte de verdade de maturidade por módulo:** `.specs/maturity/`.
- **Fonte de verdade de progresso de execução:** este ADR (0026).
- Atualizar este tracker em todo PR que feche uma tarefa de ADR: marcar o
  checkbox, recalcular a barra da fase e atualizar o status do ADR.
- Status do ADR: `⬜ não iniciado` · `🟨 em progresso` · `✅ concluído`
  (= todos os critérios de aceite L3 do ADR marcados e gates verdes).
- Um ADR só vira `✅` quando build, typecheck, lint (gate), testes e
  Prisma estiverem verdes para o escopo dele.

### Como ler as barras

`[##########] 100%` = 10 blocos. Cada bloco ≈ 10%. A % de cada fase é a
média dos ADRs concluídos na fase. A % geral é a média ponderada por fase
(P0 e P1 têm peso de bloqueio do piloto).

## Progresso geral

```txt
Geral      [###-------]  28%   (5/18 ADRs concluídos)
Gate piloto: BLOQUEADO (P1 aberto; P0 fechado)
```

| Fase | Escopo | Progresso | ADRs |
|---|---|---|---|
| **P0** | Baseline + segurança financeira | `[##########]` 100% | 0009 |
| **P1** | Caminho transacional do piloto | `[#########-]` 95% | 0010, 0011, 0012, 0013, 0014, 0022, 0024(parte) |
| **P2** | Identidade e operação do merchant | `[##--------]` 17% | 0015(parte), 0016, 0017, 0018, 0019, 0023, 0024(parte) |
| **P3** | Growth e logística | `[----------]` 0% | 0020 |
| **P4** | Expansão pós-piloto | `[----------]` 0% | 0021 |
| **Transversal** | Packages/engines/SDK | `[----------]` 0% | 0025 |

## P0 — Bloqueios transversais (ADR 0009)

Nenhum módulo chega a `L3` enquanto qualquer item abaixo estiver aberto.
Detalhe em `.specs/maturity/p0-blockers.md`.

```txt
P0  [##########]  8/8
```

- [x] **P0.1** Lint de boundaries/arquitetura bloqueante no CI (remover `continue-on-error`).
- [x] **P0.2** Centralizar todo Prisma no `PersistenceModule`; remover `createPrismaClient` fora dele.
- [x] **P0.3** Corrigir `TenantContext`/`TenantGuard`/middleware + fuzz cross-tenant em banco real.
- [x] **P0.4** Outbox durável + retries + DLQ + idempotência de handlers (substituir `in-memory-outbox.repository.ts`).
- [x] **P0.5** Remover secrets default e fallbacks fake de provider em produção.
- [x] **P0.6** Restringir CORS (`apps/api/src/main.ts:16`) + validação global de request.
- [x] **P0.7** Desativar rotas legadas abertas em produção.
- [x] **P0.8** Desativar `CardForm` com PAN/CVV até tokenização provider-side.

## Status por ADR

Legenda: `⬜` não iniciado · `🟨` em progresso · `✅` concluído.

| ADR | Superfície | Fase | Alvo | Status | Progresso |
|---|---|---|---|:--:|---|
| [0009](./0009-platform-p0-hardening.md) | Plataforma P0 | P0 | L3-gate | ✅ | `[##########]` 100% |
| [0010](./0010-checkout-pilot-path-hardening.md) | Checkout | P1 | L3 | ✅ | `[##########]` 100% |
| [0011](./0011-payment-hardening.md) | Payment | P1 | L3 | ✅ | `[##########]` 100% |
| [0012](./0012-embed-security-hardening.md) | Embed | P1 | L3 | ✅ | `[##########]` 100% |
| [0013](./0013-commerce-shopify-sync-hardening.md) | Commerce | P1 | L3 | ✅ | `[##########]` 100% |
| [0014](./0014-shipping-engine-hardening.md) | Shipping | P1 | L3 | ✅ | `[##########]` 100% |
| [0022](./0022-widget-transactional-path.md) | Widget transacional | P1 | L3 | ✅ | `[##########]` 100% |
| [0015](./0015-auth-and-tenant-onboarding.md) | Auth + onboarding | P2 | L3 | 🟡 | `[#####-----]` 50% |
| [0016](./0016-merchant-config-surface-hardening.md) | Merchant/agent-rules/settings | P2 | L3 | ⬜ | `[----------]` 0% |
| [0017](./0017-integrations-api-keys-webhooks.md) | Integrations | P2 | L3 | ⬜ | `[----------]` 0% |
| [0018](./0018-buyer-identity-and-history.md) | Buyer-account/history | P2 | L3 | ⬜ | `[----------]` 0% |
| [0019](./0019-negotiation-and-support.md) | Negotiation/support | P2 | L3 | ⬜ | `[----------]` 0% |
| [0023](./0023-widget-shell-identity-experience.md) | Widget shell/identidade | P2 | L3 | ⬜ | `[----------]` 0% |
| [0024](./0024-dashboard-config-preview-onboarding.md) | Dashboard config/preview/onboarding | P1–P2 | L3 | 🟡 | `[#######---]` 67% |
| [0020](./0020-growth-cross-sell-coupons-fulfillment.md) | Cross-sell/coupons/fulfillment | P3 | L3 | ⬜ | `[----------]` 0% |
| [0021](./0021-post-pilot-self-checkout-scraping.md) | Self-checkout/scraping | P4 | L2→L3 | ⬜ | `[----------]` 0% |
| [0025](./0025-packages-engines-sdk-hardening.md) | Packages/engines/SDK | transversal | L3 | ⬜ | `[----------]` 0% |

## Critérios de aceite por ADR

Marcar quando comprovado (código + teste + gate verde). Concluir o último
de cada bloco move o ADR para `✅`.

### P0 — 0009 Plataforma
- [x] 8 itens P0 acima fechados; fuzz cross-tenant gated em banco real (`AACP_RUN_PRISMA_TESTS=1`).
- [x] CI bloqueia lint/typecheck/build/testes/Prisma sem `continue-on-error`.

### P1 — Caminho transacional
**0010 Checkout**
- [x] Rotas legadas abertas (sessão/decisão/regras/`orders/complete`) fechadas (`@NonProductionRoute`).
- [x] Carrinho/frete/pagamento confiados somente server-side.
- [x] Desacoplamento por eventos concluído (sem `CheckoutPaymentAdapter`); conclusão de pedido + outbox atômicos e idempotentes por chave natural (P2002 → idempotente); E2E webhook duplicado emite `order.completed` uma única vez.

**0011 Payment**
- [x] Endpoint legado protegido; sem fallback fake em produção.
- [x] Índice de idempotência de webhook persistido; intent + outbox atômicos.
- [x] Confirmação só por estado autoritativo/webhook; reconciliação + refund + smoke sandbox.
- [x] Onboarding de pagamento do merchant (Stripe Connect/Asaas sub-conta) e assinatura de billing persistidos e tenant-scoped; segredos cifrados em repouso (`AACP_PAYMENT_ENC_KEY`); intents/webhooks roteados pela conexão da plataforma; endpoints `/payments/connections` e `/billing` human-only no OpenAPI.

**0012 Embed**
- [x] `allowedOrigin`/`scopes`/`cartRef` aplicados; nonce/replay; CORS/CSP.
- [x] Modo sem token removido do piloto.

**0013 Commerce**
- [x] Índice de pedido pendente + deduplicação persistidos; credenciais por tenant.
- [x] Retry/reconciliação + smoke Shopify.

**0014 Shipping**
- [x] Embed/tenant confiável exigido; regra comercial não vem do browser.
- [x] Quote/seleção/expiração persistidos; smoke de carrier.

**0022 Widget transacional**
- [x] Carrinho com mutação server-side (`PATCH /cart` + `POST /embed/cart`, preço autoritativo no servidor; widget sincroniza experiência da resposta; frete obsoleto limpo na mudança).
- [x] `CardForm` substituído por tokenização provider-side (Stripe Elements, sem PAN/CVV ao backend); confirmação por webhook (não otimista).
- [x] PIX com estado pendente/expiração/polling; confirmação não otimista (poll do status autoritativo).
- [x] Frete confirmado na API (seleção persistida na sessão via chat→`evaluate-shipping`; pagamento usa `session.shipping`); confirmação usa `order_id`/recibo/status reais do status autoritativo.

### P2 — Identidade e operação
**0015 Auth + onboarding**
- [ ] Secret default fora de dev removido; refresh rotativo/revogável; rate limit.
- [x] Fluxo de onboarding self-serve (merchant → checkout → embed → publicar) — orquestração de backend retomável e idempotente (estado Prisma `merchant_onboarding_states`, eventos `merchant.onboarding.step.completed`/`.completed` via outbox).

**0016 Merchant/agent-rules/checkout-settings**
- [ ] Fonte única de config; rotas paralelas abertas eliminadas; auditoria + authz por papel.

**0017 Integrations**
- [ ] Claim/lock de delivery; proteção SSRF; criptografia/rotação de segredos; alertas retry/DLQ.

**0018 Buyer-account + history**
- [ ] Prova one-time no login; OTP CSPRNG + provider real; criptografia CPF/endereço; refresh/revogação.
- [ ] Identidade persistida (sem memória); escrita idempotente; retenção PII.

**0019 Negotiation + support**
- [ ] Auth buyer/M2M correta; sem chamada direta ao checkout; Prisma padrão.
- [ ] Chat público vinculado a embed/sessão; antispam; redaction PII; SLA.

**0023 Widget shell/identidade**
- [ ] Token obrigatório + claims validadas; Shadow DOM/isolamento; CSP.
- [ ] Bearer fora do `localStorage`; expiração/refresh/revogação; E2E sessão vencida.

**0024 Dashboard (config/preview/onboarding)**
- [ ] Painel de configuração do checkout coeso (P1–P2).
- [x] **Live preview do checkout real** no dashboard — aba Preview renderiza o custom element `aacp-checkout-agent` real em iframe sandbox, servido por `GET /widget/aacp.js` (API), com token de embed de preview tenant-scoped (origin + expiração, scopes read-only); reflete tema/agente/copy salvos sem afetar produção.
- [x] UX de onboarding self-serve guiada — wizard retomável no dashboard consumindo `/onboarding` (auto-roteia ao logar quando incompleto; passos conta → checkout → embed → publicar).

### P3 — Growth e logística
**0020 Cross-sell + coupons + fulfillment**
- [ ] Controllers merchant protegidos; promoções/sugestões e cupons persistidos.
- [ ] Limite atômico por buyer; idempotência concorrente; resgate no fechamento.
- [ ] Fulfillment com shipment persistido; webhook assinado; máquina de estado + E2E.

### P4 — Pós-piloto
**0021 Self-checkout + scraping-agent**
- [ ] Auth unificada com buyer-account; wallet/templates persistidos; tokenizer real.
- [ ] Scraping com fila/worker, fontes permitidas, timeout/circuit breaker, compra auditável.

### Transversal
**0025 Packages/engines/SDK**
- [ ] Engines mantêm invariantes (margem/desconto/frete) com teste de invariante.
- [ ] SDK cobre cupom/cross-sell; schemas runtime como fonte única; contract tests.

## Gate de início do piloto

```txt
Gate  [#---------]  1/8   BLOQUEADO
```

- [x] P0 concluído (ADR 0009).
- [x] Todo o caminho P1 em `L3` (0010, 0011, 0012, 0013, 0014, 0022).
- [ ] Nenhuma rota externa sem auth deliberada/documentada.
- [ ] Nenhum estado crítico de compra só em memória.
- [ ] Migration/restart/retry aprovados em banco real.
- [ ] CI bloqueia lint/typecheck/build/testes/Prisma.
- [ ] E2E: happy, cross-tenant negado, token/origin inválidos, retry idempotente, provider indisponível, webhook duplicado.
- [ ] Widget: matriz desktop/mobile, axe, contrato, performance e smokes reais.

## Consequências

**Positivas:**
- Resposta objetiva a "quanto falta para o piloto" numa só página.
- Rastreabilidade de cada tarefa ao seu ADR e à DoD do ADR 0007.

**Negativas / riscos:**
- Exige disciplina de atualização por PR; se não atualizado, diverge das
  planilhas de maturidade. Mitigação: atualizar tracker é critério de
  merge para PRs que fecham tarefa de ADR.
