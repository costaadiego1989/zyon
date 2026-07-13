# Dashboard E2E Test Suite

## Architecture

Module-by-module E2E tests with real backend integration.

### Test Files

- **auth-flow.spec.ts** — Login flow
- **overview.spec.ts** — Dashboard metrics, charts, sessions
- **orders.spec.ts** — Orders, filters, export, detail expand
- **customers.spec.ts** — Customers table, search, metrics, export
- **integrations.spec.ts** — API keys, webhooks, quickstart
- **checkout-settings.spec.ts** — Checkout configuration
- **theme-embed.spec.ts** — Theme customization, embed code
- **remaining-modules.spec.ts** — Billing, Payments, Audit, Support, Rules, Negotiation, Commerce, Preview

## Running Tests

```bash
# All tests
pnpm e2e

# Specific tag
pnpm e2e -- --grep @overview-metrics

# Single file
pnpm e2e -- auth-flow.spec.ts
```

## Test Tags

Each test has a @tag for granular control:

- @auth-* — Authentication tests
- @overview-* — Overview metrics, sessions, revenue
- @orders-* — Orders, filters, export, expand
- @customers-* — Customers, search, filters, export
- @integrations-* — API keys, webhooks
- @checkout-* — Settings, configuration
- @theme-* — Theme customization
- @embed-* — Embed code
- @widget-* — Widget preview/reflection
- @api-* — API integration tests

## Selectors

All selectors use:
- Text matchers: `has-text()`, `filter({ hasText })` (inline styles = no CSS classes)
- Role matchers: `getByRole()`
- Table navigation: `tbody tr`, `th`, `td`
- Input search: `input[placeholder*='Buscar']`

## Real Backend Integration

- No API mocking
- Real database queries
- Real Prisma ORM
- Demo account: demo@zyon.com / demo1234
- Store: Zyon Demo Store

## Workflow

1. Start API: `cd apps/api && pnpm dev`
2. Start Dashboard: `cd apps/dashboard && pnpm dev`
3. Run tests: `cd apps/dashboard && pnpm e2e`
4. View results: `playwright show-report`
