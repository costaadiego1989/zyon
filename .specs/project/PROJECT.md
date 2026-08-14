# AI Checkout Sales Agent

**Vision:** Turn checkout into an AI sales closer and owned payment flow that negotiates price, shipping, and payment friction while protecting merchant margin.
**For:** DTC ecommerce merchants integrating commerce platforms and payment providers through adapters.
**Solves:** Cart abandonment caused by shipping cost, price objections, trust concerns, and passive checkout experiences.

## Goals

- Increase checkout conversion by intervening only when abandonment signals are present.
- Preserve margin by making every discount and shipping subsidy deterministic, auditable, and rule-bound.
- Prove a full end-to-end AACP checkout MVP: configure rules, run widget, negotiate, charge the buyer through a payment provider, sync the order to commerce, and show analytics.

## Tech Stack

**Core:**

- Framework: NestJS API, React widget/dashboard
- Language: TypeScript
- Database: PostgreSQL target; in-memory repository for MVP development

**Key dependencies:**

- OpenAI Responses API
- Multi-platform commerce APIs (WooCommerce, Magento, VTEX) for headless checkout
- Asaas API for the first buyer payment provider and future merchant billing
- Vite
- pnpm workspaces

## Scope

**v1 includes:**

- Embeddable checkout widget.
- Merchant dashboard for rules and metrics.
- Checkout sessions with `global_user_id`.
- Event tracking and abandonment scoring.
- Deterministic discount and shipping offer decisions.
- LLM conversation that cannot authorize offers directly.
- AACP-owned buyer checkout flow with payment-provider adapters.
- Commerce adapters for WooCommerce/Magento/VTEX that enable headless checkout with payment processing.
- Asaas buyer payment adapter as the first real payment provider.

**Explicitly out of scope:**

- Fully conversational checkout replacement.
- Storing raw card numbers or CVV.
- Advanced logistics engine.
- Omnichannel recovery.
- Custom ML scoring.

## Constraints

- The buyer identity must be stable through `global_user_id`.
- Merchant isolation is mandatory; global identity cannot leak context across merchants.
- LLM output is advisory/conversational only. Rules authorize offers.
- Commerce adapters synchronize cart/order/product facts; payment adapters charge buyers.
- Payment provider secrets, commerce tokens, margin, cost, and raw customer PII must not be exposed through the browser embed.
