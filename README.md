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

A API persiste estado em PostgreSQL via Prisma. Suba o banco (`docker compose up -d postgres`) e rode as migrations (`cd apps/api && pnpm prisma:deploy`) antes de `pnpm dev:api`.

## AI conversation provider (DeepSeek / OpenAI)

The conversational agent in the widget calls a real LLM through `@aacp/conversation-engine`. Configure one of these in `.env` (or `apps/api/.env`):

- `DEEPSEEK_API_KEY` (preferred) — uses `deepseek-chat` at `https://api.deepseek.com/v1`. Override with `DEEPSEEK_MODEL` and `DEEPSEEK_BASE_URL` if needed.
- `OPENAI_API_KEY` — fallback, uses the OpenAI Responses API.

`apps/api/src/main.ts` loads `apps/api/.env` first, then the repo-root `.env`, and logs which AI keys were detected on boot. Without a key, `SendChatMessageUseCase` falls back to a deterministic safe reply — fine for smoke tests but not for production.

To run the live AI checkout journey tests against a real LLM:

```bash
# in apps/api/.env
DEEPSEEK_API_KEY=sk-deepseek-...
RUN_REAL_AI_E2E=true

pnpm --filter @aacp/api test
```

The two live scenarios (`checkout.ai-live-e2e-spec.ts`) cover a single objection turn and a full multi-turn purchase journey (start → shipping objection → coupon ask → apply offer → complete order), and assert that the AI replies are non-deterministic and that the persisted `chatHistory` grows correctly.

## B2B theme customization

Each merchant can theme the conversational widget — accent colour, text/background colour, font, logo and agent avatar — via the dashboard:

```http
PUT /merchants/me/theme
{
  "accentColor": "#FF0066",
  "textColor": "#0F172A",
  "backgroundColor": "#F9FAFB",
  "fontFamily": "Manrope, system-ui, sans-serif",
  "logoUrl": "https://cdn.loja.com/logo.png"
}
```

The theme is returned inside `StartCheckoutResponse.experience.brand.theme` and the widget injects it as CSS custom properties (`--aacp-accent`, `--aacp-fg`, `--aacp-bg`, `--aacp-font`). See [`docs/integrations/checkout-widget-and-api.md`](docs/integrations/checkout-widget-and-api.md) for the full theme contract and validation rules.

## Premium widget surfaces

The buyer-facing widget is intentionally not a dashboard. The public surface now follows the Lovable checkout baseline: dark premium shell, mobile-first chat, icon stepper, quick replies, fixed composer and a Stripe-like cart with item removal, totals and payment CTA. Internal telemetry, rule-engine labels and conversion metrics are not rendered to the buyer.

After global login, the same widget can open an authenticated account hub with order history, account metrics, user/merchant configuration and agent configuration. See [`docs/product/premium-widget-ui-system.md`](docs/product/premium-widget-ui-system.md) and [`docs/product/agentic-checkout-differentiation.md`](docs/product/agentic-checkout-differentiation.md).

The widget implementation is split as MVVM: `main.tsx` handles the Web Component bootstrap, `useCheckoutAgentViewModel` owns state/API actions, and checkout components render the public experience. Phone login is the target UX; Google remains visually present but disabled until buyer OAuth is implemented.

## Database (PostgreSQL)

Local development uses Docker Compose (`docker-compose.yml`): Postgres 16 on host port **55432**, database `aacp_test`, user/password `postgres`/`postgres`.

```bash
pnpm db:up        # requires Docker Desktop running on Windows
pnpm db:migrate
pnpm test:prisma  # integration + Prisma e2e (needs DB)
```

### Windows: `dockerDesktopLinuxEngine` / pipe not found

That error means the **Docker engine is not running** (not a broken `postgres:16-alpine` image). Open **Docker Desktop**, wait until it says it is running, then run `docker info` — it must succeed. After that, `pnpm db:up` should pull the image and start the container.

If you do not use Docker: install PostgreSQL locally, create database `aacp_test`, set `DATABASE_URL` in `.env` and `apps/api/.env` to match, then `pnpm db:migrate`.

### Desktop says "running" but `docker ps` fails everywhere (incl. PowerShell)

Typical causes on Windows:

1. **Daemon not fully up** — quit Docker Desktop from the tray (Quit Docker Desktop), wait 10s, open it again and wait until **Engine running** (not only "Starting").
2. **WSL 2 backend** — Settings → General → confirm **Use WSL 2 backend** matches your setup; Resources → **WSL integration** → enable your distro. Run `wsl --update` then reboot if WSL was never updated.
3. **Broken named pipe** — after a crash, the pipe `dockerDesktopLinuxEngine` may be missing until a full Desktop restart or **Troubleshoot → Restart** in Docker Desktop.
4. **`docker context`** — run `docker context ls`. Active should be **`desktop-linux`** with endpoint `dockerDesktopLinuxEngine`. If you switched contexts, run `docker context use desktop-linux`.
5. **Git Bash quirks** — if `docker` is "not found" only in Git Bash: use **PowerShell** or **CMD** first, or add `C:\Program Files\Docker\Docker\resources\bin` to Bash `PATH`. For path quirks: `MSYS_NO_PATHCONV=1 docker ps` rarely fixes pipes; Connection errors are usually the engine, not MSYS.

**Sanity check:** `docker version` must show **Server** section too. If you only see **Client**, the daemon is unreachable — fix Desktop/WSL before `pnpm db:up`.

Optional **reset** (last resort): Docker Desktop → Troubleshoot → **Reset to factory defaults** (removes volumes/images).

## Observability (Grafana + Tempo + Loki + Prometheus)

Stack completa de observabilidade com tracing distribuído, logs centralizados e métricas — tudo visualizado no Grafana.

### Subindo a infra

```bash
cd infra/observability
docker compose up -d
```

Serviços disponíveis:

| Serviço | Porta | Função |
|---------|-------|--------|
| Grafana | `http://localhost:3100` | Dashboard unificado (admin/admin) |
| Prometheus | `http://localhost:9090` | Métricas (scrape da API) |
| Tempo | `http://localhost:3200` | Traces distribuídos (OTLP) |
| Loki | `http://localhost:3101` | Agregação de logs |
| Promtail | — | Coleta logs dos containers Docker |

### Conectando a API

Adicione ao `apps/api/.env`:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=zyon-api
METRICS_ENABLED=true
LOG_LEVEL=info
```

Rode a API normalmente (`pnpm dev:api`). Os dados fluem automaticamente:

- **Traces** → API envia spans via OTLP HTTP para Tempo (`:4318`)
- **Logs** → Pino JSON stdout → Docker → Promtail → Loki (com `trace_id` para correlação)
- **Metrics** → Prometheus scrape `GET /metrics` na API (`:3001`)

### Correlação Logs ↔ Traces ↔ Metrics

Cada log line inclui `trace_id` e `span_id` do OpenTelemetry. No Grafana:

1. **Loki → Tempo**: clique no link "View Trace" em qualquer log com trace_id
2. **Tempo → Loki**: na visualização de trace, veja logs correlacionados
3. **Tempo → Prometheus**: span metrics geradas automaticamente por rota e status

### Métricas de negócio disponíveis

| Métrica | Tipo | Labels |
|---------|------|--------|
| `checkout_started_total` | Counter | merchant_id |
| `order_completed_total` | Counter | merchant_id |
| `payment_approved_total` | Counter | merchant_id |
| `checkout_duration_seconds` | Histogram | merchant_id |
| `chat_response_latency_seconds` | Histogram | merchant_id, has_offer |
| `shipping_quote_latency_seconds` | Histogram | carrier |
| `commerce_sync_duration_seconds` | Histogram | provider, outcome |
| `payment_webhook_received_total` | Counter | provider, event_type |
| `outbox_pending_count` | Gauge | — |
| `outbox_dead_letter_count` | Gauge | — |
| `outbox_lag_seconds` | Histogram | — |
| `llm_latency_seconds` | Histogram | target, status |
| `active_checkout_sessions` | Gauge | merchant_id |

### Adicionando spans customizados

Para instrumentar uma operação de negócio:

```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("zyon-api");

async function myOperation() {
  return tracer.startActiveSpan("checkout.my_operation", async (span) => {
    try {
      span.setAttribute("merchant_id", merchantId);
      const result = await doWork();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

Operações que devem receber spans estão mapeadas em `infra/observability/README.md`.

### Parando a stack

```bash
cd infra/observability
docker compose down        # para serviços (mantém dados)
docker compose down -v     # para serviços e apaga volumes
```

## Public API v1 (Headless Commerce)

The API is production-ready with 23 resource modules, 110+ endpoints, rate limiting, webhooks, and a TypeScript SDK.

### Quick Start

```bash
# Start all services (API, Postgres, Redis, Prometheus, Grafana, Grafana dashboards)
docker-compose -f docker-compose.monitoring.yml up -d

# Wait for services to be ready
sleep 10

# Test API health
curl http://localhost:3009/ready

# View API documentation
open http://localhost:3009/docs  # Scalar API reference

# View Prometheus metrics
open http://localhost:9091  # or http://localhost:3009/metrics

# View Grafana dashboards
open http://localhost:3000  # admin / admin
```

See [DOCKER_COMPOSE.md](./DOCKER_COMPOSE.md) for full usage and service details.

### SDK Installation

```bash
npm install zyon-sdk
```

```typescript
import { createClient } from 'zyon-sdk';
import { getCheckouts } from 'zyon-sdk/dist/generated/checkouts/checkouts';

const client = createClient({
  apiKey: 'aacp_test_xxxxx',
  environment: 'sandbox'
});

const { checkoutsCreate } = getCheckouts();

// Create a checkout
const checkout = await checkoutsCreate({
  product_url: 'https://store.example.com/products/widget',
  product_name: 'Widget',
  product_price: 4990,
  currency: 'BRL',
  customer: { email: 'buyer@example.com' }
});
```

### API Documentation

- **Interactive Docs**: http://localhost:3009/docs (Scalar)
- **OpenAPI Spec**: http://localhost:3009/openapi.json
- **Postman Collection**: http://localhost:3009/postman.json
- **API Guide**: [docs/api/README.md](docs/api/README.md)
- **Authentication**: [docs/api/AUTHENTICATION.md](docs/api/AUTHENTICATION.md)
- **Versioning & Deprecation**: [docs/api/VERSIONING.md](docs/api/VERSIONING.md)

### Modules

| Module | Endpoints | Resource |
|--------|-----------|----------|
| Checkouts | 8 | Create and manage checkout sessions |
| Orders | 5 | Order lifecycle management |
| Products | 5 | Product catalog CRUD |
| Categories | 5 | Product category management |
| Webhooks | 6 | Event subscription and delivery |
| Coupons | 4 | Coupon creation and validation |
| Analytics | 6 | Dashboard and product analytics |
| Customers | 3 | Customer profiles and history |
| Experiments | 9 | A/B testing |
| Settings | 8 | Configuration (checkout, agent rules, store, SEO) |
| Payments | 3 | Payment intent lifecycle |
| Team | 5 | Team member and invitation management |
| Returns | 2 | Return requests |
| Domains | 3 | Custom domain configuration |
| Support | 2 | Support settings and tickets |
| Shipping | 1 | Shipping quote calculation |
| Fulfillment | 2 | Shipment creation and tracking |
| Notifications | 4 | Transactional notification triggers |
| Cross-Sell | 3 | Cross-sell rule management |
| Installations | 5 | App installation management |
| Audit | 1 | Audit event log |
| Billing | 5 | Plans, subscription, usage, invoices |
| Commerce | 6 | Platform connections (WooCommerce, Magento, VTEX) |

### Monitoring with Prometheus + Grafana

The `docker-compose.monitoring.yml` includes:

- **Prometheus**: Scrapes API metrics every 10s, 30-day retention
- **Grafana**: Pre-built AACP API dashboard with 4 panels:
  - **HTTP Request Rate**: Requests per second by route/status
  - **Request Latency**: p95 and p99 percentiles
  - **Error Rate**: HTTP 5xx errors per second
  - **Domain Events**: Checkouts, orders, payments per second

#### Metrics Exposed

**HTTP Observability:**
- `http_requests_total` — Total requests (labels: method, route, status)
- `http_request_duration_seconds` — Request latency histogram
- `http_errors_total` — 5xx errors (labels: method, route, status)

**Domain Events:**
- `checkouts_created_total` — Checkout creations (labels: status)
- `orders_created_total` — Order creations (labels: status)
- `payments_processed_total` — Payment processing (labels: status)
- `webhook_deliveries_total` — Webhook attempts (labels: status, event_type)
- `webhook_errors_total` — Webhook failures (labels: error_code)

#### Accessing Dashboards

After `docker-compose -f docker-compose.monitoring.yml up -d`:

- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9091
- **API Metrics**: http://localhost:3009/metrics (raw Prometheus format)

#### Custom Queries

In Prometheus (http://localhost:9091):

```promql
# Error rate (5xx / total) over 5 minutes
rate(http_errors_total[5m]) / rate(http_requests_total[5m])

# P95 latency per endpoint
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Checkout success rate
rate(checkouts_created_total{status="success"}[5m]) / rate(checkouts_created_total[5m])
```

In Grafana, create new dashboards by adding Prometheus queries.

### Rate Limiting

API enforces rate limits per merchant tier (sliding-window with Redis):

| Tier | Limit | Burst |
|------|-------|-------|
| Free | 60 req/min | 10 |
| Pro | 600 req/min | 50 |
| Enterprise | 6,000 req/min | 200 |

Rate limit headers in every response:
```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 594
X-RateLimit-Reset: 1723987700
```

When exceeded: `429 Too Many Requests` with `Retry-After` header.

### Webhook Delivery

Webhooks are delivered asynchronously with:
- **HMAC SHA-256 signing** — verify with signing secret
- **Exponential backoff retry** — up to 5 attempts
- **SSRF protection** — DNS rebinding guard on webhook targets
- **Idempotency** — claim-based single-flight guarantee

See [docs/api/WEBHOOKS.md](docs/api/WEBHOOKS.md) for event catalog and verification guide.

### Versioning & Deprecation

Breaking changes follow a 90-day deprecation window:
1. Field/endpoint marked deprecated in OpenAPI
2. `Sunset` and `Deprecation` headers added
3. 90-day migration period (field still works)
4. After 90 days: endpoint returns `410 Gone`

See [docs/api/VERSIONING.md](docs/api/VERSIONING.md) for full policy and semver details.

## Widget Enterprise Conectado à API

O demo do widget (`apps/widget/index.html`) não depende mais de carrinho fixo no código React. O host da loja envia `data-cart-json`, `data-customer-json` e `data-shipping-json`; o widget repassa isso para a API em `/checkout/start` ou `/embed/start`, e a API devolve `experience` com marca, resumo do pedido, copy inicial e sugestões.

Smoke test local:

1. Suba o Postgres: `docker compose up -d postgres` (ou `pnpm db:up` na raiz).
2. Rode as migrations: `cd apps/api && pnpm prisma:deploy`.
3. Configure `DATABASE_URL` em `apps/api/.env`.
4. Rode `pnpm dev:api`.
5. Em outro terminal, rode `pnpm dev:widget`.
6. Abra `http://localhost:5173`.
7. Confirme que o painel mostra a marca `Northstar Atelier`, o item `Bolsa Executiva Couro Safiano`, total com frete e mensagem inicial retornada pela API.

Integrações de clientes podem escolher entre dois modelos: **Embed UI**, com a interface enterprise da AACP instalada por script/Web Component, ou **API-only**, em que a loja mantém sua própria UI e consome nossas rotas de sessão, chat, eventos, ofertas e pagamento. Consulte `docs/integrations/checkout-widget-and-api.md` para snippets, payloads e requisitos de segurança.

Para alinhar posicionamento e UI, leia também:

- `docs/product/agentic-checkout-differentiation.md`
- `docs/product/premium-widget-ui-system.md`
