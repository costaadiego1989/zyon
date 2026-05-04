# AI Checkout Sales Agent MVP

Monorepo TypeScript for an end-to-end MVP: NestJS API, React widget, React merchant dashboard, deterministic offer engines, Shopify adapter, and OpenAI Responses API orchestration.

## Apps

- `apps/api`: NestJS API for checkout sessions, events, decisions, chat, offers, Shopify, and dashboard data.
- `apps/widget`: embeddable React/Web Component checkout agent.
- `apps/dashboard`: merchant dashboard for rules and conversion analytics.

## Packages

- `@aacp/shared-types`: API contracts and domain types.
- `@aacp/rules-engine`: deterministic commercial rule evaluation.
- `@aacp/shipping-engine`: shipping offer evaluator.
- `@aacp/decision-engine`: abandonment and intervention logic.
- `@aacp/conversation-engine`: LLM prompt/orchestration with safe fallback.
- `@aacp/commerce-adapters`: Shopify discount-code adapter.

## Run

```bash
pnpm install
cp .env.example .env
pnpm dev:api
pnpm dev:widget
pnpm dev:dashboard
```

The API uses an in-memory repository for the MVP so the full flow runs immediately. PostgreSQL is the intended persistence target for the next hardening pass.
