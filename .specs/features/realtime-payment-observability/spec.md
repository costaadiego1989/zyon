# Spec: Real-Time Payment Status + Observability

## REQ-RT-001: WebSocket payment status (replace polling)

**As** a buyer waiting for PIX/card confirmation,
**I want** instant notification when payment is approved,
**So that** the checkout shows "Pagamento confirmado" immediately (< 1s) instead of polling every 3s.

### Acceptance Criteria
- AC1: Widget connects to WebSocket after creating payment intent
- AC2: When webhook confirms payment, server pushes `payment.approved` via WebSocket in < 500ms
- AC3: Widget transitions to "Pagamento confirmado" screen on WS message
- AC4: Fallback to polling if WebSocket fails to connect (graceful degradation)
- AC5: Connection auto-closes after terminal state (approved/failed/expired)
- AC6: Supports 2000+ concurrent connections per API instance

## REQ-RT-002: Redis Pub/Sub for webhook → WebSocket bridge

**As** the platform handling 1000 merchants,
**I want** webhook events published to Redis channel,
**So that** multiple API instances can notify the correct buyer WebSocket without shared memory.

### Acceptance Criteria
- AC1: Asaas/Stripe webhook publishes `payment:{intentId}:status_changed` to Redis
- AC2: WebSocket gateway subscribes per-intent channel on buyer connect
- AC3: Horizontal scaling: N API instances, buyer connects to any, all receive webhook events
- AC4: Channel auto-expires (TTL 30min) to prevent Redis memory leak

## REQ-RT-003: Observability — structured metrics + health

**As** the platform operator with 1000 merchants,
**I want** real-time metrics on payment processing, API latency, and error rates,
**So that** I can detect issues before merchants report them.

### Acceptance Criteria
- AC1: Prometheus-compatible metrics endpoint `/metrics`
- AC2: Key metrics: `payment_intent_created_total`, `payment_approved_total`, `payment_failed_total`, `webhook_processing_seconds`, `api_request_duration_seconds`, `active_ws_connections`
- AC3: Health endpoint `/health` returns `{status, redis, db, uptime}`
- AC4: Correlation IDs in all logs (already exists — verify consistency)
- AC5: Structured JSON logs with merchant_id, session_id, intent_id (already partial — complete)

## REQ-RT-004: E2E test — payment WebSocket flow

**As** QA,
**I want** automated E2E test proving WebSocket payment notification works,
**So that** regression is caught before deploy.

### Acceptance Criteria
- AC1: Script creates payment intent, connects WS, simulates webhook, asserts WS message received
- AC2: Verifies < 1s latency from webhook → WS notification
- AC3: Verifies fallback polling still works if WS disconnected
