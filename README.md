# Zyon — AI-First Headless Commerce Platform

Monorepo TypeScript para uma plataforma de e-commerce headless AI-first com checkout agêntico, storefront conversacional, e APIs RESTful.

## Produtos

| Produto | Plano | Descrição |
|---------|-------|-----------|
| **API Commerce** | `API` | API headless AI-first. Checkout agêntico, catálogo, pedidos, pagamentos, analytics. Para devs que querem construir frontend próprio. |
| **Storefront Completo** | `STORE_ONLY` | Loja completa: storefront conversacional + dashboard + API. Merchant não precisa de site externo. |
| **Checkout Widget** | `CHECKOUT_ONLY` | Widget de checkout embed para sites existentes (Shopify, WooCommerce, custom). IA negocia e converte no site do merchant. |
| **Plataforma Completa** | `BOTH` | Storefront + Checkout Widget. Merchant tem loja própria E pode embedar checkout em outros canais. |

## Apps

- `apps/api` — NestJS API headless: checkout sessions, catálogo, pedidos, pagamentos, analytics, cross-sell, negotiation, M2M protocol.
- `apps/widget` — Web Component React embeddable: checkout agêntico com IA que negocia, sugere cross-sell, recupera carrinho.
- `apps/dashboard` — Dashboard React para merchants: analytics, configuração de agente, regras, funil, kanban de pedidos.
- `apps/storefront` — Storefront servido pela API: loja conversacional com agente LangGraph (busca, carrinho, checkout completo via chat).

## Packages

- `@zyon/shared-types` — Contracts e domain types compartilhados.
- `@zyon/rules-engine` — Avaliação determinística de regras comerciais (desconto, margem, frete).
- `@zyon/shipping-engine` — Cálculo de frete e subsídio.
- `@zyon/decision-engine` — Lógica de abandono e intervenção.
- `@zyon/conversation-engine` — Orquestração LLM com safety validator e fallback determinístico.
- `@zyon/negotiation-engine` — Protocolo M2M de negociação entre agentes.
- `@zyon/commerce-adapters` — Adapters para Shopify, WooCommerce, Nuvemshop, VTEX, Tray.

## Run

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cd apps/api && pnpm dev          # API na porta 3009
cd apps/dashboard && pnpm dev    # Dashboard na porta 5175
cd apps/widget && pnpm dev       # Widget dev na porta 5173
```

PostgreSQL via Prisma. Suba o banco (`docker compose up -d postgres`) e rode as migrations (`cd apps/api && pnpm prisma:deploy`) antes.

## AI Provider

O agente conversacional usa LLM via `@zyon/conversation-engine`. Configure em `apps/api/.env`:

- `DEEPSEEK_API_KEY` (preferido) — `deepseek-chat` em `https://api.deepseek.com/v1`
- `OPENAI_API_KEY` — fallback via OpenAI Responses API

Sem key, cai em reply determinístico (funciona pra smoke tests, não produção).

## Architecture

```
apps/
  api/          → NestJS headless API (Clean Architecture + Modular DDD)
  widget/       → React Web Component (embed checkout)
  dashboard/    → React SPA (merchant panel)
  storefront/   → Served by API (conversational store)

packages/
  shared-types/         → Interfaces e tipos
  rules-engine/         → Regras de desconto/margem
  shipping-engine/      → Cálculo de frete
  decision-engine/      → Abandono/intervenção
  conversation-engine/  → LLM orchestration + safety
  negotiation-engine/   → M2M protocol
  commerce-adapters/    → Shopify/Woo/VTEX/Nuvemshop/Tray
```

## Safety & Security

- LLM nunca autoriza ofertas — `rules-engine` é authority
- `isSafeGeneratedMessage()` valida TODA resposta IA antes de exibir
- Mensagens inseguras caem em template determinístico
- IA não pode prometer desconto, frete grátis, estoque, ou pedir CVV/senha
- Tenant isolation via `merchant_id` em toda query
- Auth via JWT cookie + refresh silencioso

## Headless API (para produto API Commerce)

REST L2 com 110+ endpoints. Qualquer frontend pode consumir:
- Checkout: sessions, events, decisions, chat, offers
- Catálogo: products, categories, variants, search
- Pedidos: CRUD, status transitions, tracking, labels
- Pagamentos: PIX, credit card, boleto, crypto (Asaas)
- Analytics: funnel, timeseries, overview, experiments
- Cross-sell: suggestions, promotions, accept/decline
- Domains: custom domain registration + SSL automático
- M2M: machine-to-machine negotiation protocol
