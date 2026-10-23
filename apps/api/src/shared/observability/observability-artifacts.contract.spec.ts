import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Reuse the installed development toolchain parser. No runtime dependency/lock change.
const { parseDocument } = createRequire(require.resolve("eslint"))("yaml") as {
  parseDocument(source: string): { errors: Error[]; toJSON(): any };
};
const root = new URL("../../../../../infra/observability/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
async function yaml(path: string) { const document = parseDocument(await read(path)); assert.deepEqual(document.errors, []); return document.toJSON(); }
const dashboard = async () => JSON.parse(await read("grafana/dashboards/storefront-llm.json"));

test("collector is Alloy opt-in, not the retired all-container Promtail service", async () => {
  const compose = await yaml("docker-compose.yml");
  assert.equal(compose.services.promtail, undefined);
  assert.deepEqual(compose.services.alloy.profiles, ["logs"]);
  assert.equal(compose.services.alloy.image, "grafana/alloy:v1.20.1");
  assert.ok(compose.services.alloy.volumes.includes("./alloy:/etc/alloy:ro"));
});

test("all exposed demo stack ports bind only to loopback", async () => {
  const compose = await yaml("docker-compose.yml");
  for (const service of Object.values(compose.services) as Array<{ ports?: string[] }>)
    for (const binding of service.ports ?? []) assert.match(binding, /^127\.0\.0\.1:/);
  assert.equal(compose.services.grafana.environment.GF_AUTH_ANONYMOUS_ENABLED, "false");
});

test("collector discovery requires the explicit API label and uses bounded service/environment labels", async () => {
  const config = await read("alloy/config.alloy");
  assert.match(config, /__meta_docker_container_label_zyon_observability/);
  assert.match(config, /regex\s*=\s*"storefront_api"/);
  assert.match(config, /action\s*=\s*"keep"/);
  assert.match(config, /replacement\s*=\s*"zyon-api"/);
  assert.doesNotMatch(config, /merchant_id|correlation_id|container_name/);
});

test("collector uses the shared managed projection before Loki, never the raw Docker line", async () => {
  const config = await read("alloy/config.alloy"), managed = await read("alloy/managed.alloy");
  assert.match(config, /managed\.managed_logs/);
  assert.match(managed, /stage\.output\s*\{\s*source\s*=\s*"safe_entry"/);
  assert.match(managed, /toJson/);
  assert.doesNotMatch(managed, /\.Entry|\.message|\.stack|\.headers|\.user_message|\.body/);
});

test("managed projection extracts timestamp first and never fudges invalid time", async () => {
  const managed = await read("alloy/managed.alloy");
  assert.match(managed, /time\s*=\s*"time"/);
  assert.match(managed, /stage\.timestamp\s*\{\s*source\s*=\s*"time"\s*format\s*=\s*"RFC3339Nano"\s*action_on_failure\s*=\s*"skip"/);
});

test("managed projection limits final labels and puts correlation only into structured metadata", async () => {
  const managed = await read("alloy/managed.alloy");
  assert.match(managed, /stage\.label_keep\s*\{\s*values\s*=\s*\["service", "environment", "job", "level"\]/);
  assert.match(managed, /stage\.structured_metadata/);
  assert.match(managed, /request_id\s*=\s*"safe_request_id"/);
  assert.match(managed, /trace_id\s*=\s*"safe_trace_id"/);
});

test("unknown events are discarded instead of forwarding arbitrary console/application logs", async () => {
  const managed = await read("alloy/managed.alloy");
  assert.match(managed, /storefront\.observation/); assert.match(managed, /http\.exception/);
  assert.match(managed, /selector\s*=\s*"\{managed_event!~/);
  assert.match(managed, /action\s*=\s*"drop"/);
});

test("Grafana provisions a non-editable source dashboard using the mounted directory", async () => {
  const provider = await yaml("grafana/provisioning/dashboards/storefront.yml"), compose = await yaml("docker-compose.yml");
  assert.equal(provider.providers[0].options.path, "/var/lib/grafana/dashboards");
  assert.equal(provider.providers[0].allowUiUpdates, false);
  assert.ok(compose.services.grafana.volumes.includes("./grafana/dashboards:/var/lib/grafana/dashboards:ro"));
  assert.equal((await dashboard()).editable, false);
});

test("datasource UIDs are explicit and every dashboard reference resolves", async () => {
  const sources = (await yaml("grafana/provisioning/datasources/datasources.yml")).datasources;
  assert.deepEqual(sources.map((source: any) => source.uid).sort(), ["loki", "prometheus", "tempo"]);
  const known = new Set(sources.map((source: any) => source.uid));
  for (const panel of (await dashboard()).panels) if (panel.datasource) assert.ok(known.has(panel.datasource.uid));
});

test("Loki derived field recognizes canonical and legacy trace IDs of exactly 32 hex digits", async () => {
  const sources = (await yaml("grafana/provisioning/datasources/datasources.yml")).datasources;
  const field = sources.find((source: any) => source.uid === "loki").jsonData.derivedFields[0];
  const expression = new RegExp(field.matcherRegex);
  for (const name of ["traceId", "trace_id"]) assert.equal(expression.exec(JSON.stringify({ [name]: "a".repeat(32) }))?.[1], "a".repeat(32));
  assert.equal(expression.exec('{"traceId":"abc"}'), null);
  assert.equal(field.datasourceUid, "tempo"); assert.equal(field.url, "$${__value.raw}");
});

test("Tempo-to-Loki uses the canonical JSON trace field, not an absent indexed trace label", async () => {
  const sources = (await yaml("grafana/provisioning/datasources/datasources.yml")).datasources;
  const links = sources.find((source: any) => source.uid === "tempo").jsonData.tracesToLogsV2;
  assert.equal(links.datasourceUid, "loki"); assert.equal(links.customQuery, true);
  assert.match(links.query, /\{service="zyon-api"\}\s*\| json\s*\| traceId=/);
  assert.ok(links.query.includes("$${__span.traceId}")); assert.equal(links.filterByTraceID, false);
});

test("dashboard uses only existing metric families and fixed scrape scope", async () => {
  const families = new Set(["up", "storefront_llm_operations_total", "storefront_llm_decisions_total",
    "storefront_llm_operation_duration_seconds_bucket", "storefront_llm_tokens_total", "storefront_llm_estimated_cost_usd_cents_total"]);
  const board = await dashboard();
  for (const panel of board.panels) for (const target of panel.targets ?? []) {
    if (panel.datasource?.uid !== "prometheus") continue;
    for (const match of target.expr.matchAll(/([a-z][a-z0-9_]+)\{/g)) assert.ok(families.has(match[1]), match[1]);
    assert.match(target.expr, /job="aacp-api"/); assert.match(target.expr, /service="zyon-api"/);
    assert.match(target.expr, /environment="\$environment"/);
  }
});

test("dashboard keeps no-data distinct from zero and does not invent fallback-per-turn ratios", async () => {
  const board = await dashboard();
  const expressions = board.panels.flatMap((panel: any) => (panel.targets ?? []).map((target: any) => target.expr)).join("\n");
  assert.doesNotMatch(expressions, /or\s+vector\(0\)/);
  assert.doesNotMatch(expressions, /decisions_total[^\n]*\/[^\n]*operations_total/);
  for (const panel of board.panels) if (panel.datasource?.uid === "prometheus") assert.equal(panel.fieldConfig.defaults.noValue, "Sem dados");
});

test("turn, provider errors, decisions and persistence use distinct queries with honest units", async () => {
  const board = await dashboard();
  assert.ok(board.panels.some((panel: any) => panel.targets?.some((target: any) => /operations_total.*stage="turn"/.test(target.expr))));
  assert.ok(board.panels.some((panel: any) => panel.targets?.some((target: any) => /operations_total.*stage="provider".*outcome="error"/.test(target.expr))));
  assert.ok(board.panels.some((panel: any) => panel.targets?.some((target: any) => /operations_total.*stage="persistence".*outcome="error"/.test(target.expr))));
  const latency = board.panels.find((panel: any) => panel.targets?.some((target: any) => target.expr.includes("histogram_quantile")));
  assert.equal(latency.fieldConfig.defaults.unit, "s"); assert.match(latency.description, /sobrep/);
  const cost = board.panels.find((panel: any) => panel.targets?.some((target: any) => target.expr.includes("estimated_cost")));
  assert.equal(cost.fieldConfig.defaults.unit, "currencyUSD"); assert.match(cost.targets[0].expr, /\/ 100$/);
  assert.match(cost.description, /estimado|estimativa/);
});

test("dashboard exposes managed logs, does not embed buyer IDs, prompts, or commercial success claims", async () => {
  const board = await dashboard();
  const logs = board.panels.find((panel: any) => panel.type === "logs");
  assert.equal(logs.datasource.uid, "loki"); assert.match(logs.targets[0].expr, /event="storefront.observation"/);
  assert.equal(board.templating.list.length, 1); assert.equal(board.templating.list[0].name, "environment");
  assert.doesNotMatch(JSON.stringify(board), /merchant_id|buyerId|globalUserId|user_message|payment_approved/);
});

test("Prometheus target and dashboard scope remain consistent without adding a credential value", async () => {
  const config = await yaml("prometheus/prometheus.yml"), job = config.scrape_configs[0];
  assert.equal(job.job_name, "aacp-api"); assert.equal(job.metrics_path, "/metrics");
  assert.equal(job.static_configs[0].labels.service, "zyon-api");
  assert.equal(job.static_configs[0].labels.environment, "development");
  assert.equal(job.authorization, undefined); assert.equal(job.basic_auth, undefined);
});

test("isolated integration has no operational compose, Docker socket or existing service volumes", async () => {
  const script = await read("../../apps/api/tests/observability-integration.mjs");
  assert.match(script, /--internal/); assert.match(script, /--pull=never/);
  assert.match(script, /--tmpfs/);
  assert.match(await read("../../apps/api/tests/observability-loopback-relay.mjs"), /server\.listen\(0, "127\.0\.0\.1"/);
  assert.doesNotMatch(script, /host\.docker\.internal|docker\.sock|compose.*up|grafana-data|prometheus-data/);
});

test("isolated integration verifies resource ownership before cleanup", async () => {
  const script = await read("../../apps/api/tests/observability-integration.mjs");
  assert.match(script, /com\.zyon\.validation/); assert.match(script, /randomUUID/);
  assert.match(script, /assert\.equal\(.*owner/);
  assert.doesNotMatch(script, /prune|volume.*rm/);
});

test("isolated integration exercises backend queries, UI and provisioned correlation settings", async () => {
  const script = await read("../../apps/api/tests/observability-integration.mjs");
  for (const text of ["/api/ds/query", "chromium", "tracesToLogsV2", "derivedFields", "PRIVATE_SYNTHETIC", "syntheticTrace"]) assert.ok(script.includes(text));
});

test("Loki does not silently add an indexed service_name beyond the managed label allowlist", async () => {
  const config = await yaml("loki/loki.yml");
  assert.deepEqual(config.limits_config.discover_service_name, []);
});

