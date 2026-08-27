# STATE — realtime-payment-observability

## Progress
- Spec + design + tasks: DONE
- Round 1 (T1 Redis publisher, T2 metrics, T3 health): IN PROGRESS (parallel)
- Round 2 (T4 gateway, T5 dispatch wiring, T6 interceptor): PENDING
- Round 3 (T7 widget WS client): PENDING
- Round 4 (T8 E2E): PENDING

## Prior validated (this session)
- PIX (Asaas) E2E visual: QR → approve → confirmed → cart cleared ✅
- Card (Stripe Elements) E2E visual: form → confirm 200 → approved → cart cleared ✅
- Crypto (USDC Polygon): intent created ✅
- Stripe Connect active (acct_1U8syCLnjGWYt6MG), webhook we_1U8slsPvEQVo3vcN
- Commits: 87e18f9 (checkout fixes), 5100d82 (stripe card)

## Decisions
- WebSocket via native ws + Redis Pub/Sub (not socket.io) — matches lean infra
- Polling kept as fallback (graceful degradation) — zero breaking change
- prom-client for metrics (Prometheus standard)
