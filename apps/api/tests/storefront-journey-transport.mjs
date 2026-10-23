import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import { SANDBOX_LLM_APPROVAL, sandboxLlmApprovalForId } from "./storefront-sandbox-llm-budget.mjs";
import { readJourneyCapability, revalidateJourneyCapability } from "./storefront-journey-guards.mjs";
import { journeyProviderDiagnosticFields, journeyProviderFailureDiagnostic, journeyContentShape } from "./storefront-journey-provider-diagnostic.mjs";

const stageSchema = z.enum(["turn", "tool", "classifier", "copy", "nudge"]);
const operationSchema = z.strictObject({ operationId: z.uuidv4(), stage: stageSchema });
const traceSchema = z.strictObject({ version: z.literal(1), runId: z.uuidv4(), operationId: z.uuidv4(),
  stepId: z.uuidv4(), stage: stageSchema, ordinal: z.number().int().min(1).max(60),
  outcome: z.enum(["started", "completed", "failed"]),
  code: z.enum(["none", "journey_provider_failed", "journey_trace_failed"]), ...journeyProviderDiagnosticFields });
const wireSchema = z.object({ choices: z.array(z.object({ finish_reason: z.enum(["stop", "tool_calls"]),
  message: z.object({ content: z.string().max(8000).nullish(), refusal: z.string().max(0).nullish(),
    tool_calls: z.array(z.object({ id: z.string().min(1), type: z.literal("function"),
      function: z.object({ name: z.string().min(1), arguments: z.string().max(8000) }) })).max(32).optional() }) })).length(1) });
const fail = code => { throw new Error(code); };
const ownedTransports = new WeakMap();
export function assertJourneyTransportCapability(transport, capability) {
  readJourneyCapability(capability);
  if (ownedTransports.get(transport) !== capability) return fail("journey_transport_capability_mismatch");
}
/** Only an existing real transport's unchanged fetch function may be wrapped by
 * the test egress layer. This creates no capability or extra provider channel. */
export function registerJourneyTransportWrapper(inner, wrapper) {
  const capability = ownedTransports.get(inner);
  if (!capability || wrapper?.fetchFactory !== inner.fetchFactory || typeof wrapper.runOperation !== "function") return fail("journey_transport_wrapper_invalid");
  ownedTransports.set(wrapper, capability);
  return wrapper;
}
function stepId(runId, operationId, ordinal) {
  const bytes = createHash("sha256").update(JSON.stringify(["storefront-journey-v1", runId, operationId, ordinal])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Transport-only infrastructure. It neither starts an app nor grants DB/auth
 * authority itself. Every enabled fetch uses the supplied durable ledger.
 * Process-wide egress coverage is a separate runner integration requirement. */
export function createStorefrontJourneyTransport({ capability, budget, record, approvalId = SANDBOX_LLM_APPROVAL.approvalId, runBudgeted = work => work() }) {
  const manifest = readJourneyCapability(capability);
  if (!budget || typeof budget.fetchForStep !== "function" || typeof budget.status !== "function" || typeof record !== "function" || typeof runBudgeted !== "function") {
    return fail("journey_transport_dependencies_required");
  }
  let status;
  try { status = budget.status(); } catch { return fail("journey_budget_unavailable"); }
  const authority = sandboxLlmApprovalForId(approvalId) ?? SANDBOX_LLM_APPROVAL;
  if (approvalId !== authority.approvalId) return fail("journey_budget_invalid");
  for (const [key, value] of Object.entries(authority)) if (status[key] !== value) return fail("journey_budget_invalid");
  const context = new AsyncLocalStorage(), operations = new Set();
  function trace(state, metadata, outcome, code = "none", diagnostic = {}) {
    try { record(structuredClone(traceSchema.parse({ version: 1, runId: manifest.runId, ...metadata, outcome, code, ...diagnostic }))); }
    catch { state.failed = true; return fail("journey_trace_failed"); }
  }
  const fetchFactory = channel => {
    if (!["primary", "fallback"].includes(channel)) return fail("journey_provider_channel_invalid");
    return async (url, options) => {
      const state = context.getStore();
      if (!state || !state.active) return fail("journey_operation_required");
      if (state.failed) return fail("journey_operation_failed");
      if (channel !== "primary") { state.failed = true; return fail("journey_fallback_forbidden"); }
      if (url !== SANDBOX_LLM_APPROVAL.endpoint || !options || typeof options.body !== "string"
        || Buffer.byteLength(options.body) > 80_000) { state.failed = true; return fail("journey_provider_request_forbidden"); }
      let body;
      try { body = JSON.parse(options.body); } catch { state.failed = true; return fail("journey_provider_request_forbidden"); }
      if (!["json_object", "json_schema"].includes(body?.response_format?.type)) {
        state.failed = true; return fail("journey_structured_output_required");
      }
      const digest = createHash("sha256").update(options.body).digest("hex");
      if (state.digests.has(digest)) { state.failed = true; return fail("journey_duplicate_request"); }
      state.digests.add(digest);
      const ordinal = ++state.ordinal;
      if (ordinal > 60) { state.failed = true; return fail("journey_operation_call_limit"); }
      const metadata = { operationId: state.operationId, stage: state.stage, ordinal,
        stepId: stepId(manifest.runId, state.operationId, ordinal) };
      trace(state, metadata, "started");
      let responsePhase = "request", httpStatus, finishReason = "unavailable", contentShape, contentSource;
      try {
        const response = await runBudgeted(() => budget.fetchForStep({ stepId: metadata.stepId, stage: metadata.stage })(url, options));
        httpStatus = response.status; responsePhase = "wire";
        const rawWire = await response.clone().json();
        const rawReason = rawWire?.choices?.[0]?.finish_reason;
        finishReason = rawReason === undefined ? "unavailable"
          : ["stop", "tool_calls", "length", "content_filter"].includes(rawReason) ? rawReason : "other";
        const wire = wireSchema.parse(rawWire);
        const message = wire.choices[0].message;
        responsePhase = "content";
        contentSource = message.tool_calls?.length ? "tool_arguments" : "assistant_content";
        const values = message.tool_calls?.length ? message.tool_calls.map(call => call.function.arguments) : [message.content];
        for (const value of values) {
          contentShape = journeyContentShape(value);
          const parsed = JSON.parse(value);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("journey_structured_output_invalid");
        }
        trace(state, metadata, "completed");
        return response;
      } catch (error) {
        state.failed = true;
        trace(state, metadata, "failed", "journey_provider_failed", journeyProviderFailureDiagnostic(error,
          { phase: responsePhase, httpStatus, finishReason, contentShape, contentSource }));
        return fail("journey_provider_failed");
      }
    };
  };
  const transport = Object.freeze({
    fetchFactory,
    async runOperation(input, work) {
      const parsed = operationSchema.safeParse(input);
      if (!parsed.success || typeof work !== "function") return fail("journey_operation_invalid");
      const operation = structuredClone(parsed.data);
      if (context.getStore()) return fail("journey_nested_operation_forbidden");
      if (operations.has(operation.operationId)) return fail("journey_operation_replayed");
      operations.add(operation.operationId);
      await revalidateJourneyCapability(capability);
      const state = { ...operation, active: true, failed: false, ordinal: 0, digests: new Set() };
      return context.run(state, async () => {
        try {
          const result = await work();
          if (state.failed) return fail("journey_operation_failed");
          return result;
        } finally { state.active = false; }
      });
    },
  });
  ownedTransports.set(transport, capability);
  return transport;
}
