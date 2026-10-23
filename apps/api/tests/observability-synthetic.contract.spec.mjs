import test from "node:test";
import assert from "node:assert/strict";
const load = () => import("../../../infra/observability/tests/synthetic-fixtures.mjs");

test("synthetic counters increase with explicit time, not requests or random buyer data", async () => {
  const { syntheticMetrics } = await load();
  const first = syntheticMetrics(1), second = syntheticMetrics(2);
  assert.match(first, /storefront_llm_operations_total\{stage="turn",outcome="ok",reason="completed"\} 10\n/);
  assert.match(second, /storefront_llm_operations_total\{stage="turn",outcome="ok",reason="completed"\} 20\n/);
  // kind="prompt" is the existing token enum, not prompt content.
  assert.doesNotMatch(first, /merchant|buyer|user_message|email|trace_id|request_id|PRIVATE/);
});

test("synthetic metrics cover all five existing families, honest histogram and known USD cents", async () => {
  const { syntheticMetrics } = await load(), value = syntheticMetrics(2);
  for (const family of ["operations", "decisions", "tokens", "estimated_cost_usd_cents"]) assert.ok(value.includes(`storefront_llm_${family}_total`));
  assert.match(value, /operation_duration_seconds_bucket\{stage="provider",le="\+Inf"\} 20/);
  assert.match(value, /operation_duration_seconds_count\{stage="provider"\} 20/);
  assert.match(value, /operation_duration_seconds_sum\{stage="provider"\} 10/);
  assert.match(value, /estimated_cost_usd_cents_total\{phase="main",provider="openrouter"\} 4/);
});

test("empty fixture omits series instead of fabricating healthy zeroes", async () => {
  const { syntheticMetrics } = await load();
  assert.equal(syntheticMetrics(1, true), "# Synthetic fixture intentionally emits no storefront series.\n");
});

test("synthetic fixture rejects invalid ticks and time", async () => {
  const { syntheticMetrics, syntheticLog, syntheticTrace } = await load();
  for (const tick of [-1, Infinity, NaN, "1"]) assert.throws(() => syntheticMetrics(tick));
  assert.throws(() => syntheticLog("invalid", "invalid", NaN));
  assert.throws(() => syntheticTrace("a".repeat(32), "b".repeat(16), NaN));
});

test("log carries explicit private canaries to challenge real collector projection", async () => {
  const { syntheticLog } = await load(), entry = syntheticLog("a".repeat(32), "b".repeat(16), 1_790_000_000_000);
  assert.equal(entry.event, "storefront.observation"); assert.equal(entry.time, "2026-09-21T14:13:20.000Z");
  assert.ok(JSON.stringify(entry).includes("PRIVATE_SYNTHETIC"));
  assert.equal(entry.traceId, "a".repeat(32)); assert.equal(entry.spanId, "b".repeat(16));
});

test("OTLP fixture contains one explicit synthetic service span and no user payload", async () => {
  const { syntheticTrace } = await load(), payload = syntheticTrace("a".repeat(32), "b".repeat(16), 1_790_000_000_000);
  const resource = payload.resourceSpans[0];
  assert.deepEqual(resource.resource.attributes, [{ key: "service.name", value: { stringValue: "zyon-api" } }]);
  const span = resource.scopeSpans[0].spans[0];
  assert.equal(span.traceId, "a".repeat(32)); assert.equal(span.spanId, "b".repeat(16));
  assert.equal(span.name, "storefront.provider");
  assert.ok(BigInt(span.endTimeUnixNano) > BigInt(span.startTimeUnixNano));
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|buyer|merchant|prompt|password/);
});

test("test relay maps only its exact loopback origin to the internal backend origin", async () => {
  const { relayHeaders } = await import("./observability-loopback-relay.mjs");
  const headers = relayHeaders({ host: "127.0.0.1:12345", origin: "http://127.0.0.1:12345", referer: "http://127.0.0.1:12345/d/test" }, "grafana:3000", "http://127.0.0.1:12345");
  assert.equal(headers.host, "grafana:3000"); assert.equal(headers.origin, "http://grafana:3000");
  assert.equal(headers.referer, "http://grafana:3000/d/test");
});

test("test relay never rewrites an unrelated origin into a trusted same-origin request", async () => {
  const { relayHeaders } = await import("./observability-loopback-relay.mjs");
  const headers = relayHeaders({ origin: "https://untrusted.invalid", referer: "https://untrusted.invalid/", "accept-encoding": "gzip", connection: "keep-alive" }, "grafana:3000", "http://127.0.0.1:12345");
  assert.equal(headers.origin, "https://untrusted.invalid"); assert.equal(headers.referer, "https://untrusted.invalid/");
  assert.equal(headers["accept-encoding"], undefined); assert.equal(headers.connection, undefined);
});
