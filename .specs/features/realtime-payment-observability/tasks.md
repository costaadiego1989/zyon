# Tasks: Real-Time Payment Status + Observability

## T1 [P] — Redis Pub/Sub payment event publisher
- What: Publisher that emits payment status changes to Redis channel
- Where: `apps/api/src/modules/payment/infrastructure/payment-event-publisher.ts`
- Reuses: `apps/api/src/shared/cache/redis.module.ts` (Redis client)
- Done when: `publishStatusChange(intentId, status, merchantId)` publishes to `payment:status:{intentId}`; graceful no-op if Redis absent
- Tests: unit — mock Redis, assert publish called with correct channel/payload
- Gate: `cd apps/api && node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`

## T2 [P] — Prometheus metrics module
- What: Real prom-client metrics (counters, histograms, gauge) replacing stub MetricsService
- Where: `apps/api/src/shared/observability/metrics.module.ts` + `metrics.service.ts`
- Reuses: existing `MetricsService` interface (payment counters already referenced in handle-asaas-webhook)
- Done when: `/metrics` endpoint returns prom format; counters `payment_intent_created_total`, `payment_approved_total`, `payment_failed_total`, histogram `webhook_processing_seconds`, gauge `active_ws_connections`
- Tests: unit — increment counter, assert registry output
- Gate: typecheck + `curl /metrics` returns text/plain prom format

## T3 [P] — Health controller
- What: `/health` endpoint checking DB + Redis
- Where: `apps/api/src/shared/health/health.controller.ts` + module
- Reuses: PRISMA_CLIENT, Redis client
- Done when: `GET /health` → `{status:"ok"|"degraded", redis:bool, db:bool, uptime}`; 200 if ok, 503 if db down
- Tests: unit — mock db/redis up+down
- Gate: typecheck + `curl /health` returns JSON

## T4 — WebSocket gateway (depends on T1)
- What: NestJS WebSocket gateway for payment status push
- Where: `apps/api/src/modules/payment/infrastructure/payment-ws.gateway.ts`
- Depends on: T1 (subscribes to same Redis channels publisher emits)
- Reuses: EmbedTokenService (auth), Redis client (subscribe), MetricsService (T2 gauge)
- Done when: client connects `ws://host/ws?token=`, sends `{event:"subscribe",intentId}`, receives `{event:"payment.status_changed",status}` when Redis channel fires; validates token owns intent; increments/decrements active_ws_connections gauge; unsubscribes on disconnect
- Tests: integration — connect ws, publish to Redis, assert message received
- Gate: typecheck + integration test passes

## T5 — Wire publisher into PaymentDispatchService (depends on T1)
- What: Call `publishStatusChange` when payment approved/failed
- Where: `apps/api/src/modules/payment/application/services/payment-dispatch.service.ts`
- Depends on: T1
- Reuses: PaymentEventPublisher
- Done when: `markApprovedAndComplete` and `markFailed` publish to Redis after DB commit; also increments T2 metrics counters
- Tests: unit — assert publisher called after status change
- Gate: typecheck

## T6 — API request duration interceptor (depends on T2)
- What: NestJS interceptor recording `api_request_duration_seconds` histogram
- Where: `apps/api/src/shared/observability/metrics.interceptor.ts`
- Depends on: T2
- Reuses: MetricsService
- Done when: every HTTP request records duration labeled by method+route+status; registered globally
- Tests: unit — mock request, assert histogram observed
- Gate: typecheck

## T7 — Widget WebSocket client + fallback (depends on T4)
- What: Widget connects WS, falls back to polling on failure
- Where: `apps/widget_v2/src/lib/payment-ws.ts` + wire into `checkout-store.ts` pollPayment
- Depends on: T4 (gateway contract)
- Reuses: existing pollPayment logic as fallback
- Done when: after payment intent, widget opens WS; on `approved` → same transition as polling; on WS error/timeout → falls back to setInterval polling; closes WS on terminal
- Tests: covered by T8 E2E
- Gate: `cd apps/widget_v2 && pnpm build`

## T8 — E2E test: WebSocket payment flow (depends on T4, T5, T7)
- What: E2E script proving webhook → Redis → WS → widget notification
- Where: `apps/api/scripts/qa-e2e-ws-payment.ts`
- Depends on: T4, T5, T7
- Done when: script creates intent, opens WS client, simulates webhook (publishes to Redis via approved), asserts WS receives payment.status_changed < 1s
- Tests: this IS the test
- Gate: script runs green

## Parallel plan
- Round 1 (parallel): T1, T2, T3 — independent foundations
- Round 2 (parallel): T4 (needs T1), T5 (needs T1), T6 (needs T2)
- Round 3: T7 (needs T4)
- Round 4: T8 (needs T4+T5+T7)
