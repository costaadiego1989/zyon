# Relatório Completo — Estado Atual da Plataforma ATHOM

**Data:** 2026-08-18  
**Scope:** API (todos módulos) + Storefront Dashboard + Payments + AI Agents  
**Objetivo:** Mapear o que temos, o que falta, e priorizar próximos passos para PME

---

## Executive Summary

| Área | Maturidade | Gaps Críticos |
|---|---|---|
| **Checkout** | 🟢 Sólido (126 arquivos, 17 use-cases) | Observabilidade, rate limiting AI |
| **Payments** | 🟢 Sólido (80 arquivos, retry+DLQ ✓) | Falta Mercado Pago, reconciliation scheduler |
| **Commerce Adapters** | 🟢 Bom (6 providers) | Health-check de conexões |
| **Auth** | 🟡 Funcional | Token rotation, MFA |
| **Catalog** | 🟡 Funcional (14 use-cases) | Paginação, validação de imagem |
| **Buyer Account** | 🟢 Robusto (23 use-cases, WebAuthn) | Rate limit OTP runtime |
| **Fulfillment** | 🟡 Básico (3 use-cases) | Sem list/status endpoints |
| **Storefront** | 🟡 Funcional | **Zero testes**, rate limit AI |
| **Notifications** | 🔴 Fraco (15 arquivos) | **Zero testes**, sem retry, sem SMS |
| **Dashboard/Analytics** | 🟡 Base existe | Product analytics, traffic source, offer ROI |
| **AI Agents** | 🟢 Safe + Production-ready | **Não adaptativo** — sem feedback loop |

---

## 1. PAYMENTS — O que Temos vs O que Falta

### ✅ Temos (Confirmado)

| Feature | Status | Detalhes |
|---|---|---|
| Asaas (Pix, boleto, cartão BR) | ✅ Produção | Adapter completo, webhook handler |
| Stripe (cartão global) | ✅ Produção | 3D Secure handling, webhook signature |
| EVM Crypto (ETH/ERC-20) | ✅ Produção | On-chain verification |
| Routing automático | ✅ | crypto→EVM, card→Stripe, fallback→Asaas |
| **Retry + Dead-Letter** | ✅ Robusto | OutboxDispatcher: 5 tentativas, backoff exponencial (1s→60s), DLQ |
| Webhook dedup | ✅ | `providerEventId` idempotency |
| Sandbox/Test mode | ✅ | Asaas sandbox + Stripe test keys + FakeProvider |
| Multi-tenant | ✅ | Cada merchant conecta própria account |
| State machine | ✅ | Payment status transitions validadas |

### ❌ Falta

| Feature | Impacto | Esforço |
|---|---|---|
| **Mercado Pago** | 🔴 Alto (PME BR conhece MP) | 3-4 dias |
| Reconciliation scheduler | 🟠 Médio (intents perdidos) | 1 dia (cron wiring) |
| Partial refunds endpoint | 🟡 Baixo (existe handler, falta API) | 1 dia |
| Circuit breaker (Asaas/Stripe) | 🟠 Médio (cascading failure) | 2 dias |
| Multi-currency real | 🟡 Baixo (só BR por agora) | Futuro |

### Mercado Pago — Plano de Integração

```
Criar:
  infrastructure/mercadopago-payment.adapter.ts   (impl PaymentProviderPort)
  infrastructure/mercadopago-env.ts               (config)
  application/handle-mercadopago-webhook.use-case.ts
  presentation/http/mercadopago-webhook.controller.ts

Alterar:
  routing-payment.adapter.ts  → add MP routing
  payment.module.ts           → registrar providers
  
Complexidade: Média (~3-4 dias)
SDK: mercadopago (npm), API similar a Asaas
Webhook: HMAC-SHA256 (similar Stripe)
```

---

## 2. DASHBOARD & ANALYTICS — O que Temos vs O que Falta

### ✅ Temos

| Feature | Onde |
|---|---|
| Funil de checkout (6+ etapas) | `get-storefront-funnel.use-case.ts` |
| Drop-off tracking por etapa | FunnelPage frontend |
| Revenue, orders, AOV | OverviewPage |
| Período comparativo (week/month) | OverviewPage |
| Device breakdown (mobile/desktop) | FunnelPage |
| Buyer type breakdown | FunnelPage |
| Live sessions view | FunnelPage |
| StoreMetricDaily model | Prisma schema |
| StoreProductMetric model | Prisma schema |

### ❌ Falta

| Métrica | Impacto | Complexidade |
|---|---|---|
| **Product analytics** (top produtos por conversão) | 🔴 Alto — merchant quer saber "o que vende" | Médio (model existe, falta query) |
| **Cart abandonment detail** (etapa exata) | 🔴 Alto — "onde perco venda?" | Baixo (dados existem, falta view) |
| **Traffic source** (orgânico/pago/referral) | 🟠 Médio — "de onde vêm clientes?" | Médio (precisa UTM tracking) |
| **Repeat customers** (new vs returning) | 🟠 Médio — LTV | Baixo (buyer_id + histórico) |
| **Payment failure rate** | 🟠 Médio — "gateway tá OK?" | Baixo (PaymentIntent status) |
| **Offer ROI** (aceitos/vistos) | 🟠 Médio — "agente funciona?" | Baixo (AuthorizedOffer + AcceptedOffer) |
| **Anomaly alerts** (queda súbita) | 🟡 Futuro | Médio |

### Quick Wins (dados já existem, falta expor):

1. **Product analytics** → query `StoreProductMetric` agrupado por produto
2. **Cart abandonment** → `CheckoutSession` created vs completed por step
3. **Payment failure rate** → `PaymentIntent` status = failed / total
4. **Offer ROI** → `AuthorizedOffer` count vs `AcceptedOffer` count

---

## 3. AI AGENTS — O que Temos vs O que Falta

### ✅ Temos (Production-Ready)

| Layer | O que faz | Status |
|---|---|---|
| **Conversation Engine** | LangGraph state machine, LLM + tools + safety | ✅ Sólido |
| **Rules Engine** | Gatekeeper de desconto (margin floor, max cap) | ✅ Sólido |
| **Decision Engine** | Scoring weighted 0..1 (thresholds 0.55/0.70) | ✅ Funcional |
| **Negotiation Engine** | Policy lookup (item/category/global scope) | ✅ Funcional |
| **Safety Model** | Multi-gate: regex classifier + SafetyValidator + fallback template | ✅ Robusto |

### Agent Tools (5 fixas):

| Tool | O que faz |
|---|---|
| `search_catalog` | Busca produtos por query |
| `check_shipping` | Calcula frete por CEP |
| `check_inventory` | Disponibilidade de estoque |
| `get_buyer_history` | Histórico de compras do buyer |
| `apply_discount` | Aplica desconto (validado por rules-engine) |

### Persona (3 camadas):

```
1. Default → Hardcoded PT-BR fallback
2. Identity → Merchant config (nome, tom, idioma, greeting)  
3. Config Doc → Markdown injetado como system message (identity + FAQ + guardrails + badges)
```

### ❌ Gaps para "Agentes Mais Smart"

| Gap | Impacto | O que resolve |
|---|---|---|
| **Sem feedback loop** | 🔴 Crítico — agente não aprende | Track: oferta → aceite → compra = sucesso |
| **Scoring estático** | 🟠 Alto — mesmos pesos pra todos | Pesos adaptativos por merchant/buyer segment |
| **Sem A/B de prompts** | 🟠 Alto — não sabe qual prompt converte | Framework de variants + metrics |
| **Sem elasticidade de desconto** | 🟠 Médio — sempre mesmo % | Learn: "10% funciona melhor que 5% pra este segment" |
| **Objection classification naive** | 🟠 Médio — regex only | Upgrade pra embedding similarity |
| **Sem tool ranking** | 🟡 Médio — oferece 5 tools sempre | Rank por contexto (buyer com histórico → prioriza history) |
| **Sem confidence scoring** | 🟡 Médio — LLM output = fact | Add uncertainty signal |
| **Purchase history isolada** | 🟡 Médio — tool existe mas não influencia offer | Integrar history → offer strategy |
| **Escalation sem feedback** | 🟡 Baixo — resoluções humanas perdidas | Capture human resolution → train |
| **Sem ROI por turno** | 🟡 Baixo — budget tracked, ROI não | Custo LLM vs revenue gerado |

### Roadmap Agents (por impacto):

```
Fase 1 (2 semanas):
  → Feedback loop: track oferta → aceite → compra
  → Offer ROI dashboard (aceitação rate)
  → Purchase history influenciando offer strategy

Fase 2 (4 semanas):
  → A/B testing framework para prompts
  → Scoring adaptativo por merchant
  → Objection classification via embeddings (upgrade de regex)

Fase 3 (6+ semanas):
  → Elasticidade de desconto aprendida
  → Tool ranking contextual
  → Confidence scoring
```

---

## 4. MÓDULOS API — Visão Completa

### Por Módulo

| Módulo | Arquivos | Controllers | Use-Cases | Testes | Nota |
|---|---|---|---|---|---|
| checkout | 126 | 1 | 17 | 12 | Core sólido, falta observabilidade |
| payment | 80 | 5 | 10 | 22 | Mais testado, retry robusto |
| buyer-account | 72 | 5 | 23 | 13 | Feature-rich (WebAuthn, GDPR) |
| commerce | 54 | 6 | 10 | 10 | 6 providers, boa cobertura |
| catalog | 45 | 2 | 14 | 6 | Funcional, falta paginação |
| auth | 36 | 1 | 8 | 6 | Funcional, falta MFA |
| storefront | 29 | 1 | 8 | **0** | ⚠️ Zero testes com AI |
| fulfillment | 25 | 1 | 3 | 9 | Básico mas bem testado |
| embed | 20 | 2 | 2 | 7 | Seguro, boa cobertura |
| notifications | 15 | 0 | 4 | **0** | ⚠️ Zero testes |

### Gaps Transversais (afetam todos)

| Gap | Risco | Solução |
|---|---|---|
| **Zero observabilidade** (sem métricas, sem tracing) | 🔴 Cego em prod | OpenTelemetry + structured logging |
| **Sem circuit breaker** em integrações externas | 🔴 Cascading failure | Pattern: retry → circuit open → fallback |
| **Zero testes em storefront + notifications** | 🟠 Regressão silenciosa | Cobertura mínima (happy path) |
| **Sem rate limiting em endpoints AI** | 🟠 Custo descontrolado | Token budget per merchant (já existe budget-tracker, falta enforcement) |
| **Auth sem token rotation** | 🟡 Segurança | Refresh token rotation + blacklist |

---

## 5. White-Label — Status

### ✅ Checkout Embed
- Merchant configura: cores, logo, fontes, border-radius, dark mode
- Widget respeita theme do merchant

### ⚠️ Verificar
- [ ] Free tier mostra badge "Powered by ATHOM"?
- [ ] Storefront respeita white-label?
- [ ] Planos pagos removem badge?

---

## 6. PRIORIDADES RECOMENDADAS

### 🔴 AGORA (Semanas 1-2)

| # | Item | Por quê | Esforço |
|---|---|---|---|
| 1 | **Mercado Pago** | PME BR paga com MP. Bloqueio de adoção. | 3-4 dias |
| 2 | **Dashboard: product analytics + offer ROI** | Merchant quer ver "agente funciona?" | 2-3 dias |
| 3 | **Feedback loop no agente** | Sem isso, agente nunca melhora. Diferencial morto. | 3-5 dias |

### 🟠 PRÓXIMO (Semanas 3-4)

| # | Item | Por quê | Esforço |
|---|---|---|---|
| 4 | **Testes em storefront** | Zero testes = deploy = medo | 2-3 dias |
| 5 | **Cart abandonment detail** | "Onde perco venda?" = retention | 1-2 dias |
| 6 | **Reconciliation scheduler** | Intents perdidos = dinheiro perdido | 1 dia |
| 7 | **Docs de integração (embed)** | DevX = adoption | 2-3 dias |

### 🟡 DEPOIS (Mês 2)

| # | Item | Por quê | Esforço |
|---|---|---|---|
| 8 | A/B testing de prompts | Qual prompt converte mais? | 1 semana |
| 9 | OpenTelemetry (observabilidade) | Visibilidade em prod | 1 semana |
| 10 | Circuit breaker em integrações | Resilience | 2-3 dias |
| 11 | Rate limiting AI (enforcement) | Custo controlado | 2 dias |
| 12 | Auth: token rotation + MFA | Segurança | 3-4 dias |

---

## 7. O QUE NÃO FAZER AGORA

| Feature | Por quê skip |
|---|---|
| OMS/Multi-warehouse | PME tem 1 CD |
| Marketplace (sellers) | Não é seu modelo |
| B2B (approval flows) | Nicho demais pra MVP |
| Multi-currency | Só BR agora |
| Advanced search (Algolia) | LLM já filtra (tool search_catalog) |
| CMS headless | PME não precisa |
| Subscriptions | Importante mas depois dos 3 urgentes |

---

## 8. RESUMO FINAL

### Vocês têm produto REAL

```
✅ 35 módulos
✅ 269 use-cases
✅ 84 models
✅ 60 controllers
✅ 6 commerce adapters (Shopify, Magento, VTEX, Nuvemshop, Tray, WooCommerce)
✅ 3 payment providers (Asaas, Stripe, Crypto)
✅ AI agent com 5 tools + safety gates
✅ Retry + Dead-Letter (OutboxDispatcher)
✅ Multi-tenant
✅ Clean Architecture + DDD
✅ Dashboard com funil
✅ WebAuthn + GDPR compliance
```

### 3 coisas que mudam o jogo AGORA

```
1. Mercado Pago → desbloqueia 40% do mercado PME BR
2. Dashboard metrics (product + offer ROI) → prova valor pro merchant
3. Feedback loop no agente → agente aprende e converte mais
```

Tudo resto é polish. Esses 3 movem revenue.

