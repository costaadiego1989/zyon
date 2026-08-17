import { Injectable } from "@nestjs/common";
import { Counter, Histogram, Gauge, Registry } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly checkoutStarted = new Counter({
    name: "checkout_started_total",
    help: "Total checkout sessions started",
    labelNames: ["merchant_id"],
    registers: [this.registry],
  });

  readonly orderCompleted = new Counter({
    name: "order_completed_total",
    help: "Total orders completed",
    labelNames: ["merchant_id"],
    registers: [this.registry],
  });

  readonly paymentApproved = new Counter({
    name: "payment_approved_total",
    help: "Total payments approved",
    labelNames: ["merchant_id"],
    registers: [this.registry],
  });

  readonly paymentWebhookAnomaly = new Counter({
    name: "payment_webhook_anomaly_total",
    help: "Provider webhook events that hit an illegal/unexpected state transition",
    labelNames: ["provider", "kind"],
    registers: [this.registry],
  });

  readonly paymentWebhookReceived = new Counter({
    name: "payment_webhook_received_total",
    help: "Payment webhooks received by provider",
    labelNames: ["provider", "event_type"],
    registers: [this.registry],
  });

  readonly checkoutDuration = new Histogram({
    name: "checkout_duration_seconds",
    help: "Time from session start to order completion",
    labelNames: ["merchant_id"],
    buckets: [30, 60, 120, 300, 600, 1800, 3600],
    registers: [this.registry],
  });

  readonly chatResponseLatency = new Histogram({
    name: "chat_response_latency_seconds",
    help: "Latency of chat message processing (LLM + rules)",
    labelNames: ["merchant_id", "has_offer"],
    buckets: [0.3, 0.5, 1, 2, 3, 5, 10, 15],
    registers: [this.registry],
  });

  readonly shippingQuoteLatency = new Histogram({
    name: "shipping_quote_latency_seconds",
    help: "Time to fetch shipping quotes from carrier",
    labelNames: ["carrier"],
    buckets: [0.5, 1, 2, 3, 5, 10],
    registers: [this.registry],
  });

  readonly outboxLag = new Histogram({
    name: "outbox_lag_seconds",
    help: "Age of oldest pending outbox event in seconds",
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    registers: [this.registry],
  });

  readonly outboxPendingCount = new Gauge({
    name: "outbox_pending_count",
    help: "Number of pending outbox messages",
    registers: [this.registry],
  });

  readonly outboxDeadLetterCount = new Gauge({
    name: "outbox_dead_letter_count",
    help: "Number of dead-lettered outbox messages",
    registers: [this.registry],
  });

  readonly httpClientDuration = new Histogram({
    name: "llm_latency_seconds",
    help: "Latency of external HTTP client calls in seconds",
    labelNames: ["target", "status"],
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });

  readonly commerceSyncDuration = new Histogram({
    name: "commerce_sync_duration_seconds",
    help: "Time to process commerce webhook and sync order",
    labelNames: ["provider", "outcome"],
    buckets: [0.1, 0.3, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  readonly activeCheckoutSessions = new Gauge({
    name: "active_checkout_sessions",
    help: "Number of checkout sessions active in last 30 minutes",
    labelNames: ["merchant_id"],
    registers: [this.registry],
  });

  readonly apiOperationTotal = new Counter({
    name: "api_operation_total",
    help: "Total API operations by handler and result",
    labelNames: ["operation", "result"],
    registers: [this.registry],
  });

  readonly apiOperationDuration = new Histogram({
    name: "api_operation_duration_ms",
    help: "API operation duration in milliseconds",
    labelNames: ["operation", "result"],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [this.registry],
  });

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
