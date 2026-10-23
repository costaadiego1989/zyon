// Synthetic series only. Expectations are independent of the rule YAML.
export const alertNames = ["StorefrontContractOutputInvalid", "StorefrontCartOutcomeUnknown",
  "StorefrontTurnErrorRate", "StorefrontSlowTurns", "StorefrontMetricsScrapeUnavailable"];
const summaries = ["Storefront contract decisions require investigation", "Storefront cart outcome is unknown",
  "Storefront terminal turn error ratio is high", "Storefront completed turns are slow", "Storefront metrics scrape is failing"];
const labels = (environment = "development") => ({ job: "aacp-api", service: "zyon-api", environment });
const metric = (name, attributes = {}, scope = labels()) => `${name}{${Object.entries({ ...scope, instance: "synthetic-only:1234", ...attributes }).map(([key, value]) => `${key}="${value}"`).join(",")}}`;
const series = (name, attributes, values, scope) => ({ series: metric(name, attributes, scope), values });
const invalid = (values, scope) => series("storefront_llm_decisions_total", { stage: "validation", outcome: "fallback", reason: "invalid_output" }, values, scope);
const unknown = (values, scope) => series("storefront_llm_decisions_total", { stage: "tool", outcome: "unknown", reason: "cart_outcome_unknown" }, values, scope);
const turns = (outcome, values) => series("storefront_llm_operations_total", { stage: "turn", outcome, reason: outcome === "ok" ? "completed" : "exception" }, values);
const histogram = (suffix, values, extra = {}) => series(`storefront_llm_operation_duration_seconds_${suffix}`, { stage: "turn", ...extra }, values);
const scrape = values => series("up", {}, values);
function expectation(name, evalTime, firing = false, environment = "development") {
  const index = alertNames.indexOf(name);
  if (index < 0) throw new Error("Unknown synthetic alert");
  return { eval_time: evalTime, alertname: name, exp_alerts: firing ? [{
    exp_labels: { ...labels(environment), severity: index === 1 ? "critical" : "warning", scope: "storefront", evaluation: "local" },
    exp_annotations: { summary: summaries[index], runbook: "infra/observability/OPERATIONS.md" },
  }] : [] };
}
const quiet = (at = "10m") => alertNames.map(name => expectation(name, at));
const group = (name, input_series, alert_rule_test) => ({ name, interval: "1m", input_series, alert_rule_test });

export function buildAlertTests() {
  return {
    rule_files: ["/etc/prometheus/rules/storefront-local.yml"], evaluation_interval: "1m",
    tests: [
      group("healthy and idle", [invalid("0x20"), unknown("0x20"), turns("ok", "0+10x20"), turns("error", "0x20"),
        histogram("bucket", "0+10x20", { le: "10" }), histogram("bucket", "0+10x20", { le: "+Inf" }), histogram("count", "0+10x20"), scrape("1x20")], quiet()),
      group("no metrics", [], quiet()),
      group("sustained firing", [invalid("0+1x20"), unknown("0+1x20"), turns("ok", "0+8x20"), turns("error", "0+2x20"),
        histogram("bucket", "0+5x20", { le: "10" }), histogram("bucket", "0+10x20", { le: "+Inf" }), histogram("count", "0+10x20"), scrape("0x20")],
      alertNames.map(name => expectation(name, "10m", true))),
      group("pending and resolution", [invalid("0 1x20"), unknown("0 1x20")], [
        expectation(alertNames[0], "1m"), expectation(alertNames[0], "2m", true), expectation(alertNames[0], "6m"),
        expectation(alertNames[1], "1m", true), expectation(alertNames[1], "6m"),
      ]),
      group("error pending and resolution", [turns("ok", "0+8x5 100+10x20"), turns("error", "0+2x5 10x20")], [
        expectation(alertNames[2], "3m"), expectation(alertNames[2], "4m", true), expectation(alertNames[2], "12m"),
      ]),
      group("latency pending and resolution", [histogram("bucket", "0+5x10 60+10x20", { le: "10" }),
        histogram("bucket", "0+10x31", { le: "+Inf" }), histogram("count", "0+10x31")], [
        expectation(alertNames[3], "6m"), expectation(alertNames[3], "7m", true), expectation(alertNames[3], "17m"),
      ]),
      group("scrape pending and resolution", [scrape("0x4 1x10")], [
        expectation(alertNames[4], "1m"), expectation(alertNames[4], "2m", true), expectation(alertNames[4], "5m"),
      ]),
      group("counter reset", [invalid("10 10 0 0x20"), unknown("10 10 0 0x20"), scrape("1x23")], quiet()),
      group("counter reset followed by a new decision", [invalid("10 10 0 1x20"), unknown("10 10 0 1x20")], [
        expectation(alertNames[0], "2m"), expectation(alertNames[0], "4m", true), expectation(alertNames[1], "3m", true),
      ]),
      group("environment isolation", [unknown("0x20"), unknown("0+1x20", labels("synthetic-production")),
        invalid("0+1x20", { job: "unrelated-api", service: "unrelated", environment: "development" })], [
        expectation(alertNames[0], "10m"), expectation(alertNames[1], "10m", true, "synthetic-production"),
      ]),
      group("low volume", [turns("ok", "0x20"), turns("error", "0+1x20"),
        histogram("bucket", "0x20", { le: "10" }), histogram("bucket", "0+1x20", { le: "+Inf" }), histogram("count", "0+1x20")], quiet()),
      group("nested errors only", [turns("ok", "0+10x20"),
        series("storefront_llm_operations_total", { stage: "provider", outcome: "error", reason: "exception" }, "0+10x20"),
        series("storefront_llm_operations_total", { stage: "persistence", outcome: "error", reason: "exception" }, "0+10x20"),
        series("storefront_llm_decisions_total", { stage: "validation", outcome: "rejected", reason: "invalid_input" }, "0+10x20"),
        series("storefront_llm_decisions_total", { stage: "tool", outcome: "rejected", reason: "business_rejected" }, "0+10x20"), scrape("1x20")], quiet()),
      group("two replica aggregation", [
        turns("ok", "0+8x20"), turns("error", "0+2x20"),
        { series: metric("storefront_llm_operations_total", { stage: "turn", outcome: "ok", reason: "completed", instance: "synthetic-b:1234" }), values: "0+10x20" },
      ], [expectation(alertNames[2], "10m")]),
      group("idle counters", [turns("ok", "100x20"), turns("error", "20x20"),
        histogram("bucket", "50x20", { le: "10" }), histogram("bucket", "100x20", { le: "+Inf" }), histogram("count", "100x20"), scrape("1x20")], quiet()),
    ],
  };
}
