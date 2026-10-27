import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SANDBOX_LLM_APPROVAL, SANDBOX_LLM_EXTENSION_APPROVAL, SANDBOX_LLM_CONTINUATION_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";
import { journeyProviderDiagnosticFields } from "./storefront-journey-provider-diagnostic.mjs";

const requestSchema = z.strictObject({ type: z.literal("journey-provider-key-request"), runId: z.uuidv4(), nonce: z.uuidv4() });
const replySchema = z.strictObject({ type: z.literal("journey-provider-key-reply"), runId: z.uuidv4(), nonce: z.uuidv4(),
  apiKey: z.string().min(16).max(4096).refine(value => !/[\s\x00-\x1f\x7f]/.test(value)) });
export function parseApprovedLlmFlags(args) {
  assert.ok(Array.isArray(args));
  const extended = args.includes("--extend-original-budget-to=90");
  const continued = args.includes("--extend-original-budget-to=130");
  const authority = continued ? SANDBOX_LLM_CONTINUATION_APPROVAL : extended ? SANDBOX_LLM_EXTENSION_APPROVAL : SANDBOX_LLM_APPROVAL;
  const flags = ["--local-disposable", "--prisma-loopback-exec", "--compiled-test-artifact", "--approved-deepseek-http",
    "--allow-real-deepseek", `--approval-id=${authority.approvalId}`, ...(continued ? ["--extend-original-budget-to=130"] : extended ? ["--extend-original-budget-to=90"] : [])];
  const expected = args.filter(value => typeof value === "string" && value.startsWith("--expected-consumed-calls="));
  assert.equal(expected.length, 1, "journey_explicit_expected_consumed_calls_required");
  const count = expected[0].slice("--expected-consumed-calls=".length);
  assert.match(count, continued ? /^(?:89|9[0-9]|1[01][0-9]|12[0-9])$/ : extended ? /^(?:49|[5-8][0-9])$/ : /^(?:1[2-9]|[2-5][0-9])$/, "journey_expected_consumed_calls_invalid");
  assert.deepEqual([...args].sort(), [...flags, expected[0]].sort(), "journey_explicit_original_llm_approval_flags_required");
  return Object.freeze({ approvalId: authority.approvalId, expectedConsumedCalls: Number(count), ...(continued || extended ? { extensionMaximumCalls: authority.maximumCalls } : {}) });
}
export const journeyProblemCodes = ["none", "unrecognized_problem", "invalid_storefront_input", "storefront_context_invalid", "invalid_conversation_token",
  "conversation_cart_mismatch", "validation_failed", "bad_request", "unauthorized", "forbidden", "rate_limited", "rate_limit_unavailable",
  "ai_rate_limit_unavailable", "ai_interaction_rate_limited", "service_unavailable", "internal_error", "request_timeout",
  "journey_http_admission_failed", "journey_http_operation_failed"];
const traceSchema = z.strictObject({ version: z.literal(1), runId: z.uuidv4(), operationId: z.uuidv4(), stepId: z.uuidv4(),
  stage: z.enum(["turn", "tool", "classifier", "copy", "nudge"]), ordinal: z.number().int().min(1).max(60),
  outcome: z.enum(["started", "completed", "failed"]), code: z.enum(["none", "journey_provider_failed", "journey_trace_failed"]),
  ...journeyProviderDiagnosticFields });
export const journeyLlmDiagnosticSchema = z.strictObject({ step: z.enum(["setup", "scope", "search", "add", "options", "edit", "remove", "recovery"]),
  code: z.string().regex(/^journey_[a-z0-9_]{1,120}$/), attemptedCalls: z.number().int().min(0).max(130), completedCalls: z.number().int().min(0).max(130),
  failedCalls: z.number().int().min(0).max(130), ledgerBefore: z.number().int().min(12).max(129), ledgerAfter: z.number().int().min(12).max(130).nullable(),
  httpStatus: z.number().int().min(100).max(599).nullable(), problemCode: z.enum(journeyProblemCodes),
  bridgeOutcome: z.enum(["not_started", "completed", "failed", "unavailable"]),
  bridgeCode: z.enum(["none", "journey_http_admission_failed", "journey_http_operation_failed", "unavailable"]),
  providerFactoryAttempts: z.number().int().min(0).max(1000), deniedFetches: z.number().int().min(0).max(1000), deniedSockets: z.number().int().min(0).max(1000),
  lastProviderFailure: z.strictObject(journeyProviderDiagnosticFields).optional(),
  cartObservation: z.enum(["not_observed", "absent", "unchanged", "changed", "observation_failed"]).optional(),
  traces: z.array(traceSchema).max(144) });
/** Validate the COMPLETE internal diagnostic before removing its traces for
 * early publication. Strict omit cannot parse the full trace-bearing object;
 * stripping raw input instead would hide unrecognized/private extra fields. */
export function projectJourneyPhaseFailure(raw) {
  const full = journeyLlmDiagnosticSchema.safeParse(raw);
  if (!full.success) return undefined;
  const { traces: _traces, ...technical } = full.data;
  return journeyLlmDiagnosticSchema.omit({ traces: true }).parse(technical);
}
export function parseJourneyPhaseFailureLine(line) {
  if (typeof line !== "string" || line.length > 8192 || !line.startsWith("JOURNEY_LLM_PHASE_FAILURE ")) return undefined;
  try { const result = journeyLlmDiagnosticSchema.omit({ traces: true }).safeParse(JSON.parse(line.slice("JOURNEY_LLM_PHASE_FAILURE ".length)));
    return result.success ? result.data : undefined; } catch { return undefined; }
}
export function parseJourneyKeyReply(rawRequest, rawReply) {
  // Never expose Zod's input-bearing diagnostic for private credential messages.
  const request = requestSchema.safeParse(rawRequest), reply = replySchema.safeParse(rawReply);
  assert.ok(request.success && reply.success, "journey_private_provider_key_reply_invalid");
  assert.equal(reply.data.runId, request.data.runId, "journey_private_provider_key_run_mismatch");
  assert.equal(reply.data.nonce, request.data.nonce, "journey_private_provider_key_nonce_mismatch");
  return reply.data.apiKey;
}
/** Caller invokes this ONLY after live SQL/Redis marker verification. No ambient
 * secret lookup, argv key, file, default, reconnect or second request exists. */
export function requestJourneyProviderKey(runId, channel = process) {
  const request = requestSchema.parse({ type: "journey-provider-key-request", runId, nonce: randomUUID() });
  assert.ok(channel.connected && typeof channel.send === "function", "journey_private_parent_ipc_required");
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, key) => {
      clearTimeout(timer); channel.off("message", message); channel.off("disconnect", disconnected);
      if (error) reject(error); else resolve(key);
    };
    const disconnected = () => finish(Error("journey_private_provider_key_parent_disconnected"));
    const message = reply => { try { finish(undefined, parseJourneyKeyReply(request, reply)); } catch { finish(Error("journey_private_provider_key_reply_invalid")); } };
    channel.once("message", message); channel.once("disconnect", disconnected);
    timer = setTimeout(() => finish(Error("journey_private_provider_key_deadline")), 30_000);
    channel.send(request, error => { if (error) finish(Error("journey_private_provider_key_request_failed")); });
  });
}
