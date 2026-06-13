# Architecture Decision Records (ADR)

Registro de decisões arquiteturais da AACP.

Status permitidos: `proposed` | `accepted` | `deprecated` | `superseded`.

| ADR | Título | Status |
|---|---|---|
| [0001](./0001-modular-monolith-bounded-contexts.md) | Modular Monolith com Bounded Contexts | accepted |
| [0002](./0002-acl-pattern-cross-context.md) | Padrão ACL e Adapters por contexto | accepted |
| [0003](./0003-event-bus-and-transactional-outbox.md) | Event Bus em-process + Transactional Outbox | accepted |
| [0004](./0004-prisma-isolation-per-context.md) | Prisma client em PersistenceModule global | accepted |
| [0005](./0005-multi-tenant-isolation.md) | Multi-tenant isolation com TenantContext + RLS opcional | accepted |
| [0006](./0006-whatsapp-agentic-commerce-pivot.md) | WhatsApp, descoberta de produtos e orquestração de compra | proposed |
| [0007](./0007-module-maturity-and-progressive-closure.md) | Maturidade e fechamento progressivo da API e do widget | proposed |
| [0008](./0008-production-readiness-roadmap.md) | Roadmap de prontidão para produção (umbrella) | proposed |
| [0009](./0009-platform-p0-hardening.md) | Plataforma P0: tenant, persistência, outbox, CORS, secrets, rotas legadas | proposed |
| [0010](./0010-checkout-pilot-path-hardening.md) | Checkout: caminho transacional do piloto | proposed |
| [0011](./0011-payment-hardening.md) | Payment: Asaas, idempotência e tokenização de cartão | proposed |
| [0012](./0012-embed-security-hardening.md) | Embed: sessão, token e segurança de origem | proposed |
| [0013](./0013-commerce-shopify-sync-hardening.md) | Commerce: sincronização de pedidos Shopify | proposed |
| [0014](./0014-shipping-engine-hardening.md) | Shipping: cotação, subsídio e persistência | proposed |
| [0015](./0015-auth-and-tenant-onboarding.md) | Auth e onboarding self-serve do tenant | proposed |
| [0016](./0016-merchant-config-surface-hardening.md) | Merchant, agent-rules e checkout-settings (config do tenant) | proposed |
| [0017](./0017-integrations-api-keys-webhooks.md) | Integrations: API keys e webhooks de saída | proposed |
| [0018](./0018-buyer-identity-and-history.md) | Buyer-account e buyer-purchase-history | proposed |
| [0019](./0019-negotiation-and-support.md) | Negotiation e support | proposed |
| [0020](./0020-growth-cross-sell-coupons-fulfillment.md) | Growth e logística: cross-sell, coupons, fulfillment | proposed |
| [0021](./0021-post-pilot-self-checkout-scraping.md) | Pós-piloto: self-checkout e scraping-agent | proposed |
| [0022](./0022-widget-transactional-path.md) | Widget transacional: cart, card, pix, shipping, confirmation | proposed |
| [0023](./0023-widget-shell-identity-experience.md) | Widget: shell/embed, chat, auth-hub, support, tema, a11y, SDK | proposed |
| [0024](./0024-dashboard-config-preview-onboarding.md) | Dashboard: config do checkout, live preview, onboarding e páginas | proposed |
| [0025](./0025-packages-engines-sdk-hardening.md) | Packages: engines, SDK e shared-types | proposed |
| [0026](./0026-production-readiness-tracker.md) | Tracker de prontidão para produção (source of truth) | accepted |
