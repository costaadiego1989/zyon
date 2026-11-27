import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketingObservability } from "./marketing-observability.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
test("MKT-10/1 operation telemetry keeps correlation and excludes raw errors and customer data", async () => {
  const metrics = new MetricsService();
  const logs: unknown[] = [];
  const observer = new MarketingObservability(metrics, {
    log: (v) => logs.push(v),
    warn: (v) => logs.push(v),
  });
  await assert.rejects(
    CorrelationIdStorage.run("marketing-test-correlation", () =>
      observer.run("dispatch", async () => {
        throw new Error(
          "secret-token phone=5511999991234 private@example.test"
        );
      })
    ),
    /secret-token/
  );
  const output = JSON.stringify(logs);
  assert.match(output, /marketing-test-correlation/);
  assert.match(output, /operation_unavailable/);
  assert.doesNotMatch(output, /secret-token|5511999991234|private@example/);
  const rendered = await metrics.registry.metrics();
  assert.match(
    rendered,
    /marketing_operations_total\{operation="dispatch",outcome="failed"\} 1/
  );
  assert.doesNotMatch(rendered, /5511999991234|private@example|secret-token/);
  metrics.registry.clear();
});
