# @zyon/api — AI Checkout Sales Agent API

NestJS backend powering the Zyon Agentic Checkout system.

## Quick Start

```bash
# Prerequisites: Node 20+, pnpm 9+, Docker (for Postgres)
cd apps/api
cp .env.example .env       # Edit DATABASE_URL + secrets
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:dev    # Run migrations
pnpm dev                   # nest start --watch → http://localhost:3009
```

## Scripts

| Script | What |
|--------|------|
| `pnpm dev` | Start in watch mode |
| `pnpm build` | Full build (contracts → shared-types → prisma → nest) |
| `pnpm start` | Run compiled `dist/main.js` |
| `pnpm typecheck` | TypeScript noEmit check |
| `pnpm test` | Unit + integration tests |
| `pnpm test:prisma` | Prisma-backed integration tests |
| `pnpm ci` | typecheck + lint + test (CI gate) |
| `pnpm prisma:generate` | Generate Prisma client |
| `pnpm prisma:migrate:dev` | Create migration |
| `pnpm prisma:deploy` | Apply migrations (production) |

## Architecture

Clean Architecture + Modular DDD. Each module:

```
src/modules/[context]/
  domain/        # Pure entities, value objects, ports
  application/   # Use-cases (orchestration)
  infrastructure/# Adapters (Prisma repos, external APIs)
  presentation/  # HTTP controllers, DTOs
  [context].module.ts
```

Dependency direction: `presentation → application → domain ← infrastructure`

## Key Modules

- **checkout** — sessions, AI conversation, cart, offers, scoring
- **payment** — Stripe, Asaas (PIX/Boleto), crypto (EVM)
- **auth** — JWT, cookie auth, merchant registration
- **embed** — storefront embed sessions (widget ↔ API)
- **shipping** — carrier quotes (Melhor Envio), label generation
- **negotiation** — M2M negotiation engine
- **commerce** — WooCommerce/Shopify/Nuvemshop sync
- **integrations** — API keys, webhooks, tracking

## Environment

See `.env.example` for full variable reference. Critical for production:

- `DATABASE_URL` — PostgreSQL connection
- `REDIS_URL` — Rate limiting + job queues
- `JWT_SECRET` / `BUYER_JWT_SECRET` — Auth tokens
- `EMBED_TOKEN_SECRET` — Widget embed sessions
- `STRIPE_SECRET_KEY` — Payment processing
- `ASAAS_API_KEY` — PIX/Boleto payments

## Docker

```bash
# Build from monorepo root:
docker build -f apps/api/Dockerfile -t zyon-api .

# Run:
docker run -p 3009:3009 --env-file apps/api/.env zyon-api
```

Includes HEALTHCHECK on `/ready` endpoint.

## API Documentation

OpenAPI/Swagger available at `/docs` (dev/staging only, hidden in production).

## Health Endpoints

- `GET /health` — liveness (always 200)
- `GET /ready` — readiness (checks DB + Redis)
- `GET /metrics` — Prometheus metrics (protected by OPS_SHARED_SECRET)
