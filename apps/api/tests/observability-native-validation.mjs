import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { assertObservabilityEnvironment, localObservabilityDocker, runOwnedDockerValidation,
  removeOwnedDockerContainer, finishChild } from "./observability-harness-lifecycle.mjs";

// Explicit/manual Docker validation only. Normal contract tests never start Docker.
// Images must already be present: no implicit pull, daemon changes, network or stack.
const infra = fileURLToPath(new URL("../../../infra/observability/", import.meta.url));
assertObservabilityEnvironment([new URL("../../../.env", import.meta.url), new URL("../.env", import.meta.url), new URL("../../../infra/observability/.env", import.meta.url)]);
const alloy = "grafana/alloy:v1.20.1", prometheus = "prom/prometheus:v3.4.0";
const mount = (source, target) => ["--mount", `type=bind,source=${source},target=${target},readonly`];
const { docker, context: dockerContext, env } = localObservabilityDocker();
const owner = `storefront-artifacts-${randomUUID()}`;
const validate = args => runOwnedDockerValidation(docker, args, { name: `aacp-obsv-validator-${randomUUID()}`, owner });
for (const image of [alloy, prometheus]) docker(["image", "inspect", image]);
docker(["compose", "-f", `${infra}/docker-compose.yml`, "config", "--quiet"]);
validate([...mount(`${infra}/alloy`, "/etc/alloy"), alloy, "validate", "/etc/alloy/config.alloy"]);
validate(["--entrypoint", "/bin/promtool", ...mount(`${infra}/prometheus`, "/etc/prometheus"), prometheus, "check", "config", "/etc/prometheus/prometheus.yml"]);

const dashboard = JSON.parse(readFileSync(`${infra}/grafana/dashboards/storefront-llm.json`, "utf8"));
const queries = dashboard.panels.filter(panel => panel.datasource?.uid === "prometheus").flatMap(panel => panel.targets.map(target => target.expr));
for (const query of queries) validate(["--entrypoint", "/bin/promtool", prometheus,
  "--experimental", "promql", "format", query.replaceAll("$environment", "development").replaceAll("$__rate_interval", "1m").replaceAll("$__range", "6h")]);

const name = `aacp-obsv-validation-${randomUUID()}`;
const label = `com.zyon.validation=${owner}`;
const config = `
logging {
  level = "info"
  format = "json"
}
import.file "managed" { filename = "/workspace/alloy/managed.alloy" }
loki.echo "capture" {}
managed.managed_logs "test" { forward_to = [loki.echo.capture.receiver] }
loki.source.file "fixture" {
  targets = [{"__path__" = "/workspace/tests/fixtures/managed-logs.jsonl", "service" = "zyon-api", "environment" = "test", "job" = "storefront-api"}]
  forward_to = [managed.managed_logs.test.receiver]
}
`;
let output = "", childClosed = false, validationError;
const child = spawn("docker", ["--context", dockerContext, "run", "--rm", "--pull=never", "--name", name, "--label", label, "--network", "none",
  "--read-only", "--memory", "256m", "--cpus", "1", "--pids-limit", "128", "--tmpfs", "/tmp", "--cap-drop=ALL", "--security-opt", "no-new-privileges", "-i", ...mount(infra, "/workspace"), alloy,
  "run", "--disable-reporting", "--server.http.listen-addr=127.0.0.1:12345", "--storage.path=/tmp/validation", "/dev/stdin"],
  { windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"] });
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });
child.once("close", () => { childClosed = true; });
// Stop only the exact uniquely named container created by this harness, after
// verifying its ownership label. No host files, services or volumes are removed.
const stop = () => {
  const [container] = JSON.parse(docker(["inspect", name]));
  assert.equal(container.Name, `/${name}`); assert.equal(container.Config.Labels["com.zyon.validation"], owner);
  assert.match(container.Id, /^[a-f0-9]{64}$/);
  docker(["stop", "-t", "1", container.Id]);
};
try {
  await new Promise((resolve, reject) => {
    let stopping = false;
    const interval = setInterval(() => {
      if (!stopping && output.includes("66666666-6666-4666-8666-666666666666")) {
        stopping = true;
        try { stop(); } catch (error) { cleanup(); reject(error); }
      }
    }, 100);
    const cleanup = () => { clearInterval(interval); clearTimeout(timeout); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("alloy_fixture_timeout")); }, 15_000);
    child.once("error", error => { cleanup(); reject(error); });
    child.stdin.once("error", error => { cleanup(); reject(error); });
    child.once("close", code => { cleanup(); code === 0 ? resolve() : reject(new Error(`alloy_fixture_exit_${code}`)); });
    child.stdin.end(config);
  });
  assert.ok(!output.includes("PRIVATE"), "a private fixture canary reached collector output");
  const lines = output.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  // loki.echo emits one JSON entry per line. Check actual native output, not a JS
  // reimplementation of Go template/Alloy semantics.
  const entries = lines.filter(line => line.msg === "received log entry" && typeof line.entry === "string")
    .map(line => ({ envelope: line, record: JSON.parse(line.entry) }));
  assert.equal(entries.length, 4, `expected four projected native entries, got ${entries.length}`);
  const record = entries.find(value => value.record.requestId === "11111111-1111-4111-8111-111111111111")?.record;
  assert.ok(record); assert.equal(record.traceId, "a".repeat(32)); assert.equal(record.trace_id, record.traceId);
  assert.equal(record.spanId, "b".repeat(16)); assert.equal(record.stage, "provider"); assert.equal(record.level, "info");
  const legacy = entries.find(value => value.record.requestId === "44444444-4444-4444-8444-444444444444")?.record;
  assert.equal(legacy.traceId, "c".repeat(32)); assert.equal(legacy.kind, undefined); assert.equal(legacy.statusCode, 500);
  const noTrace = entries.find(value => value.record.event === "http.exception")?.record;
  assert.equal(noTrace.traceId, undefined); assert.equal(noTrace.requestId, undefined);
  const first = entries.find(value => value.record === record).envelope;
  assert.ok(first.structured_metadata.includes(record.requestId));
  assert.ok(first.structured_metadata.includes("trace_id"));
  assert.equal(first.entry_timestamp, "2026-10-17T12:00:00.123Z");
  for (const { envelope } of entries) {
    const labels = [...envelope.labels.matchAll(/(?:^|[, {])([a-z_]+)=/g)].map(match => match[1]).sort();
    assert.deepEqual(labels, ["environment", "job", "level", "service"]);
  }
  for (const { record } of entries) assert.ok(!Object.hasOwn(record, "msg"));
} catch (error) { validationError = error;
} finally {
  const errors = validationError ? [validationError] : [];
  try { removeOwnedDockerContainer(docker, name, owner); } catch (error) { errors.push(error); }
  try { if (!childClosed) await finishChild(child); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "observability_native_validation_cleanup_failed");
}
console.log(JSON.stringify({ status: "passed", compose: true, alloyValidate: true, prometheusConfig: true, promqlQueries: queries.length,
  nativeProjectedEntries: 4, privateCanariesAbsent: true, network: "none", serviceStackStarted: false, ownedCleanupVerified: true }));
