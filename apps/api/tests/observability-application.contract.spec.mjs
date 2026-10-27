import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { observabilityTestEnvironment } from "./observability-harness-lifecycle.mjs";

const exec = promisify(execFile);
const api = fileURLToPath(new URL("../", import.meta.url));
const worker = fileURLToPath(new URL("./observability-application.worker.mjs", import.meta.url));
const args = ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
  "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href, worker];

test("synthetic receiver stores application metrics separately and does not fabricate healthy values before ingestion", async () => {
  const fixture = await import("../../../infra/observability/tests/synthetic-server.mjs");
  assert.equal(typeof fixture.createSyntheticServer, "function");
  const server = fixture.createSyntheticServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/application-metrics`;
  try {
    assert.equal((await (await fetch(url)).text()).includes("storefront_llm_operations_total"), false);
    const metrics = 'storefront_llm_operations_total{stage="turn",outcome="ok",reason="completed"} 1\n';
    assert.equal((await fetch(url, { method: "POST", body: metrics })).status, 204);
    assert.equal(await (await fetch(url)).text(), metrics);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("real application SDK, observer, metrics and logger reach a loopback OTLP receiver without a provider", async () => {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const runId = randomUUID();
    const { stdout } = await exec(process.execPath, [...args, runId, `http://127.0.0.1:${server.address().port}/v1/traces`],
      { cwd: api, env: observabilityTestEnvironment(process.env), timeout: 20000, windowsHide: true, maxBuffer: 2_000_000 });
    const result = JSON.parse(stdout);
    assert.equal(result.runId, runId); assert.equal(result.fakeProviderCalls, 1);
    assert.equal(result.observations.length, 4); // Three operations and one decision.
    assert.equal(result.logLines.length, 4);
    assert.match(result.metrics, /storefront_llm_operations_total\{stage="provider",outcome="ok",reason="completed"\} 1/);
    assert.match(result.metrics, /storefront_llm_tokens_total\{phase="main",provider="primary",kind="prompt"\} 12/);
    assert.match(result.metrics, /storefront_llm_tokens_total\{phase="main",provider="primary",kind="completion"\} 8/);
    assert.ok(received.length > 0); assert.ok(received.every(value => value.path === "/v1/traces"));
    const spans = received.flatMap(value => value.body.resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans)));
    assert.deepEqual(spans.map(span => span.name).sort(), ["storefront.provider", "storefront.turn", "storefront.validation"]);
    assert.ok(spans.some(span => span.traceId === result.traceId));
    assert.equal(JSON.stringify(received).includes("PRIVATE_APPLICATION"), false);
    assert.equal(JSON.stringify(result.logLines).includes("PRIVATE_APPLICATION"), true, "collector must still be challenged with raw private fixture canaries");
    assert.equal(result.observations.every(value => value.traceId === result.traceId), true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("application worker refuses non-loopback receivers before any application SDK is loaded", async () => {
  await assert.rejects(exec(process.execPath, [...args, randomUUID(), "https://forbidden.invalid/v1/traces"],
    { cwd: api, env: observabilityTestEnvironment(process.env), timeout: 10000, windowsHide: true }),
    error => error.stderr.includes("owned_loopback_otlp_receiver_required"));
});
