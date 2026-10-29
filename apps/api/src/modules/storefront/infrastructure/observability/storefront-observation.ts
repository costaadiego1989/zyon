import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { context, trace, isSpanContextValid, SpanStatusCode, type Context, type Span } from "@opentelemetry/api";
import { z } from "zod";
import { PRICING, type OpenRouterProvider, type OpenRouterChatRequest } from "@zyon/conversation-engine";
import type { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { storefrontToolSchema, storefrontToolArgumentSchemas } from "../../domain/contracts/storefront-tool.schemas.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { StorefrontToolOutcomeUnknownError } from "../../domain/errors/store-tool-outcome-unknown.error.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { storefrontIntentUsageSchema } from "../../domain/contracts/storefront-intent.schemas.js";
import { storefrontObservationBoundaries } from "../../domain/ports/storefront-use-case-observation.port.js";

const stageSchema = z.enum(["turn", "agent", "classifier", "provider", "tool", "validation", "persistence", "generation"]);
const outcomeSchema = z.enum(["ok", "error", "fallback", "rejected", "unknown"]);
const reasonSchema = z.enum(["completed", "exception", "invalid_input", "invalid_context", "invalid_output", "invalid_usage", "out_of_scope", "scope_unclear",
  "low_confidence", "inconsistent", "tool_calls", "cart_outcome_unknown", "safety_rejected", "budget_exhausted", "provider_fallback", "business_rejected"]);
const phaseSchema = z.enum(["main", "retry", "final", "classifier", "variant", "nudge", "output_review"]);
const providerSchema = z.enum(["primary", "fallback", "copy"]);
const boundarySchema = z.enum(storefrontObservationBoundaries);
const observationSchema = z.strictObject({
  schemaVersion: z.literal(1), turnId: z.uuid(), operationId: z.uuid(), parentId: z.uuid().optional(),
  kind: z.enum(["operation", "decision"]), traceId: z.string().regex(/^[a-f0-9]{32}$/).optional(), spanId: z.string().regex(/^[a-f0-9]{16}$/).optional(),
  stage: stageSchema, outcome: outcomeSchema, reason: reasonSchema, durationMs: z.number().finite().nonnegative(),
  phase: phaseSchema.optional(), provider: providerSchema.optional(),
  boundary: boundarySchema.optional(),
  tool: z.string().max(80).refine(name => name === "unknown" || !!storefrontToolSchema(name)).optional(),
  usageKnown: z.boolean().optional(), promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(), estimatedCostUsdCents: z.number().finite().nonnegative().optional(),
});
export type StorefrontObservation = z.infer<typeof observationSchema>;
type Stage = z.infer<typeof stageSchema>;
type Outcome = z.infer<typeof outcomeSchema>;
type Reason = z.infer<typeof reasonSchema>;
type Meta = Pick<StorefrontObservation, "tool" | "phase" | "provider" | "boundary">;
type Completion = Partial<Pick<StorefrontObservation, "usageKnown" | "promptTokens" | "completionTokens" | "estimatedCostUsdCents">>;
interface Frame { observer: StorefrontObserver; turnId: string; operationId: string; otelContext: Context }
const storage = new AsyncLocalStorage<Frame>();
const ignoreFailure = (fn: () => void): void => { try { fn(); } catch { /* Observation must not affect commerce. */ } };

/** Opt-in only. No exporter/client, prompt, arguments, outputs, identities or exception text. */
export class StorefrontObserver {
  constructor(private readonly options: { enabled?: boolean; metrics?: MetricsService;
    record?: (event: StorefrontObservation) => void } = {}) {}

  turn<T>(execute: () => Promise<T>): Promise<T> {
    if (!this.options.enabled || storage.getStore()) return execute();
    const turnId = randomUUID();
    return storage.run({ observer: this, turnId, operationId: turnId, otelContext: context.active() },
      () => observeStorefrontOperation("turn", execute));
  }

  record(value: StorefrontObservation): void {
    if (!this.options.enabled) return;
    const parsed = observationSchema.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    const metrics = this.options.metrics;
    if (metrics) {
      const labels = { stage: event.stage, outcome: event.outcome, reason: event.reason };
      if (event.kind === "decision") ignoreFailure(() => metrics.storefrontLlmDecisions.inc(labels));
      else {
        ignoreFailure(() => metrics.storefrontLlmOperations.inc(labels));
        ignoreFailure(() => metrics.storefrontLlmDuration.observe({ stage: event.stage }, event.durationMs / 1000));
      }
      if (event.kind === "operation" && event.stage === "provider" && event.usageKnown && event.phase && event.provider) {
        const tokenLabels = { phase: event.phase, provider: event.provider };
        ignoreFailure(() => metrics.storefrontLlmTokens.inc({ ...tokenLabels, kind: "prompt" }, event.promptTokens ?? 0));
        ignoreFailure(() => metrics.storefrontLlmTokens.inc({ ...tokenLabels, kind: "completion" }, event.completionTokens ?? 0));
        if (event.estimatedCostUsdCents !== undefined)
          ignoreFailure(() => metrics.storefrontLlmEstimatedCost.inc(tokenLabels, event.estimatedCostUsdCents));
      }
    }
    ignoreFailure(() => this.options.record?.({ ...event }));
  }
}

function safeMeta(meta: Meta): Meta {
  const phase = phaseSchema.safeParse(meta.phase);
  const provider = providerSchema.safeParse(meta.provider);
  const boundary = boundarySchema.safeParse(meta.boundary);
  return { ...(phase.success ? { phase: phase.data } : {}), ...(provider.success ? { provider: provider.data } : {}),
    ...(boundary.success ? { boundary: boundary.data } : {}),
    ...(meta.tool === undefined ? {} : { tool: storefrontToolSchema(meta.tool) ? meta.tool : "unknown" }) };
}

export async function observeStorefrontOperation<T>(stage: Stage, execute: () => Promise<T>, meta: Meta = {},
  complete?: (result: T) => Completion): Promise<T> {
  const parent = storage.getStore();
  if (!parent || !stageSchema.safeParse(stage).success) return execute();
  const operationId = randomUUID();
  const started = performance.now();
  const metadata = safeMeta(meta);
  let span: Span | undefined;
  ignoreFailure(() => { span = trace.getTracer("zyon.storefront", "1").startSpan(`storefront.${stage}`, {}, parent.otelContext); });
  const frame: Frame = { ...parent, operationId, otelContext: span ? trace.setSpan(parent.otelContext, span) : parent.otelContext };
  let outcome: Outcome = "ok", reason: Reason = "completed", details: Completion = {};
  try {
    // Construct the business promise once, even if a context manager malfunctions.
    let task: Promise<T> | undefined;
    const invoke = () => task ??= storage.run(frame, () => Promise.resolve().then(execute));
    try { context.with(frame.otelContext, invoke); } catch { /* run once below if context failed before invoke */ }
    const result = await (task ?? invoke());
    ignoreFailure(() => { details = storage.run(frame, () => complete?.(result) ?? {}); });
    return result;
  } catch (error) {
    outcome = "error"; reason = "exception";
    throw error;
  } finally {
    let spanIds = {};
    ignoreFailure(() => { const sc = span?.spanContext(); if (sc && isSpanContextValid(sc)) spanIds = { traceId: sc.traceId, spanId: sc.spanId }; });
    const event: StorefrontObservation = { schemaVersion: 1, kind: "operation", turnId: parent.turnId, operationId, ...spanIds,
      ...(stage === "turn" ? {} : { parentId: parent.operationId }), stage, outcome, reason,
      durationMs: Math.max(0, performance.now() - started), ...metadata, ...details };
    ignoreFailure(() => {
      span?.setAttributes({ "storefront.turn_id": event.turnId, "storefront.operation_id": operationId,
        "storefront.outcome": outcome, "storefront.reason": reason,
        ...(metadata.tool ? { "storefront.tool": metadata.tool } : {}),
        ...(metadata.phase ? { "storefront.phase": metadata.phase } : {}),
        ...(metadata.provider ? { "storefront.provider": metadata.provider } : {}),
        ...(metadata.boundary ? { "storefront.boundary": metadata.boundary } : {}),
        ...(details.usageKnown === undefined ? {} : { "storefront.usage_known": details.usageKnown }),
        ...(details.promptTokens === undefined ? {} : { "gen_ai.usage.input_tokens": details.promptTokens }),
        ...(details.completionTokens === undefined ? {} : { "gen_ai.usage.output_tokens": details.completionTokens }),
        ...(details.estimatedCostUsdCents === undefined ? {} : { "storefront.estimated_cost_usd_cents": details.estimatedCostUsdCents }),
      });
      span?.setStatus({ code: outcome === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    });
    ignoreFailure(() => span?.end());
    ignoreFailure(() => parent.observer.record(event));
  }
}

export function recordStorefrontDecision(stage: Stage, outcome: Outcome, reason: Reason, meta: Meta = {}): void {
  const frame = storage.getStore();
  if (!frame || !stageSchema.safeParse(stage).success || !outcomeSchema.safeParse(outcome).success || !reasonSchema.safeParse(reason).success) return;
  let spanIds = {};
  ignoreFailure(() => { const sc = trace.getSpan(frame.otelContext)?.spanContext(); if (sc && isSpanContextValid(sc)) spanIds = { traceId: sc.traceId, spanId: sc.spanId }; });
  const metadata = safeMeta(meta);
  ignoreFailure(() => frame.observer.record({ schemaVersion: 1, kind: "decision", turnId: frame.turnId, operationId: randomUUID(), ...spanIds,
    parentId: frame.operationId, stage, outcome, reason, durationMs: 0, ...metadata }));
  ignoreFailure(() => trace.getSpan(frame.otelContext)?.addEvent("storefront.decision", { stage, outcome, reason,
    ...(metadata.boundary ? { boundary: metadata.boundary } : {}) }));
}

export function observeStorefrontChat(provider: Pick<OpenRouterProvider, "chat">, request: OpenRouterChatRequest,
  providerRole: NonNullable<Meta["provider"]>, phase: NonNullable<Meta["phase"]>, defaultModel?: string) {
  return observeStorefrontOperation("provider", () => provider.chat(request), { provider: providerRole, phase }, result => {
    const parsed = storefrontIntentUsageSchema.safeParse(result.usage);
    if (result.usageKnown === false || !parsed.success || parsed.data.totalTokens !== parsed.data.promptTokens + parsed.data.completionTokens) {
      recordStorefrontDecision("validation", "unknown", "invalid_usage");
      return { usageKnown: false };
    }
    const model = request.model ?? defaultModel;
    // Unlike budget enforcement, observability never guesses a price for an unknown model.
    const price = model && Object.hasOwn(PRICING, model) ? PRICING[model] : undefined;
    return { usageKnown: true, promptTokens: parsed.data.promptTokens, completionTokens: parsed.data.completionTokens,
      ...(price ? { estimatedCostUsdCents: (parsed.data.promptTokens * price.promptPer1k + parsed.data.completionTokens * price.completionPer1k) / 1000 } : {}) };
  });
}

/** Direct/UI handlers only; agent tools already observe their contract boundary. */
export function observeStorefrontHandlers(handlers: StoreToolHandlers, cartId: string): StoreToolHandlers {
  if (!storage.getStore()) return handlers;
  const wrapped = { ...handlers };
  for (const tool of Object.keys(storefrontToolArgumentSchemas)) {
    // Mechanical identifier mapping, never interpretation of buyer/model text.
    const key = tool.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()) as keyof StoreToolHandlers;
    const handler = handlers[key];
    if (typeof handler !== "function") continue;
    Object.assign(wrapped, { [key]: (...args: unknown[]) => observeStorefrontOperation("tool", async () => {
      try {
        const value: unknown = await Reflect.apply(handler, handlers, args);
        ignoreFailure(() => {
          const projected = validateStorefrontToolOutput(tool, value, { cartId });
          if (!projected.ok) recordStorefrontDecision("tool", "rejected", "invalid_output", { tool });
          else if (projected.data && typeof projected.data === "object" && "error" in projected.data)
            recordStorefrontDecision("tool", "rejected", "business_rejected", { tool });
        });
        return value;
      } catch (error) {
        if (error instanceof StorefrontToolOutcomeUnknownError) recordStorefrontDecision("tool", "unknown", "cart_outcome_unknown", { tool });
        throw error;
      }
    }, { tool }) });
  }
  return wrapped;
}

