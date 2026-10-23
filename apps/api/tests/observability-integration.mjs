import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as pause } from "node:timers/promises";
import { syntheticLog, syntheticTrace } from "../../../infra/observability/tests/synthetic-fixtures.mjs";
import { createLoopbackRelay } from "./observability-loopback-relay.mjs";
import { assertObservabilityEnvironment, localObservabilityDocker, observabilityTestEnvironment,
  removeOwnedDockerContainer, removeOwnedDockerNetwork, observabilityServiceLimits, observabilityLogSourceLabels } from "./observability-harness-lifecycle.mjs";

// Explicit integration command only. Cached images, internal network, scratch
// tmpfs databases, read-only config mounts, loopback random ports. No live API.
const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve("eslint"))("yaml");
const { chromium } = require("playwright");
const infra = fileURLToPath(new URL("../../../infra/observability/", import.meta.url));
assertObservabilityEnvironment([new URL("../../../.env", import.meta.url), new URL("../.env", import.meta.url), new URL("../../../infra/observability/.env", import.meta.url)]);
const { docker, context: dockerContext } = localObservabilityDocker();
const images = {
  grafana: "grafana/grafana:11.6-ubuntu", prometheus: "prom/prometheus:v3.4.0",
  loki: "grafana/loki:3.4.3", tempo: "grafana/tempo:2.7.2",
  alloy: "grafana/alloy:v1.20.1", fixture: "node:24-bookworm-slim",
};
// Fail before creating anything if prerequisites are missing; never implicit pull.
for (const image of Object.values(images)) docker(["image", "inspect", image]);
await (await chromium.launch({ headless: true, env: observabilityTestEnvironment(process.env) })).close();
const id = randomUUID(), prefix = `zyon-obsv-integration-${id}`, network = `${prefix}-net`;
const labelKey = "com.zyon.validation", owner = `synthetic-${id}`, containers = [];
const tempBase = resolve(tmpdir());
const scratch = mkdtempSync(join(tempBase, "zyon-obsv-config-"));
const evidence = mkdtempSync(join(tempBase, "zyon-obsv-evidence-"));
const password = randomUUID(), auth = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
let browser, page, relay, networkCreateAttempted = false;
const result = { status: "running", syntheticOnly: true, network: "internal", panels: 0, queries: 0, browserApiErrors: [],
  serviceLimitMiB: 256, maxServiceLimitMiB: 1536 };
const mount = (source, target) => ["--mount", `type=bind,source=${source},target=${target},readonly`];
const report = stage => console.log(JSON.stringify({ stage }));
async function request(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000), ...options });
  const body = await response.text();
  assert.ok(response.ok, `HTTP ${response.status} ${new URL(url).pathname}: ${body.slice(0, 500)}`);
  return body ? (response.headers.get("content-type")?.includes("json") ? JSON.parse(body) : body) : undefined;
}
const post = (url, body, headers = {}) => request(url, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
async function eventually(check, label, timeout = 90_000) {
  const end = Date.now() + timeout;
  let last;
  do {
    try { return await check(); } catch (error) { last = error; }
    await pause(500);
  } while (Date.now() < end);
  throw new Error(`${label}: ${last?.message}`);
}
async function start(service, ports, args) {
  const name = `${prefix}-${service}`;
  // Track before run so a Docker client timeout cannot orphan an owned service.
  containers.push(name);
  docker(["run", "-d", "--pull=never", "--name", name, "--label", `${labelKey}=${owner}`,
    "--network", network, "--network-alias", service, "--read-only", "--cap-drop=ALL",
    "--security-opt", "no-new-privileges", ...observabilityServiceLimits(),
    "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777,size=128m",
    ...args]);
  const inspection = JSON.parse(docker(["inspect", name]))[0];
  assert.equal(inspection.Config.Labels[labelKey], owner);
  assert.equal(inspection.Name, `/${name}`); assert.match(inspection.Id, /^[a-f0-9]{64}$/);
  assert.equal(inspection.HostConfig.Memory, 256 * 1024 * 1024);
  assert.equal(inspection.HostConfig.PidsLimit, 256);
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
  assert.ok(Object.values(inspection.Mounts).every(value => value.Type !== "volume"));
  assert.ok(!Object.values(inspection.NetworkSettings.Ports ?? {}).some(value => value?.length));
  return Object.fromEntries(await Promise.all(ports.map(async port => [port, await relay.expose(`${service}:${port}`)])));
}

try {
  report("prepare-isolated-config");
  const provisioning = join(scratch, "provisioning");
  cpSync(join(infra, "grafana/provisioning"), provisioning, { recursive: true });
  const sourceFile = join(provisioning, "datasources/datasources.yml");
  const originalSources = readFileSync(sourceFile, "utf8");
  // Simulate the old name-matched datasource with an unrelated stable UID in a
  // fresh disposable database, never an existing Grafana installation.
  const legacySources = parse(originalSources);
  legacySources.datasources.find(value => value.name === "Prometheus").uid = "synthetic-legacy-prometheus";
  writeFileSync(sourceFile, JSON.stringify(legacySources));
  const promConfig = join(scratch, "prometheus.yml");
  writeFileSync(promConfig, JSON.stringify({ global: { scrape_interval: "2s" }, scrape_configs: [{
    job_name: "aacp-api", metrics_path: "/metrics", static_configs: [{
      targets: ["fixture:8080"], labels: { service: "zyon-api", environment: "development" },
    }],
  }, { job_name: "aacp-application-instrumentation", metrics_path: "/application-metrics", static_configs: [{
    targets: ["fixture:8080"], labels: { service: "zyon-api", environment: "application-test" },
  }] }] }));
  const alloyConfig = join(scratch, "integration.alloy");
  writeFileSync(alloyConfig, `
logging { level = "warn" }
import.file "managed" { filename = "/workspace/alloy/managed.alloy" }
loki.write "test" { endpoint { url = "http://loki:3100/loki/api/v1/push" } }
managed.managed_logs "test" { forward_to = [loki.write.test.receiver] }
loki.source.api "synthetic" {
  http {
    listen_address = "0.0.0.0"
    listen_port = 9999
  }
  labels = { ${Object.entries(observabilityLogSourceLabels()).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ")} }
  forward_to = [managed.managed_logs.test.receiver]
}
`);
  networkCreateAttempted = true;
  docker(["network", "create", "--internal", "--label", `${labelKey}=${owner}`, network]);
  const net = JSON.parse(docker(["network", "inspect", network]))[0]; assert.equal(net.Internal, true);
  await start("fixture", [], [...mount(join(infra, "tests"), "/fixture"), images.fixture, "node", "/fixture/synthetic-server.mjs"]);
  relay = await createLoopbackRelay(`${prefix}-fixture`, { dockerContext });
  const prom = (await start("prometheus", [9090], ["--tmpfs", "/prometheus:rw,mode=1777,size=128m",
    ...mount(promConfig, "/etc/prometheus/prometheus.yml"), images.prometheus,
    "--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.retention.time=1h"]))[9090];
  const loki = (await start("loki", [3100], ["--tmpfs", "/loki:rw,mode=1777,size=128m",
    ...mount(join(infra, "loki/loki.yml"), "/etc/loki/loki.yml"), images.loki, "-config.file=/etc/loki/loki.yml"]))[3100];
  const tempo = await start("tempo", [3200, 4318], ["--tmpfs", "/var/tempo:rw,mode=1777,size=128m",
    ...mount(join(infra, "tempo/tempo.yml"), "/etc/tempo/tempo.yml"), images.tempo,
    "-config.file=/etc/tempo/tempo.yml", "-reporting.enabled=false"]);
  const alloy = (await start("alloy", [9999], [...mount(infra, "/workspace"), ...mount(alloyConfig, "/etc/alloy/integration.alloy"),
    images.alloy, "run", "--disable-reporting", "--storage.path=/tmp/alloy", "/etc/alloy/integration.alloy"]))[9999];
  const grafana = (await start("grafana", [3000], ["--tmpfs", "/var/lib/grafana:rw,mode=1777,size=256m",
    "--tmpfs", "/var/log/grafana:rw,mode=1777,size=32m",
    ...mount(provisioning, "/etc/grafana/provisioning"), ...mount(join(infra, "grafana/dashboards"), "/var/lib/grafana/dashboards"),
    "-e", "GF_SECURITY_ADMIN_USER=admin", "-e", `GF_SECURITY_ADMIN_PASSWORD=${password}`,
    "-e", "GF_AUTH_ANONYMOUS_ENABLED=false", "-e", "GF_ANALYTICS_REPORTING_ENABLED=false",
    "-e", "GF_ANALYTICS_CHECK_FOR_UPDATES=false", "-e", "GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false",
    "-e", "GF_PLUGINS_PREINSTALL_DISABLED=true", images.grafana]))[3000];
  const grafanaGet = path => request(`${grafana}${path}`, { headers: { authorization: auth } });
  await eventually(() => request(`${grafana}/api/health`), "Grafana ready");
  report("datasource-uid-migration");
  assert.equal((await eventually(() => grafanaGet("/api/datasources/name/Prometheus"), "legacy datasource read")).uid, "synthetic-legacy-prometheus");
  writeFileSync(sourceFile, originalSources);
  await post(`${grafana}/api/admin/provisioning/datasources/reload`, {}, { authorization: auth });
  const sources = await grafanaGet("/api/datasources");
  assert.equal(sources.length, 3);
  assert.deepEqual(sources.map(value => value.uid).sort(), ["loki", "prometheus", "tempo"]);
  const tempoSource = sources.find(value => value.uid === "tempo"), lokiSource = sources.find(value => value.uid === "loki");
  assert.equal(lokiSource.jsonData.derivedFields[0].url, "${__value.raw}");
  assert.equal(tempoSource.jsonData.tracesToLogsV2.query, '{service="zyon-api"} | json | traceId="${__span.traceId}"');
  result.syntheticUidMigration = true;
  await eventually(() => request(`${loki}/ready`), "Loki ready");
  // /ready endpoints return plain text, unlike JSON APIs.
  report("synthetic-ingestion");
  await eventually(async () => {
    const response = await fetch(`${alloy}/ready`); assert.ok(response.ok);
  }, "Alloy ready");
  const traceId = randomBytes(16).toString("hex"), spanId = randomBytes(8).toString("hex"), time = Date.now();
  await eventually(() => post(`${tempo[4318]}/v1/traces`, syntheticTrace(traceId, spanId, time)), "OTLP receiver");
  const entry = syntheticLog(traceId, spanId, time);
  const logs = [JSON.stringify(entry), JSON.stringify({ ...entry, event: "unknown", prompt: "PRIVATE_SYNTHETIC_UNKNOWN" }), "PRIVATE_SYNTHETIC_NOT_JSON"];
  await post(`${alloy}/loki/api/v1/push`, { streams: [{ stream: { service: "zyon-api", environment: "development", job: "storefront-api" },
    values: logs.map((line, index) => [(BigInt(time + index) * 1_000_000n).toString(), line]),
  }] });
  const logQuery = `{service="zyon-api",environment="development"} | json | traceId="${traceId}"`;
  const queryLogs = query => request(`${loki}/loki/api/v1/query_range?${new URLSearchParams({ query, since: "5m", limit: "100" })}`);
  const logged = await eventually(async () => {
    const response = await queryLogs(logQuery); assert.equal(response.data.result.length, 1); return response;
  }, "projected Loki log");
  assert.ok(!JSON.stringify(logged).includes("PRIVATE_SYNTHETIC"));
  const allLogs = await queryLogs('{service="zyon-api"}');
  assert.ok(!JSON.stringify(allLogs).includes("PRIVATE_SYNTHETIC"));
  assert.equal(allLogs.data.result.flatMap(value => value.values).length, 1);
  const stream = logged.data.result[0];
  // JSON parser labels are query-time fields. The /series API below checks indexed labels.
  const record = JSON.parse(stream.values[0][1]); assert.equal(record.traceId, traceId);
  assert.equal(new RegExp(lokiSource.jsonData.derivedFields[0].matcherRegex).exec(stream.values[0][1])?.[1], traceId);
  const reverseQuery = tempoSource.jsonData.tracesToLogsV2.query.replace("${__span.traceId}", traceId);
  assert.equal((await queryLogs(reverseQuery)).data.result.flatMap(value => value.values).length, 1);
  result.provisionedTraceToLogsQuery = true;
  const series = await request(`${loki}/loki/api/v1/series?${new URLSearchParams({ "match[]": '{service="zyon-api"}' })}`);
  assert.deepEqual(Object.keys(series.data[0]).sort(), ["environment", "job", "level", "service"]);
  await eventually(async () => {
    const response = await request(`${tempo[3200]}/api/traces/${traceId}`, { headers: { accept: "application/json" } });
    assert.ok(JSON.stringify(response).includes("storefront.provider"));
  }, "Tempo trace readback");
  result.projectedLog = true; result.privateCanariesAbsent = true; result.traceReadback = true;

  report("real-application-sdk-observer-metrics");
  const application = await new Promise((resolve, reject) => {
    execFile(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
      "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
      fileURLToPath(new URL("./observability-application.worker.mjs", import.meta.url)), id, `${tempo[4318]}/v1/traces`],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env: observabilityTestEnvironment(process.env),
      timeout: 30000, maxBuffer: 2_000_000, windowsHide: true }, (error, stdout) => {
      if (error) { reject(new Error(error.killed ? "application_observation_worker_timeout" : "application_observation_worker_failed")); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("application_observation_worker_protocol_invalid")); }
    });
  });
  assert.equal(application.runId, id); assert.equal(application.fakeProviderCalls, 1); assert.equal(application.realProviderCalls, 0);
  assert.match(application.traceId, /^[a-f0-9]{32}$/); assert.equal(application.realApplicationInstrumentation, true);
  assert.equal(application.observations.length, 4);
  // Export only these existing application families, not unrelated legacy metrics.
  const applicationMetrics = application.metrics.split("\n").filter(line => line.startsWith("storefront_llm_")
    || /^# (?:HELP|TYPE) storefront_llm_/.test(line)).join("\n") + "\n";
  assert.ok(applicationMetrics.includes("storefront_llm_operations_total"));
  const fixture = await relay.expose("fixture:8080");
  await request(`${fixture}/application-metrics`, { method: "POST", headers: { "content-type": "text/plain" }, body: applicationMetrics });
  await post(`${alloy}/loki/api/v1/push`, { streams: [{ stream: { service: "zyon-api", environment: "application-test", job: "storefront-api" },
    values: application.logLines.map((line, index) => [(BigInt(Date.now() + index) * 1_000_000n).toString(), line]),
  }] });
  await eventually(async () => {
    const logs = await queryLogs(`{service="zyon-api",environment="application-test"} | json | traceId="${application.traceId}"`);
    const records = logs.data.result.flatMap(value => value.values).map(value => JSON.parse(value[1]));
    assert.equal(records.length, 4); assert.ok(!JSON.stringify(logs).includes("PRIVATE_APPLICATION"));
    assert.ok(records.every(record => record.requestId === id && record.traceId === application.traceId));
    return records;
  }, "real application projected Loki observations");
  await eventually(async () => {
    const trace = await request(`${tempo[3200]}/api/traces/${application.traceId}`, { headers: { accept: "application/json" } });
    const serialized = JSON.stringify(trace);
    for (const stage of ["turn", "validation", "provider"]) assert.ok(serialized.includes(`storefront.${stage}`));
    assert.ok(!serialized.includes("PRIVATE_APPLICATION"));
  }, "real SDK Tempo trace readback");
  await eventually(async () => {
    const query = 'storefront_llm_operations_total{environment="application-test",stage="provider",outcome="ok",reason="completed"}';
    const response = await request(`${prom}/api/v1/query?${new URLSearchParams({ query })}`);
    assert.equal(response.data.result.length, 1); assert.equal(Number(response.data.result[0].value[1]), 1);
  }, "real application Prometheus scrape");
  for (const [metric, expected] of [
    ['storefront_llm_decisions_total{stage="validation",outcome="rejected",reason="invalid_input"}', 1],
    ['storefront_llm_operation_duration_seconds_count{stage="provider"}', 1],
    ['storefront_llm_tokens_total{phase="main",provider="primary",kind="prompt"}', 12],
    ['storefront_llm_estimated_cost_usd_cents_total{phase="main",provider="primary"}', 0.00066],
  ]) {
    const query = metric.replace("{", '{environment="application-test",');
    await eventually(async () => {
      const response = await request(`${prom}/api/v1/query?${new URLSearchParams({ query })}`);
      assert.equal(response.data.result.length, 1); assert.ok(Math.abs(Number(response.data.result[0].value[1]) - expected) < 1e-12);
    }, "real application metric family readback");
  }
  result.realApplicationInstrumentation = { sdk: true, observer: true, metrics: true, productionLoggerOptions: true,
    otlpTempoReadback: true, projectedLokiReadback: true, prometheusReadback: true, observations: 4,
    fakeProviderCalls: 1, realProviderCalls: 0, autoInstrumentation: false };

  report("dashboard-and-query-api");
  const board = await eventually(async () => {
    const value = await grafanaGet("/api/dashboards/uid/storefront-llm-v1"); assert.equal(value.dashboard.panels.length, 10); return value;
  }, "provisioned dashboard");
  assert.equal(board.meta.provisioned, true); result.panels = 10;
  const replace = query => query.replaceAll("$environment", "development").replaceAll("$__rate_interval", "1m").replaceAll("$__range", "5m");
  const promPanels = board.dashboard.panels.filter(panel => panel.datasource.uid === "prometheus");
  for (const panel of promPanels) {
    const query = replace(panel.targets[0].expr);
    await eventually(async () => {
      const response = await request(`${prom}/api/v1/query?${new URLSearchParams({ query })}`);
      assert.equal(response.status, "success"); assert.ok(response.data.result.length > 0);
      for (const series of response.data.result) assert.ok(Number.isFinite(Number(series.value[1])) && Number(series.value[1]) > 0);
    }, `PromQL panel ${panel.id}`);
    const response = await post(`${grafana}/api/ds/query`, { from: String(Date.now() - 300_000), to: String(Date.now()), queries: [{
      ...panel.targets[0], expr: query, datasource: panel.datasource, instant: true, range: false,
      intervalMs: 1000, maxDataPoints: 300,
    }] }, { authorization: auth });
    assert.ok(!response.results.A.error); assert.ok(response.results.A.frames?.length > 0);
    result.queries++;
  }
  const absent = await request(`${prom}/api/v1/query?${new URLSearchParams({ query: replace(promPanels[1].targets[0].expr).replaceAll('environment="development"', 'environment="synthetic-empty"') })}`);
  assert.deepEqual(absent.data.result, []); result.absentSeriesNotZero = true;
  report("browser-ui");
  for (const name of containers) {
    const [container] = JSON.parse(docker(["inspect", name]));
    assert.equal(container.Config.Labels[labelKey], owner);
    assert.equal(container.State.OOMKilled, false); assert.equal(container.State.Running, true);
  }
  result.ownedMemoryBeforeBrowser = docker(["stats", "--no-stream", "--format", "{{json .}}", ...containers]).trim().split("\n").map(line => {
    const value = JSON.parse(line); return { name: value.Name, usage: value.MemUsage, percent: value.MemPerc };
  });
  browser = await chromium.launch({ headless: true, env: observabilityTestEnvironment(process.env) });
  // Fit every panel so Grafana's viewport-based lazy loading is exercised, not
  // mistaken for a missing provisioned panel below the fold.
  const context = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
  const blocked = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === grafana) return route.continue();
    blocked.push(url.origin); return route.abort();
  });
  page = await context.newPage();
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/") && response.status() >= 400 && result.browserApiErrors.length < 20)
      result.browserApiErrors.push({ path, status: response.status() });
  });
  await page.goto(`${grafana}/login`);
  await page.getByLabel("Email or username").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill(password);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === "/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  assert.equal((await login).status(), 200, "synthetic Grafana login rejected");
  assert.ok((await context.cookies()).some(cookie => cookie.name === "grafana_session"), "session cookie missing from test relay");
  await page.waitForURL(url => !url.pathname.includes("login"));
  // CSRF applies to the browser cookie session, not the Basic-auth API client.
  const csrf = await context.request.post(`${grafana}/api/ds/query`, {
    headers: { origin: "https://untrusted.invalid" }, data: { queries: [] },
  });
  assert.equal(csrf.status(), 403); result.csrfForeignOriginRejected = true;
  report("browser-dashboard");
  await page.goto(`${grafana}/d/storefront-llm-v1?from=now-5m&to=now&var-environment=development`);
  for (const panel of board.dashboard.panels) await page.getByText(panel.title, { exact: true }).first().waitFor();
  await eventually(async () => {
    const text = await page.locator("body").innerText();
    assert.ok(!text.includes("Panel plugin not found")); assert.ok(text.includes("Scrape respondeu"));
  }, "dashboard rendered data");
  await page.screenshot({ path: join(evidence, "dashboard.png"), fullPage: true });
  result.browserDashboard = true;
  // Explore uses the same provisioned UIDs; readback verifies the actual backends.
  const left = JSON.stringify({ datasource: "loki", queries: [{ refId: "A", expr: logQuery, queryType: "range" }], range: { from: "now-5m", to: "now" } });
  await page.goto(`${grafana}/explore?orgId=1&left=${encodeURIComponent(left)}`);
  await page.getByRole("button", { name: "See log details", exact: true }).first().click();
  await page.getByText("View Trace", { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByText("View Trace", { exact: true }).first().click();
  await page.getByText("storefront.provider", { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(evidence, "trace-from-log.png"), fullPage: true });
  result.browserLogToTrace = true;
  await context.close();
  result.blockedBrowserOrigins = blocked.length;
  result.status = "passed";
} catch (error) {
  result.status = "failed"; result.error = String(error.message).replaceAll(password, "[redacted]");
  if (page && !page.isClosed()) {
    try {
      await page.screenshot({ path: join(evidence, "failure.png"), fullPage: true, timeout: 5000 });
      writeFileSync(join(evidence, "failure-body.txt"), (await page.locator("body").innerText()).slice(0, 15_000));
    } catch {}
  }
  // Bound diagnostics to this harness's named resources; never enumerate logs.
  for (const name of containers) {
    try {
      const info = JSON.parse(docker(["inspect", name]))[0];
      if (info.Config.Labels[labelKey] === owner && !info.State.Running)
        console.error(`${name}: ${docker(["logs", "--tail", "15", name]).slice(-3000)}`);
    } catch {}
  }
  throw new Error(result.error);
} finally {
  const cleanupErrors = [];
  try { await browser?.close(); } catch { cleanupErrors.push("browser_cleanup_failed"); }
  try { await relay?.close(); } catch { cleanupErrors.push("relay_cleanup_failed"); }
  for (const name of containers.reverse()) {
    try { removeOwnedDockerContainer(docker, name, owner); } catch (error) { cleanupErrors.push(`${name}: ${error.message}`); }
  }
  if (networkCreateAttempted) {
    try { removeOwnedDockerNetwork(docker, network, owner); } catch (error) { cleanupErrors.push(`${network}: ${error.message}`); }
  }
  // Only this mkdtemp configuration directory can be recursively removed.
  assert.equal(dirname(resolve(scratch)), tempBase);
  assert.ok(resolve(scratch).startsWith(`${tempBase}${sep}zyon-obsv-config-`));
  rmSync(scratch, { recursive: true });
  result.cleanupErrors = cleanupErrors;
  if (cleanupErrors.length) { result.status = "failed"; process.exitCode = 1; }
  writeFileSync(join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence }));
}
