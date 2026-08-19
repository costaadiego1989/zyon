# CHANGELOG

All notable changes to the AACP API will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-08-19

### Added
- Public API v1 with 23 resource modules and 110+ endpoints
- Authentication via scoped API keys (`aacp_live_*` / `aacp_test_*`) and console sessions
- 31 permission scopes for fine-grained API key access control
- Cursor-based pagination on all list endpoints
- Idempotency support via `Idempotency-Key` header on all mutations
- RFC 7807 Problem Details error responses
- Rate limiting (Redis sliding-window): 60/600/6000 req/min per tier
- Webhook delivery system with HMAC SHA-256 signing and exponential backoff retry
- SSRF protection on webhook targets (DNS rebinding guard)
- Prometheus metrics endpoint (`GET /metrics`)
- Domain metrics: checkouts, orders, payments, webhook deliveries
- TypeScript SDK (`zyon-sdk`) generated from OpenAPI spec
- Interactive API documentation at `/docs` (Scalar)
- Postman collection at `/postman.json`
- OpenAPI JSON specification at `/openapi.json`
- Sandbox/production environment separation
- Commerce platform integrations: WooCommerce, Magento, VTEX

### Resource Modules
- Checkouts (8 endpoints)
- Orders (5 endpoints)
- Products (5 endpoints)
- Categories (5 endpoints)
- Webhooks (6 endpoints)
- Coupons (4 endpoints)
- Analytics (6 endpoints)
- Customers (3 endpoints)
- Experiments (9 endpoints)
- Settings (8 endpoints)
- Payments (3 endpoints)
- Team (5 endpoints)
- Returns (2 endpoints)
- Domains (3 endpoints)
- Support (2 endpoints)
- Shipping (1 endpoint)
- Fulfillment (2 endpoints)
- Notifications (4 endpoints)
- Cross-Sell (3 endpoints)
- Installations (5 endpoints)
- Audit (1 endpoint)
- Billing (5 endpoints)
- Commerce (6 endpoints)

---

## Versioning Policy

See [VERSIONING.md](./docs/api/VERSIONING.md) for the full API versioning and deprecation policy.
