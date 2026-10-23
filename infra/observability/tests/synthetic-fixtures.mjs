import assert from "node:assert/strict";

// Pure test data only. Never import application configuration or credentials.
export function syntheticMetrics(tick, empty = false) {
  assert.ok(typeof tick === "number" && Number.isFinite(tick) && tick >= 0);
  if (empty) return "# Synthetic fixture intentionally emits no storefront series.\n";
  const count = 10 * tick;
  return [
    "# TYPE storefront_llm_operations_total counter",
    `storefront_llm_operations_total{stage="turn",outcome="ok",reason="completed"} ${count}`,
    `storefront_llm_operations_total{stage="provider",outcome="error",reason="exception"} ${tick}`,
    `storefront_llm_operations_total{stage="persistence",outcome="error",reason="exception"} ${tick}`,
    "# TYPE storefront_llm_decisions_total counter",
    `storefront_llm_decisions_total{stage="generation",outcome="fallback",reason="exception"} ${tick}`,
    `storefront_llm_decisions_total{stage="output",outcome="rejected",reason="invalid_output"} ${tick}`,
    "# TYPE storefront_llm_operation_duration_seconds histogram",
    ...[["0.1", 0], ["0.5", 5], ["1", 10], ["+Inf", 10]].map(([le, value]) =>
      `storefront_llm_operation_duration_seconds_bucket{stage="provider",le="${le}"} ${value * tick}`),
    `storefront_llm_operation_duration_seconds_sum{stage="provider"} ${5 * tick}`,
    `storefront_llm_operation_duration_seconds_count{stage="provider"} ${count}`,
    "# TYPE storefront_llm_tokens_total counter",
    `storefront_llm_tokens_total{phase="main",provider="openrouter",kind="prompt"} ${100 * tick}`,
    "# TYPE storefront_llm_estimated_cost_usd_cents_total counter",
    `storefront_llm_estimated_cost_usd_cents_total{phase="main",provider="openrouter"} ${2 * tick}`,
    "",
  ].join("\n");
}

function check(traceId, spanId, time) {
  assert.match(traceId, /^[a-f0-9]{32}$/); assert.notEqual(traceId, "0".repeat(32));
  assert.match(spanId, /^[a-f0-9]{16}$/); assert.notEqual(spanId, "0".repeat(16));
  assert.ok(Number.isSafeInteger(time) && time > 0);
}

export function syntheticLog(traceId, spanId, time) {
  check(traceId, spanId, time);
  return {
    time: new Date(time).toISOString(), level: 30, event: "storefront.observation",
    kind: "operation", stage: "provider", outcome: "ok", reason: "completed", phase: "main", provider: "openrouter",
    traceId, spanId, requestId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222", operationId: "33333333-3333-4333-8333-333333333333",
    prompt: "PRIVATE_SYNTHETIC_PROMPT", headers: { authorization: "PRIVATE_SYNTHETIC_TOKEN" },
    body: "PRIVATE_SYNTHETIC_BODY", extra: "PRIVATE_SYNTHETIC_EXTRA",
  };
}

export function syntheticTrace(traceId, spanId, time) {
  check(traceId, spanId, time);
  return { resourceSpans: [{
    resource: { attributes: [{ key: "service.name", value: { stringValue: "zyon-api" } }] },
    scopeSpans: [{ scope: { name: "zyon.synthetic-validation" }, spans: [{
      traceId, spanId, name: "storefront.provider", kind: 1,
      startTimeUnixNano: (BigInt(time) * 1_000_000n).toString(),
      endTimeUnixNano: (BigInt(time + 50) * 1_000_000n).toString(), status: { code: 1 },
    }] }],
  }] };
}
