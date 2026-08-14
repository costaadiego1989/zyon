# Architecture

The codebase is a TypeScript modular monolith with Clean Architecture and tactical DDD.

## Direction

`presentation -> application -> domain <- infrastructure`

## API Context Layout

Each bounded context under `apps/api/src/modules` uses:

- `domain/entities`: framework-free state and behavior.
- `domain/ports`: repository and external service contracts.
- `application/use-cases`: orchestration and transaction boundaries.
- `infrastructure`: concrete repositories and adapters.
- `presentation/http`: NestJS controllers only.

## Current Contexts

- `checkout`: AACP-owned buyer checkout session lifecycle, tracking, decisions, chat, offers, and order completion facts.
- `auth`: merchant user authentication, JWT cookie issuance, and login rate limiting.
- `merchant`: merchant profile and commercial rule configuration.
- `agent-rules`: agent identity, capabilities, guardrails, and safe agent context.
- `checkout-settings`: operational widget/intervention configuration.
- `buyer-purchase-history`: merchant-scoped buyer purchase memory and compact AI context.
- `negotiation`: deterministic machine negotiation evaluation and future negotiation sessions.
- `payment`: planned buyer payment intents, attempts, provider webhooks, and payment facts.
- `commerce`: planned cart/order/product synchronization with commerce platforms (WooCommerce, Magento, VTEX); commerce does not process buyer payments.
- `billing`: planned merchant SaaS billing, usage, quotas, and subscription state.

## Dependency Rules

- Domain cannot import NestJS, environment variables, HTTP, persistence, OpenAI, Asaas, or any provider SDK.
- Use cases depend on ports and pure packages.
- Controllers depend on use cases.
- Infrastructure implements ports.
