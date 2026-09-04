import { Injectable, NestMiddleware } from "@nestjs/common";
import { Counter, Histogram, Registry } from "prom-client";
import type { NextFunction, Request, Response } from "express";

let registry: Registry;
let httpRequestDuration: Histogram;
let httpRequestsTotal: Counter;
let httpErrorsTotal: Counter;

export function initMetrics(): Registry {
  registry = new Registry();

  httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });

  httpRequestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });

  httpErrorsTotal = new Counter({
    name: "http_errors_total",
    help: "Total number of HTTP errors (5xx)",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });

  return registry;
}

export function getMetricsRegistry(): Registry {
  if (!registry) {
    throw new Error("Metrics not initialized. Call initMetrics() first.");
  }
  return registry;
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const originalSend = res.send;

    res.send = function (...args: any[]) {
      const duration = (Date.now() - start) / 1000;
      const method = req.method;
      const route = req.route?.path || req.path;
      const status = res.statusCode;

      httpRequestDuration.observe({ method, route, status }, duration);
      httpRequestsTotal.inc({ method, route, status });

      if (status >= 500) {
        httpErrorsTotal.inc({ method, route, status });
      }

      return originalSend.apply(res, args as [body?: any]);
    };

    next();
  }
}

let checkoutCounter: Counter;
let orderCounter: Counter;
let paymentCounter: Counter;
let webhookDeliveryCounter: Counter;
let webhookErrorCounter: Counter;

export function initDomainMetrics(): void {
  if (!registry) {
    throw new Error("Call initMetrics() before initDomainMetrics()");
  }

  checkoutCounter = new Counter({
    name: "checkouts_created_total",
    help: "Total number of checkouts created",
    labelNames: ["status"],
    registers: [registry],
  });

  orderCounter = new Counter({
    name: "orders_created_total",
    help: "Total number of orders created",
    labelNames: ["status"],
    registers: [registry],
  });

  paymentCounter = new Counter({
    name: "payments_processed_total",
    help: "Total number of payment intents processed",
    labelNames: ["status"],
    registers: [registry],
  });

  webhookDeliveryCounter = new Counter({
    name: "webhook_deliveries_total",
    help: "Total webhook delivery attempts",
    labelNames: ["status", "event_type"],
    registers: [registry],
  });

  webhookErrorCounter = new Counter({
    name: "webhook_errors_total",
    help: "Total webhook delivery failures",
    labelNames: ["error_code"],
    registers: [registry],
  });
}

export function recordCheckoutCreated(status: "success" | "failed"): void {
  checkoutCounter?.inc({ status });
}

export function recordOrderCreated(status: "success" | "failed"): void {
  orderCounter?.inc({ status });
}

export function recordPaymentProcessed(status: "success" | "failed"): void {
  paymentCounter?.inc({ status });
}

export function recordWebhookDelivery(
  status: "delivered" | "failed" | "pending",
  eventType: string,
): void {
  webhookDeliveryCounter?.inc({ status, event_type: eventType });
}

export function recordWebhookError(errorCode: string): void {
  webhookErrorCounter?.inc({ error_code: errorCode });
}
