import type { Attributes, SpanContext } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import { storefrontToolSchema } from "../../modules/storefront/domain/contracts/storefront-tool.schemas.js";
import { storefrontObservationBoundaries } from "../../modules/storefront/domain/ports/storefront-use-case-observation.port.js";
const schemas = {
  "storefront.outcome": z.enum(["ok", "error", "fallback", "rejected", "unknown"]),
  "storefront.reason": z.enum(["completed", "exception", "invalid_input", "invalid_context", "invalid_output", "invalid_usage", "low_confidence", "inconsistent", "tool_calls", "cart_outcome_unknown", "safety_rejected", "budget_exhausted", "provider_fallback", "business_rejected"]),
  "storefront.boundary": z.enum(storefrontObservationBoundaries),
  "storefront.provider": z.enum(["primary", "fallback", "copy"]),
  "storefront.phase": z.enum(["main", "retry", "final", "classifier", "variant", "nudge"]),
  "storefront.tool": z.string().max(80).refine(name => name === "unknown" || !!storefrontToolSchema(name)),
  "storefront.turn_id": z.uuid(), "storefront.operation_id": z.uuid(), "storefront.usage_known": z.boolean(),
  "gen_ai.usage.input_tokens": z.number().int().min(0).max(100_000_000), "gen_ai.usage.output_tokens": z.number().int().min(0).max(100_000_000),
  "storefront.estimated_cost_usd_cents": z.number().finite().nonnegative().max(1_000_000_000),
};
const stage = z.enum(["turn", "agent", "classifier", "provider", "tool", "validation", "persistence", "generation"]);
const knownNames = new Set(stage.options.map(name => `storefront.${name}`));
const cleanContext = (value: SpanContext): SpanContext => ({ traceId: value.traceId, spanId: value.spanId, traceFlags: value.traceFlags });

/** Export-time allowlist also filters automatic/third-party spans. No mutation of source spans. */
export class SafeSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter, private readonly serviceName: string) {}
  export(spans: ReadableSpan[], callback: Parameters<SpanExporter["export"]>[1]): void {
    let completed = false;
    const finish: Parameters<SpanExporter["export"]>[1] = result => {
      if (completed) return;
      completed = true;
      callback(result.code === 0 ? { code: 0 } : { code: 1, error: new Error("tracing_export_failed") });
    };
    try { this.delegate.export(spans.map(span => this.project(span)), finish); }
    catch { finish({ code: 1 }); }
  }
  async shutdown(): Promise<void> {
    try { await this.delegate.shutdown(); } catch { throw new Error("tracing_shutdown_failed"); }
  }
  async forceFlush(): Promise<void> {
    try { await this.delegate.forceFlush?.(); } catch { throw new Error("tracing_flush_failed"); }
  }
  private project(span: ReadableSpan): ReadableSpan {
    const attributes: Attributes = {};
    for (const [key, schema] of Object.entries(schemas)) { const parsed = schema.safeParse(span.attributes[key]); if (parsed.success) attributes[key] = parsed.data; }
    const resource: ReadableSpan["resource"] = {
      attributes: { "service.name": this.serviceName }, asyncAttributesPending: false,
      waitForAsyncAttributes: async () => {}, merge: () => resource, getRawAttributes: () => [["service.name", this.serviceName]],
    };
    const events = span.events.filter(event => event.name === "storefront.decision").slice(0, 8).flatMap(event => {
      const parsed = z.strictObject({ stage, outcome: schemas["storefront.outcome"], reason: schemas["storefront.reason"],
        boundary: schemas["storefront.boundary"].optional() }).safeParse(event.attributes);
      return parsed.success ? [{ name: "storefront.decision", time: event.time, attributes: parsed.data }] : [];
    });
    return { name: knownNames.has(span.name) ? span.name : "application.operation", kind: span.kind,
      spanContext: () => cleanContext(span.spanContext()), parentSpanContext: span.parentSpanContext ? cleanContext(span.parentSpanContext) : undefined,
      startTime: span.startTime, endTime: span.endTime, duration: span.duration, ended: span.ended,
      status: { code: span.status.code }, attributes, events, links: [], resource,
      instrumentationScope: { name: "zyon.safe-tracing", version: "1" },
      droppedAttributesCount: span.droppedAttributesCount, droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount };
  }
}

