import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { assertObservabilityEnvironment } from "./observability-harness-lifecycle.mjs";

// Explicit test worker only. No AppModule, dotenv, database or provider client.
assertObservabilityEnvironment([new URL("../../../.env", import.meta.url), new URL("../.env", import.meta.url),
  new URL("../../../infra/observability/.env", import.meta.url)]);
for (const key of ["DATABASE_URL", "DIRECT_URL", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY",
  "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "HTTP_PROXY", "HTTPS_PROXY"])
  assert.equal(process.env[key], undefined, "application_observation_worker_environment_not_clean");
const [runId, receiver, ...extra] = process.argv.slice(2);
assert.match(runId ?? "", /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
assert.equal(extra.length, 0, "unexpected_application_worker_arguments");
const endpoint = new URL(receiver);
assert.ok(endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1" && Number(endpoint.port) > 0
  && endpoint.pathname === "/v1/traces" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,
"owned_loopback_otlp_receiver_required");

// Initialize the REAL SDK before loading application observation/logger modules.
const { createTracingSdk } = await import("../src/shared/observability/tracing-sdk.ts");
const sdk = await createTracingSdk({ endpoint: endpoint.href, serviceName: "zyon-api", sampler: "always_on", sampleRatio: 1, autoInstrumentation: false });
await sdk.start();
let result, primary;
try {
  const [{ StorefrontObserver, observeStorefrontOperation, observeStorefrontChat, recordStorefrontDecision },
    { MetricsService }, { createHttpLoggerOptions }, { CorrelationIdStorage }, { trace }, { default: pino }] = await Promise.all([
    import("../src/modules/storefront/infrastructure/observability/storefront-observation.ts"),
    import("../src/shared/observability/metrics.service.ts"), import("../src/shared/logger/http-logger.config.ts"),
    import("../src/shared/logger/correlation-id.storage.ts"), import("@opentelemetry/api"), import("pino"),
  ]);
  const metrics = new MetricsService(), observations = [], logLines = [];
  const sink = new Writable({ write(chunk, _encoding, done) { logLines.push(chunk.toString("utf8").trim()); done(); } });
  const logger = pino(createHttpLoggerOptions({ NODE_ENV: "production", LOG_LEVEL: "info" }), sink);
  const observer = new StorefrontObserver({ enabled: true, metrics, record: observation => {
    observations.push(observation);
    logger.info({ event: "storefront.observation", ...observation, prompt: "PRIVATE_APPLICATION_PROMPT",
      customer: { email: "PRIVATE_APPLICATION_EMAIL" } }, "PRIVATE_APPLICATION_RAW_MESSAGE");
  } });
  let fakeProviderCalls = 0;
  await CorrelationIdStorage.run(runId, () => observer.turn(async () => {
    await observeStorefrontOperation("validation", async () => {
      recordStorefrontDecision("validation", "rejected", "invalid_input", { boundary: "input" });
    }, { boundary: "input" });
    await observeStorefrontChat({ chat: async () => {
      fakeProviderCalls++;
      trace.getActiveSpan()?.setAttribute("gen_ai.prompt", "PRIVATE_APPLICATION_SPAN_PROMPT");
      return { content: "PRIVATE_APPLICATION_FAKE_REPLY", usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 } };
    } }, { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "PRIVATE_APPLICATION_BUYER_PROMPT" }] }, "primary", "main");
  }), runId);
  await sdk.forceFlush();
  const provider = observations.find(value => value.kind === "operation" && value.stage === "provider");
  assert.match(provider?.traceId ?? "", /^[a-f0-9]{32}$/);
  result = { runId, traceId: provider.traceId, fakeProviderCalls, observations, logLines, metrics: await metrics.getMetrics(),
    realApplicationInstrumentation: true, autoInstrumentation: false, realProviderCalls: 0 };
} catch (error) { primary = error; }
finally {
  try { await sdk.shutdown(); } catch (error) { primary = primary ? new AggregateError([primary, error], "application_sdk_and_shutdown_failed") : error; }
}
if (primary) throw primary;
process.stdout.write(JSON.stringify(result));
