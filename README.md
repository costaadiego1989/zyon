# AACP — Plataforma de E-commerce para PMEs

AACP é uma plataforma SaaS completa de e-commerce pensada para pequenas e médias empresas. PMEs criam sua própria loja virtual, vendem direto ao consumidor ou integram em um marketplace compartilhado com outras marcas. Toda negociação de preço e frete é intermediada por um agente de IA que atua dentro de regras determinísticas aprovadas pelo merchant.

## Core Value Proposition

- **Loja visual autônoma** — Storefront próprio da PME, sem dependência de terceiros (Shopify, VTEX, etc.)
- **Negociação conversacional com IA** — Agente conversa com o comprador, identifica objeções e negocia desconto/frete dentro dos limites de margem do merchant
- **Marketplace integrado** — PMEs podem vender em marketplace de outras marcas e receber comissão via settlement organizado
- **Buyer Hub** — Comprador acessa histórico de pedidos, rastreia, salva endereços, conversa com IA
- **Pagamentos multi-forma** — PIX, boleto (Asaas), cartão (Stripe), cripto
- **Dashboard completo** — Visão de pedidos, integrações (Shopify/VTEX opcional), clientes, promoções, faturamento

## Stack & Arquitetura

```
apps/
  api/              — NestJS + Prisma + PostgreSQL (Clean Architecture + DDD modular)
  widget/           — React/Vite (storefront + buyer hub + conversas IA)
  dashboard/        — React (console merchant)
  fake-commerce-api — Mock para dev/E2E

packages/
  shared-types/            — Contratos TypeScript
  rules-engine/            — Desconto/frete determinístico
  decision-engine/         — Próximos passos da conversa
  conversation-engine/     — LLM wrapper + segurança
  shipping-engine/         — Subsídio e cotação logística
  commerce-adapters/       — Shopify, Magento, VTEX, WooCommerce
  agentic-checkout-js/     — SDK público pra checkout programático
```

## Tenancy & Segurança

- **Merchant** é a fronteira de isolamento (tenant)
- Todo query/comando escopo por `merchant_id` from JWT principal
- **Buyer global ID** permite personalização cruzada de histórico
- **IA nunca autoriza ofertas** — só propõe. `rules-engine` aprova desconto (com cap de margem). `shipping-engine` aprova subsídio frete
- Toda saída LLM passa por `isSafeGeneratedMessage()` (regex + safety battery) — bloqueia promessas proibidas (frete grátis sem autorização, CVV, etc.)
- **Idempotência HTTP** em todas escrita; `merchant_id` criptografado em webhook

## Modelo de Receita

Por pedido:

| Quem paga | Valor | Coletado em |
|-----------|-------|-----------|
| **Buyer** | R$0,99 | Fatura (todo pedido) |
| **Merchant (Starter)** | R$1,99 | Settlement (sai do repasse) |
| **Merchant (Growth)** | R$1,49 | Settlement (sai do repasse) + R$249/mês |
| **Merchant (Scale)** | R$0,99 | Settlement (sai do repasse) + R$599/mês |

## Contextos & Módulos

**Checkout & IA:**
- `checkout` — Sessão, eventos, scoring, chat, ofertas, read model
- `agent-rules` — Identidade do agente, capabilities, guardrails
- `conversation-engine` — Classifica objeções, escreve copy segura

**PME:**
- `merchant` — Regras, configurações, tema
- `buyer-purchase-history` — Personalização por compra anterior
- `checkout-settings` — Comportamento do widget

**Pagamento & Logística:**
- `payment` — Intents (Asaas/Stripe/Crypto), webhooks
- `shipping` — Melhor Envio, cotação real, entrega própria
- `billing` — Planos Asaas, assinatura recorrente

**Marketplace & Vendas:**
- `marketplace-discovery` — Discovery de lojas
- `marketplace-settlement` — Timeline de repasse com chargeback window
- `inventory` — Multi-warehouse, OMS
- `erp-crm` — Integração com ERPs/CRMs de vendedor

**Experiência:**
- `storefront` — Loja visual com Stories (Instagram-style)
- `buyer-hub` — Dashboard cliente (pedidos, endereços, pagamentos)
- `negotiation` — M2M sessões com ledger de custo
- `post-sale` — Entrega, reviews, NPS, win-back, lealdade

## Invariantes Críticos

1. **Desconto**: `rules-engine` é autoridade única. Hard cap em % + reais. Margem nunca abaixo de mínimo.
2. **Frete**: `shipping-engine` aprova subsídio. Sem "frete grátis" não autorizado.
3. **IA**: Nunca autoriza oferta. Só propõe. Toda output passa `isSafeGeneratedMessage()`.
4. **Tenant**: `merchant_id` em toda query. Sem cross-tenant leak.
5. **LGPD**: Audit log, export de dados, delete conta.
6. **Ofertas determinísticas**: Sem LLM decide sem passar pelo rules-engine.
7. **Holdout**: 5% dos buyers (SHA256 hash) nunca recebem regra experimental (validação científica).

## Setup Local

```bash
# Instalar deps
pnpm install

# Env (copiar template, preencher credentials)
cp apps/api/.env.example apps/api/.env

# Dev — todas as apps simultaneamente
cd apps/api && pnpm dev         # http://localhost:3000
cd apps/widget && pnpm dev      # http://localhost:5173
cd apps/dashboard && pnpm dev   # http://localhost:5174

# Typecheck
cd apps/api && pnpm typecheck
cd apps/widget && pnpm typecheck

# Build
cd apps/api && pnpm build
cd apps/widget && pnpm build

# Testes
cd apps/api && pnpm test
cd apps/api && pnpm test:prisma
cd apps/widget && pnpm test
cd apps/widget && pnpm test:coverage   # vitest + c8, threshold 70%
cd apps/widget && pnpm e2e             # Playwright mocked
cd apps/widget && pnpm e2e:realapi     # Playwright real API

# DB
cd apps/api && pnpm prisma:generate    # Gera cliente
cd apps/api && pnpm prisma:migrate:dev # Migra local
cd apps/api && pnpm prisma:deploy      # Migra prod
```

## Estrutura de Especificações

Todas features pré-implementação vivem em `.specs/`:

```
.specs/features/[feature]/
  spec.md      — Requirements, contracts, acceptance criteria
  design.md    — Arquitetura da solução (quando aplica)
  tasks.md     — Tasks atômicas com verificação
```

Referência:

```
.specs/codebase/
  STACK.md         — Frontend/backend/database, versões
  ARCHITECTURE.md  — Clean Architecture + DDD no código
  STRUCTURE.md     — Organização de pastas
  TESTING.md       — TDD patterns, cobertura, E2E
  INTEGRATIONS.md  — Shopify, VTEX, Melhor Envio, etc.
  CONCERNS.md      — Decisões técnicas abertas
```

## Convenções de Código

**Git Commits:**
```
type(scope): short description

type: feat|fix|refactor|test|chore|docs|style|perf|ci
scope: módulo/app — checkout, payment, widget, auth, etc.
message: Imperative, ≤72 chars, English
```

**Exemplo:**
```
feat(checkout): add scoped mission budget validation
fix(payment): enforce merchant boundary on webhook lookup
refactor(auth): extract buyer session guard to hook
```

**API Patterns:**
- DTOs sempre separados do domain
- Responses envolvidas em `{ data, meta, pagination?, _links? }`
- Cursor pagination por padrão (offset opt-in)
- Resource-based REST L2 (não HATEOAS)
- OpenAPI decorators para SDK generation

**Testes:**
- TDD: red → green → refactor
- Cobertura mínima 70% (widget + dashboard)
- E2E em Playwright contra API real (in-memory Prisma)
- Unit + integration + E2E (não skip E2E)

## Produção

**Antes de deploy:**
1. `pnpm typecheck` passa
2. `pnpm test` passes 100%
3. `pnpm build` succeeds
4. Audit log registra mudanças (LGPD)
5. Merchant não vê dados cruzados

**Monitoramento:**
- HTTP error rate (5xx)
- Funnel: sessions → conversations → offers_accepted → orders
- Settlement pipeline: pending → transfer_scheduled → transferred → finalized
- IA safety: unsafe_messages_blocked, fallback_count

## Links & Recursos

- **Stack Docs**: `.specs/codebase/STACK.md`
- **ADRs**: `.specs/features/*/spec.md` (decisões arquitetônicas)
- **Referência API**: Será gerada via OpenAPI (em progresso, REQ-001 audit)
- **Roadmap Produto**: 120+ specs documentadas em `.specs/features/`

## Suporte

- Questões codebase → CLAUDE.md (instrções operacionais)
- Questões de feature → spec.md na pasta `/features/`
- Questões de decisão → ADRs (`create-adr` skill)

---

**AACP v0.1 — Built by Diego & Crew**. Última atualização: Setembro 2026.
