# Design: Real-Time Payment Status + Observability

## Architecture

```
┌─────────────┐    webhook     ┌──────────────┐   Redis Pub/Sub    ┌─────────────────┐
│ Asaas/Stripe│ ──────────────▶│ API Instance │ ──────────────────▶│ Redis (channel) │
│  Provider   │                │  (any of N)  │                    │ payment:{id}    │
└─────────────┘                └──────────────┘                    └────────┬────────┘
                                                                            │ subscribe
                                                                            ▼
┌─────────────┐   WebSocket    ┌──────────────┐   Redis Subscribe  ┌─────────────────┐
│   Widget    │ ◀─────────────│ API Instance │ ◀───────────────────│ Redis (channel) │
│  (buyer)    │  ws://host/ws  │  (any of N)  │                    │ payment:{id}    │
└─────────────┘                └──────────────┘                    └─────────────────┘
```

## Components

### 1. PaymentWebSocketGateway (NestJS @WebSocketGateway)
- Path: `apps/api/src/modules/payment/infrastructure/payment-ws.gateway.ts`
- Protocol: native WebSocket (`@nestjs/websockets` + `ws` adapter)
- Auth: embed token in `?token=` query param (same verification as embed guard)
- Subscription: client sends `{ event: "subscribe", intentId: "pay_int_..." }`
- Push: server sends `{ event: "payment.status_changed", intentId, status, data? }`
- Auto-close on terminal state

### 2. PaymentEventPublisher (Redis Pub/Sub)
- Path: `apps/api/src/modules/payment/infrastructure/payment-event-publisher.ts`
- Publishes on channel `payment:status:{intentId}` when webhook marks approved/failed
- Called from `PaymentDispatchService.markApprovedAndComplete()` and `markFailed()`
- Payload: `{ intentId, status, merchantId, approvedAt? }`

### 3. PaymentEventSubscriber (per-WebSocket connection)
- Lives inside the gateway. On `subscribe(intentId)`:
  - Validates embed token has access to that intent's session/merchant
  - Creates Redis subscription to `payment:status:{intentId}`
  - On message → push to that WS client
  - On disconnect → unsubscribe Redis channel

### 4. MetricsModule (Prometheus)
- Path: `apps/api/src/shared/observability/metrics.module.ts`
- Uses `prom-client` (already in deps via MetricsService stub)
- Registers: counters, histograms, gauges
- NestJS interceptor records `api_request_duration_seconds` per route
- PaymentDispatchService increments payment counters
- Gateway maintains `active_ws_connections` gauge

### 5. HealthController
- Path: `apps/api/src/shared/health/health.controller.ts`
- `GET /health` → checks DB (Prisma `$queryRaw('SELECT 1')`), Redis (PING), returns status

### 6. Widget WebSocket client
- Path: `apps/widget_v2/src/lib/payment-ws.ts`
- Connects to `ws://API_BASE/ws?token={embedToken}` after payment intent created
- On `payment.status_changed` with `status: approved` → same transition as polling success
- On error/close → falls back to polling (current behavior)
- Timeout: 5min → auto-close + fallback

## Dependencies
- `ws` (already in NestJS ecosystem)
- `prom-client` (add to deps)
- `ioredis` (already used via redis.module.ts)
- No new infrastructure — Redis already required for BullMQ/cache

## Migration
- Widget: check if WS connects → use it; else fallback to `setInterval` polling (zero breaking change)
- Backend: publish events to Redis from existing `PaymentDispatchService` (1 line addition)
- Gateway is additive (new module, new route `/ws`) — no existing code changes except adding publisher call
