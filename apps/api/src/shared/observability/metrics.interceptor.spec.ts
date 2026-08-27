import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { of, throwError, lastValueFrom } from "rxjs";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { MetricsInterceptor } from "./metrics.interceptor.js";
import type { MetricsService } from "./metrics.service.js";

interface ObserveCall {
  labels: Record<string, string>;
  value: number;
}

function buildMetrics(): { metrics: MetricsService; calls: ObserveCall[] } {
  const calls: ObserveCall[] = [];
  const metrics = {
    apiRequestDuration: {
      observe(labels: Record<string, string>, value: number) {
        calls.push({ labels, value });
      },
    },
  } as unknown as MetricsService;
  return { metrics, calls };
}

function buildContext(
  req: Record<string, unknown>,
  statusCode: number,
): ExecutionContext {
  const res = { statusCode };
  return {
    switchToHttp() {
      return {
        getRequest: () => req,
        getResponse: () => res,
      };
    },
  } as unknown as ExecutionContext;
}

describe("MetricsInterceptor", () => {
  it("observes duration with route pattern, method, and status on success", async () => {
    const { metrics, calls } = buildMetrics();
    const interceptor = new MetricsInterceptor(metrics);
    const context = buildContext(
      { method: "GET", route: { path: "/embed/payment/intents/:intentId/status" } },
      200,
    );
    const next: CallHandler = { handle: () => of({ ok: true }) };

    await lastValueFrom(interceptor.intercept(context, next));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].labels.method, "GET");
    assert.equal(calls[0].labels.route, "/embed/payment/intents/:intentId/status");
    assert.equal(calls[0].labels.status, "200");
    assert.ok(calls[0].value >= 0);
  });

  it("records metric on error and rethrows", async () => {
    const { metrics, calls } = buildMetrics();
    const interceptor = new MetricsInterceptor(metrics);
    const context = buildContext(
      { method: "POST", route: { path: "/checkout/sessions" } },
      201,
    );
    const error = Object.assign(new Error("boom"), { status: 422 });
    const next: CallHandler = { handle: () => throwError(() => error) };

    await assert.rejects(
      () => lastValueFrom(interceptor.intercept(context, next)),
      /boom/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].labels.method, "POST");
    assert.equal(calls[0].labels.route, "/checkout/sessions");
    assert.equal(calls[0].labels.status, "422");
  });

  it("falls back to baseUrl then unknown when route path missing", async () => {
    const { metrics, calls } = buildMetrics();
    const interceptor = new MetricsInterceptor(metrics);
    const context = buildContext({ method: "GET", baseUrl: "/health" }, 200);
    const next: CallHandler = { handle: () => of(null) };

    await lastValueFrom(interceptor.intercept(context, next));

    assert.equal(calls[0].labels.route, "/health");
  });

  it("degrades gracefully when MetricsService is absent", async () => {
    const interceptor = new MetricsInterceptor(null);
    const context = buildContext({ method: "GET", route: { path: "/x" } }, 200);
    const next: CallHandler = { handle: () => of("passthrough") };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    assert.equal(result, "passthrough");
  });
});
