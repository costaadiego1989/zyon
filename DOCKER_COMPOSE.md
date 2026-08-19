# Local Development with Docker Compose

## Quick Start

```bash
# Copy example env file
cp .env.example .env

# Start services (postgres, redis, API, Prometheus, Grafana)
docker-compose -f docker-compose.monitoring.yml up -d

# Wait for API to be ready
sleep 10

# Check API health
curl http://localhost:3009/ready

# Check metrics
curl http://localhost:3009/metrics

# Access Grafana
open http://localhost:3000  # admin / admin

# Access Prometheus
open http://localhost:9091

# View API docs
open http://localhost:3009/docs
```

## Services

| Service | Port | URL |
|---------|------|-----|
| API | 3009 | http://localhost:3009 |
| Postgres | 5432 | localhost:5432 |
| Redis | 6379 | localhost:6379 |
| Prometheus | 9091 | http://localhost:9091 |
| Grafana | 3000 | http://localhost:3000 |

## Prometheus Metrics

Available at `GET /metrics`:

- `http_requests_total` — Total HTTP requests (labels: method, route, status)
- `http_request_duration_seconds` — Request latency (histogram)
- `http_errors_total` — Total 5xx errors (labels: method, route, status)
- `checkouts_created_total` — Checkouts (labels: status)
- `orders_created_total` — Orders (labels: status)
- `payments_processed_total` — Payments (labels: status)
- `webhook_deliveries_total` — Webhook attempts (labels: status, event_type)
- `webhook_errors_total` — Webhook failures (labels: error_code)

## Grafana Dashboards

Pre-built dashboard available at **AACP API Monitoring**:
- HTTP request rate
- Request latency (p95, p99)
- Error rate
- Domain event rates

## Logs

View logs for all services:

```bash
docker-compose -f docker-compose.monitoring.yml logs -f

# Specific service:
docker-compose -f docker-compose.monitoring.yml logs -f api
docker-compose -f docker-compose.monitoring.yml logs -f prometheus
docker-compose -f docker-compose.monitoring.yml logs -f grafana
```

## Database Migrations

API will auto-run migrations on startup. To manually migrate:

```bash
docker-compose -f docker-compose.monitoring.yml exec api npx prisma migrate deploy
```

## Cleanup

```bash
docker-compose -f docker-compose.monitoring.yml down -v
```

This stops all services and removes volumes (data will be lost).
