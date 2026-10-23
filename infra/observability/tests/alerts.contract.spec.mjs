import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildAlertTests, alertNames } from "./alert-fixtures.mjs";

const require = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
const { parse } = createRequire(require.resolve("eslint"))("yaml");
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const rules = () => parse(read("prometheus/rules/storefront-local.yml")).groups[0].rules;

test("local alerts have exact bounded identities and only existing metric producers", () => {
  const definitions = rules();
  assert.deepEqual(definitions.map(rule => rule.alert), alertNames);
  const allowed = new Set(["storefront_llm_decisions_total", "storefront_llm_operations_total",
    "storefront_llm_operation_duration_seconds_bucket", "storefront_llm_operation_duration_seconds_count", "up"]);
  const metrics = readFileSync(new URL("../../../apps/api/src/shared/observability/metrics.service.ts", import.meta.url), "utf8");
  for (const rule of definitions) {
    assert.deepEqual(Object.keys(rule.labels).sort(), ["evaluation", "scope", "severity"]);
    assert.equal(rule.labels.scope, "storefront");
    assert.equal(rule.labels.evaluation, "local");
    assert.ok(["warning", "critical"].includes(rule.labels.severity));
    const referenced = [...rule.expr.matchAll(/\b(storefront_\w+|up)(?=\{)/g)].map(match => match[1]);
    assert.ok(referenced.length > 0);
    for (const metric of referenced) {
      assert.ok(allowed.has(metric), `Unexpected metric ${metric}`);
      if (metric !== "up") assert.ok(metrics.includes(metric.replace(/_(?:bucket|count)$/, "")));
    }
    for (const group of rule.expr.matchAll(/by\s*\(([^)]+)\)/g)) {
      assert.deepEqual(group[1].split(",").map(label => label.trim()).sort(), ["environment", "job", "service"]);
    }
    // Check selector keys, not the legitimate stage="tool" enum value.
    for (const [, key] of rule.expr.matchAll(/\b([a-zA-Z_]\w*)\s*(?:=~|!~|!=|=)\s*"/g)) {
      assert.ok(["job", "stage", "outcome", "reason", "le"].includes(key), `Unexpected selector label ${key}`);
    }
    assert.equal(rule.annotations.runbook, "infra/observability/OPERATIONS.md");
    assert.ok(!JSON.stringify(rule.annotations).includes("{{"), "No private/dynamic annotation payloads");
  }
});

test("error and latency alerts use terminal turns and volume gates, not nested stages", () => {
  const definitions = rules();
  for (const name of ["StorefrontTurnErrorRate", "StorefrontSlowTurns"]) {
    const rule = definitions.find(value => value.alert === name);
    assert.match(rule.expr, /stage="turn"/);
    assert.match(rule.expr, />= 20/);
    assert.doesNotMatch(rule.expr, /stage="(?:provider|tool|validation|persistence)"/);
  }
  assert.match(definitions.find(value => value.alert === "StorefrontSlowTurns").expr, /le="10"/);
  assert.equal(definitions.find(value => value.alert === "StorefrontCartOutcomeUnknown").for, "0s");
  assert.doesNotMatch(definitions.find(value => value.alert === "StorefrontContractOutputInvalid").expr, /invalid_input/);
});

test("local Compose mounts actual rule_files without notifications, new target, auth or retention changes", () => {
  const config = parse(read("prometheus/prometheus.yml"));
  const compose = parse(read("docker-compose.yml"));
  assert.deepEqual(config.rule_files, ["/etc/prometheus/rules/storefront-local.yml"]);
  assert.equal(config.alerting, undefined);
  assert.equal(config.scrape_configs.length, 1);
  assert.deepEqual(config.scrape_configs[0].static_configs[0], {
    targets: ["host.docker.internal:3001"], labels: { service: "zyon-api", environment: "development" },
  });
  assert.ok(compose.services.prometheus.volumes.includes("./prometheus/rules:/etc/prometheus/rules:ro"));
  assert.ok(compose.services.prometheus.command.includes("--storage.tsdb.retention.time=7d"));
  assert.ok(!Object.keys(compose.services).some(name => /alertmanager|slack|smtp/i.test(name)));
});

test("synthetic fixture matrix covers every rule with both firing and non-firing expectations", () => {
  const fixture = buildAlertTests();
  for (const name of alertNames) {
    const cases = fixture.tests.flatMap(group => group.alert_rule_test).filter(item => item.alertname === name);
    assert.ok(cases.some(item => item.exp_alerts.length > 0), `No firing case ${name}`);
    assert.ok(cases.some(item => item.exp_alerts.length === 0), `No quiet case ${name}`);
  }
  for (const name of ["healthy and idle", "no metrics", "counter reset", "environment isolation", "pending and resolution", "low volume", "nested errors only"]) {
    assert.ok(fixture.tests.some(group => group.name === name), `Missing scenario ${name}`);
  }
});

test("runbook documents no-data, unknown-outcome, local access and unapproved retention boundaries", () => {
  const runbook = read("OPERATIONS.md");
  for (const text of ["STOREFRONT_LLM_OBSERVABILITY", "OPS_SHARED_SECRET", "7d", "720h", "admin/admin", "Alertmanager", "sem dados", "não repetir", "Loki", "Tempo"]) {
    assert.ok(runbook.includes(text), `Missing operational caveat: ${text}`);
  }
});

test("native validator stays isolated, bounded, pull-free and ownership-scoped on cleanup", () => {
  const runner = readFileSync(new URL("./validate-alerts.mjs", import.meta.url), "utf8");
  for (const literal of ['"--rm"', '"--pull=never"', '"--network", "none"', '"--read-only"',
    '"--memory", "256m"', '"--cpus", "1"', '"--cap-drop", "ALL"',
    '"/tmp:rw,noexec,nosuid,nodev,size=64m"', 'target=/etc/prometheus,readonly',
    'container.Config.Labels["zyon.local.validator"]', 'container.Name', 'imageId']) {
    assert.ok(runner.includes(literal), `Missing native isolation guard ${literal}`);
  }
  assert.doesNotMatch(runner, /"--privileged"|"--publish"|"-p"|"--env-file"|"compose"|"prune"|docker\.sock/);
});
