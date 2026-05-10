import { Injectable } from "@nestjs/common";
import { Counter, Histogram, Registry } from "prom-client";

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

  readonly outboxLag = new Histogram({
    name: "outbox_lag_seconds",
    help: "Age of oldest pending outbox event in seconds",
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    registers: [this.registry],
  });

  readonly httpClientDuration = new Histogram({
    name: "llm_latency_seconds",
    help: "Latency of external HTTP client calls in seconds",
    labelNames: ["target", "status"],
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
