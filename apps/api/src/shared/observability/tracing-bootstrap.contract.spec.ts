import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolveTracingConfig } from "./tracing-config.js";
import { TracingRuntime, type TracingSdkHandle } from "./tracing-runtime.js";
import { startInstrumentedApplication } from "./bootstrap-sequence.js";
import { SafeSpanExporter } from "./safe-span-exporter.js";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { TracingLifecycle } from "./tracing-lifecycle.js";
import { trace, context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import { createTracingSdk } from "./tracing-sdk.js";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { TRACING_RUNTIME } from "./tracing-lifecycle.js";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" };
function fixture(overrides: Partial<TracingSdkHandle> = {}) {
  const calls: string[] = [], logs: unknown[] = [];
  const handle: TracingSdkHandle = { start: () => { calls.push("start"); }, forceFlush: async () => { calls.push("flush"); }, shutdown: async () => { calls.push("shutdown"); }, ...overrides };
  const runtime = new TracingRuntime({ createSdk: async config => { calls.push("create"); assert.ok(config.endpoint); return handle; }, log: event => logs.push(event), lifecycleTimeoutMs: 15 });
  return { runtime, calls, logs };
}

test("no endpoint and SDK-disabled never create exporter or SDK", async () => {
  const { runtime, calls } = fixture();
  assert.equal((await runtime.init({})).status, "disabled");
  assert.equal((await runtime.init({ ...env, OTEL_SDK_DISABLED: "true" })).status, "disabled");
  assert.equal((await runtime.init({ ...env, OTEL_TRACES_EXPORTER: "none" })).status, "disabled");
  assert.equal((await runtime.init({ ...env, OTEL_TRACES_EXPORTER: "console" })).status, "disabled");
  assert.deepEqual(calls, []);
});

test("configuration is read at init, not module evaluation", async () => {
  const { runtime, calls } = fixture();
  await runtime.init({});
  await runtime.init(env);
  assert.deepEqual(calls, ["create", "start"]);
  await runtime.shutdown();
});

test("generic endpoint is normalized exactly once and traces endpoint takes precedence", () => {
  for (const endpoint of ["http://127.0.0.1:4318", "http://127.0.0.1:4318/", "http://127.0.0.1:4318/v1/traces", "http://127.0.0.1:4318/v1/traces/"]) {
    const result = resolveTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint });
    assert.equal(result.status, "enabled");
    if (result.status === "enabled") assert.equal(result.config.endpoint, "http://127.0.0.1:4318/v1/traces");
  }
  const result = resolveTracingConfig({ ...env, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:4318/custom/traces" });
  assert.equal(result.status, "enabled");
  if (result.status === "enabled") assert.equal(result.config.endpoint, "http://127.0.0.1:4318/custom/traces");
});

for (const endpoint of ["file:///PRIVATE", "not-a-url", "http://user:PRIVATE@localhost:4318", "https://example.com/traces?token=PRIVATE", "https://example.com/#PRIVATE"]) {
  test(`unsafe endpoint config fails closed without raw diagnostics: ${endpoint.split(":")[0]}`, async () => {
    const { runtime, calls, logs } = fixture();
    assert.equal((await runtime.init({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint })).status, "disabled");
    assert.deepEqual(calls, []); assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
  });
}

test("manual-only instrumentation and bounded sampling are explicit defaults", () => {
  const result = resolveTracingConfig(env);
  assert.equal(result.status, "enabled");
  if (result.status !== "enabled") return;
  assert.equal(result.config.autoInstrumentation, false);
  assert.equal(result.config.sampler, "parentbased_traceidratio");
  assert.equal(result.config.sampleRatio, 0.1);
  assert.equal(result.config.serviceName, "zyon-api");
});

for (const arg of ["NaN", "Infinity", "-0.1", "1.1", "PRIVATE", ""]) {
  test(`invalid sampling ratio cannot enable export: ${arg}`, () => {
    assert.equal(resolveTracingConfig({ ...env, OTEL_TRACES_SAMPLER_ARG: arg }).status, "disabled");
  });
}

test("explicit supported sampling and auto instrumentation are honored", () => {
  const result = resolveTracingConfig({ ...env, OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "0", OTEL_AUTO_INSTRUMENTATION: "enabled" });
  assert.equal(result.status, "enabled");
  if (result.status === "enabled") { assert.equal(result.config.sampleRatio, 0); assert.equal(result.config.autoInstrumentation, true); }
  assert.equal(resolveTracingConfig({ ...env, OTEL_TRACES_SAMPLER: "PRIVATE_UNKNOWN" }).status, "disabled");
});

test("simultaneous initialization starts SDK only once", async () => {
  const { runtime, calls } = fixture();
  await Promise.all(Array.from({ length: 8 }, () => runtime.init(env)));
  assert.deepEqual(calls, ["create", "start"]);
  await runtime.shutdown();
});

test("SDK creation failure leaves commerce startup usable and does not expose error", async () => {
  const logs: unknown[] = []; let attempts = 0;
  const runtime = new TracingRuntime({ createSdk: async () => { attempts++; throw new Error("PRIVATE_KEY"); }, log: event => logs.push(event) });
  assert.equal((await runtime.init(env)).status, "failed");
  assert.equal((await runtime.init(env)).status, "failed");
  assert.equal(attempts, 1); assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
});

test("flush then shutdown execute once, without registering competing process signal listeners", async () => {
  const term = process.listenerCount("SIGTERM"), interrupt = process.listenerCount("SIGINT");
  const { runtime, calls } = fixture();
  await runtime.init(env);
  await Promise.all([runtime.shutdown(), runtime.shutdown()]);
  assert.deepEqual(calls, ["create", "start", "flush", "shutdown"]);
  assert.equal(process.listenerCount("SIGTERM"), term); assert.equal(process.listenerCount("SIGINT"), interrupt);
  assert.equal((await runtime.init(env)).status, "stopped");
});

test("failed flush still shuts SDK down and swallows only telemetry errors", async () => {
  let closed = 0;
  const { runtime, logs } = fixture({ forceFlush: async () => { throw new Error("PRIVATE_EXPORTER_BODY"); }, shutdown: async () => { closed++; throw new Error("PRIVATE_CLOSE"); } });
  await runtime.init(env); await runtime.shutdown();
  assert.equal(closed, 1); assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
});

test("hung telemetry flush is bounded and shutdown is still attempted", async () => {
  let closed = 0;
  const { runtime } = fixture({ forceFlush: () => new Promise(() => {}), shutdown: async () => { closed++; } });
  await runtime.init(env); await runtime.shutdown();
  assert.equal(closed, 1);
});

test("shutdown during SDK creation prevents late SDK start", async () => {
  let release!: (value: TracingSdkHandle) => void; let starts = 0, closes = 0;
  const runtime = new TracingRuntime({ createSdk: () => new Promise(resolve => { release = resolve; }), lifecycleTimeoutMs: 10 });
  const starting = runtime.init(env);
  await runtime.shutdown();
  release({ start: () => { starts++; }, forceFlush: async () => {}, shutdown: async () => { closes++; } });
  await starting;
  assert.equal(starts, 0); assert.equal(closes, 1);
});

test("environment loads before tracing and lazy application imports", async () => {
  const order: string[] = [];
  await startInstrumentedApplication({ loadEnvironment: () => { order.push("env"); }, initTracing: async () => { order.push("trace"); }, loadApplication: async () => { order.push("application"); }, shutdownTracing: async () => { order.push("shutdown"); } });
  assert.deepEqual(order, ["env", "trace", "application"]);
});

test("application startup failure closes tracing and preserves exact original exception", async () => {
  const error = new Error("PRIVATE_APPLICATION_FAILURE"); let closed = 0;
  await assert.rejects(startInstrumentedApplication({ loadEnvironment: () => {}, initTracing: async () => {}, loadApplication: async () => { throw error; }, shutdownTracing: async () => { closed++; } }), e => e === error);
  assert.equal(closed, 1);
});

test("Nest lifecycle awaits tracing shutdown instead of fire-and-forget signals", async () => {
  const events = new EventEmitter(); let finish!: () => void; let done = false;
  const hook = new TracingLifecycle({ shutdown: () => new Promise<void>(resolve => { finish = resolve; events.emit("closing"); }) });
  const closing = hook.onApplicationShutdown().then(() => { done = true; });
  assert.equal(done, false); finish(); await closing; assert.equal(done, true);
});

test("entrypoint loads dotenv and tracing before importing application bootstrap", async () => {
  const main = await readFile(new URL("../../../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /startInstrumentedApplication/);
  assert.match(main, /import\("\.\/application-bootstrap\.js"\)/);
  assert.ok(!main.includes('from "./app.module.js"'));
  const legacy = await readFile(new URL("../../../src/tracing.ts", import.meta.url), "utf8");
  assert.ok(!legacy.includes("new NodeSDK"));
});

test("export projection drops sensitive attributes, raw names, exceptions, links and resources", async () => {
  const exporter = new InMemorySpanExporter();
  const safe = new SafeSpanExporter(exporter, "zyon-api");
  const sdk = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(safe)] });
  try {
    const span = sdk.getTracer("PRIVATE_LIBRARY").startSpan("GET /PRIVATE_EMAIL@example.com", { attributes: { "http.url": "https://PRIVATE", "db.statement": "PRIVATE_SQL", "gen_ai.prompt": "PRIVATE_PROMPT", "storefront.outcome": "ok", "gen_ai.usage.input_tokens": 20 } });
    span.recordException(new Error("PRIVATE_EXCEPTION")); span.setStatus({ code: 2, message: "PRIVATE_REASON" }); span.end();
    await sdk.forceFlush();
    const spans = exporter.getFinishedSpans();
    assert.equal(spans.length, 1);
    assert.equal(spans[0].attributes["gen_ai.usage.input_tokens"], 20);
    assert.ok(!JSON.stringify(spans.map(s => ({ name: s.name, attributes: s.attributes, events: s.events, links: s.links, status: s.status, resource: s.resource.attributes, scope: s.instrumentationScope }))).includes("PRIVATE"));
  } finally { await sdk.shutdown(); }
});

test("production SDK factory explicitly disables incidental logs/metrics exporters and detection", async () => {
  const source = await readFile(new URL("../../../src/shared/observability/tracing-sdk.ts", import.meta.url), "utf8");
  for (const setting of ["logRecordProcessors: []", "metricReaders: []", "autoDetectResources: false", "resourceDetectors: []"])
    assert.ok(source.includes(setting));
});

test("partial SDK start failure is cleaned up once", async () => {
  let closed = 0;
  const { runtime, logs } = fixture({ start: () => { throw new Error("PRIVATE_START"); }, shutdown: async () => { closed++; } });
  assert.equal((await runtime.init(env)).status, "failed"); await runtime.shutdown();
  assert.equal(closed, 1); assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
});

test("lifecycle logger failure cannot turn tracing into an application failure", async () => {
  const runtime = new TracingRuntime({ createSdk: async () => ({ start: () => {}, forceFlush: async () => {}, shutdown: async () => {} }), log: () => { throw new Error("PRIVATE_LOG"); } });
  assert.equal((await runtime.init(env)).status, "running"); await runtime.shutdown();
});

test("invalid service names cannot become resource identifiers", () => {
  assert.equal(resolveTracingConfig({ ...env, OTEL_SERVICE_NAME: "PRIVATE_EMAIL@example.com" }).status, "disabled");
});

test("exporter failures are normalized before returning to SDK diagnostics", () => {
  const outputs: unknown[] = [];
  const safe = new SafeSpanExporter({ export: (_spans, done) => { done({ code: 1, error: new Error("PRIVATE_EXPORTER_ERROR") }); done({ code: 0 }); }, shutdown: async () => {} }, "zyon-api");
  safe.export([], result => outputs.push({ code: result.code, error: result.error?.message }));
  assert.deepEqual(outputs, [{ code: 1, error: "tracing_export_failed" }]);
});

test("synchronously throwing exporter reports one bounded error", () => {
  let called = 0;
  const safe = new SafeSpanExporter({ export: () => { throw new Error("PRIVATE_URL"); }, shutdown: async () => {} }, "zyon-api");
  safe.export([], result => { called++; assert.equal(result.error?.message, "tracing_export_failed"); });
  assert.equal(called, 1);
});

for (const ratio of [0, 1]) {
  test(`actual NodeSDK factory with in-memory exporter honors ratio=${ratio} and flushes before shutdown`, async () => {
    const resolved = resolveTracingConfig({ ...env, OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: String(ratio) });
    assert.equal(resolved.status, "enabled"); if (resolved.status !== "enabled") return;
    const exporter = new InMemorySpanExporter();
    const handle = await createTracingSdk(resolved.config, exporter);
    try {
      await handle.start();
      const span = trace.getTracer("PRIVATE_LIBRARY").startSpan("storefront.provider", { attributes: { "gen_ai.usage.input_tokens": 12, "storefront.tool": "get_cart", "gen_ai.prompt": "PRIVATE_PROMPT" } }, ROOT_CONTEXT);
      span.end(); await handle.forceFlush();
      const spans = exporter.getFinishedSpans();
      assert.equal(spans.length, ratio);
      if (ratio === 1) {
        assert.equal(spans[0].attributes["storefront.tool"], "get_cart");
        assert.deepEqual(Object.keys(spans[0].resource.attributes), ["service.name"]);
        assert.ok(!JSON.stringify(spans[0].attributes).includes("PRIVATE"));
      }
    } finally { await handle.shutdown(); trace.disable(); context.disable(); propagation.disable(); }
  });
}

test("real Nest application close awaits lifecycle provider", async () => {
  const order: string[] = [];
  @Module({ providers: [TracingLifecycle, { provide: TRACING_RUNTIME, useValue: { shutdown: async () => { await Promise.resolve(); order.push("flushed"); } } }] })
  class LifecycleFixture {}
  const app = await NestFactory.createApplicationContext(LifecycleFixture, { logger: false, abortOnError: false });
  await app.close(); order.push("closed");
  assert.deepEqual(order, ["flushed", "closed"]);
});

test("actual ESM main entrypoint evaluates application only after env and tracing", () => {
  const api = fileURLToPath(new URL("../../../", import.meta.url));
  const result = spawnSync(process.execPath, ["--loader", "./tests/ready-prod-loader.mjs", "--loader", "./tests/tracing-bootstrap-probe-loader.mjs", "./src/main.ts"], { cwd: api, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ["env", "env", "trace", "application_import", "application_start"]);
});

test("actual OTLP HTTP export reaches loopback once with a sanitized payload", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("OTEL_")));
  for (const key of Object.keys(saved)) delete process.env[key];
  const requests: Array<{ url?: string; body: string }> = [];
  const receiver = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8"); req.on("data", chunk => { body += chunk; });
    req.on("end", () => { requests.push({ url: req.url, body }); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  });
  let handle: TracingSdkHandle | undefined;
  try {
    await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
    const resolved = resolveTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`, OTEL_TRACES_SAMPLER: "always_on" });
    assert.equal(resolved.status, "enabled"); if (resolved.status !== "enabled") return;
    handle = await createTracingSdk(resolved.config);
    await handle.start();
    const span = trace.getTracer("PRIVATE_SOURCE").startSpan("storefront.provider", { attributes: { "gen_ai.usage.input_tokens": 9, "http.url": "https://PRIVATE_EMAIL@example.com", "gen_ai.prompt": "PRIVATE_PROMPT" } }, ROOT_CONTEXT);
    span.recordException(new Error("PRIVATE_EXCEPTION")); span.end();
    await handle.forceFlush();
    assert.equal(requests.length, 1); assert.equal(requests[0].url, "/v1/traces");
    const payload = JSON.parse(requests[0].body);
    assert.ok(payload.resourceSpans?.length);
    assert.match(requests[0].body, /gen_ai.usage.input_tokens/);
    assert.ok(!requests[0].body.includes("PRIVATE"));
  } finally {
    await handle?.shutdown(); trace.disable(); context.disable(); propagation.disable();
    await new Promise<void>(resolve => receiver.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (key.startsWith("OTEL_")) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("tracing initialization failure does not prevent lazy application startup", async () => {
  let started = 0;
  const runtime = new TracingRuntime({ createSdk: async () => { throw new Error("PRIVATE_SDK_FAILURE"); } });
  await startInstrumentedApplication({ loadEnvironment: () => {}, initTracing: () => runtime.init(env),
    loadApplication: async () => { started++; }, shutdownTracing: () => runtime.shutdown() });
  assert.equal(started, 1); await runtime.shutdown();
});

test("legacy tracing module reuses facade without initialization side effects", async () => {
  const current = await import("./tracing.js");
  const before = process.listenerCount("SIGTERM");
  const legacy = await import("../../tracing.js");
  assert.equal(legacy.initTracing, current.initTracing);
  assert.equal(legacy.shutdownTracing, current.shutdownTracing);
  assert.equal(process.listenerCount("SIGTERM"), before);
});

