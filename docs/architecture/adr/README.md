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
