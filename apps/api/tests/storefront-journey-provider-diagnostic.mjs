import { z } from "zod";

// Technical metadata only. Never retain provider bodies, error text, request
// headers, model arguments, prompts, stacks or credentials in journey traces.
export const journeyProviderDiagnosticFields = {
  failureReason: z.enum(["network_failed", "timeout", "aborted", "http_failed", "response_too_large",
    "budget_rejected", "wire_invalid", "truncated", "content_filtered", "structured_output_invalid", "unrecognized_failure"]).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  finishReason: z.enum(["stop", "tool_calls", "length", "content_filter", "other", "unavailable"]).optional(),
  contentShape: z.enum(["missing", "empty", "whitespace", "fenced_text", "invalid_json", "json_array", "json_scalar", "json_null", "json_object"]).optional(),
  contentSource: z.enum(["assistant_content", "tool_arguments"]).optional(),
};
/** Return an enum only. Never repair/fence-strip, retain or publish the value. */
export function journeyContentShape(value) {
  if (typeof value !== "string") return "missing";
  if (value.length === 0) return "empty";
  const trimmed = value.trim();
  if (!trimmed) return "whitespace";
  if (trimmed.startsWith("```")) return "fenced_text";
  let parsed;
  try { parsed = JSON.parse(value); } catch { return "invalid_json"; }
  return parsed === null ? "json_null" : Array.isArray(parsed) ? "json_array" : typeof parsed === "object" ? "json_object" : "json_scalar";
}
const budgetReasons = new Map([
  ["sandbox_provider_network_failed", "network_failed"], ["sandbox_provider_timeout", "timeout"],
  ["sandbox_provider_aborted", "aborted"], ["sandbox_provider_http_failed", "http_failed"],
  ["sandbox_provider_response_too_large", "response_too_large"],
  ["sandbox_budget_exhausted", "budget_rejected"], ["sandbox_budget_step_already_attempted", "budget_rejected"],
  ["sandbox_provider_request_invalid", "budget_rejected"], ["sandbox_provider_response_invalid", "wire_invalid"],
]);
export function journeyProviderFailureDiagnostic(error, { phase, httpStatus, finishReason = "unavailable", contentShape, contentSource }) {
  const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
  const errorStatus = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "httpStatus")?.value : undefined;
  const status = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus
    : Number.isInteger(errorStatus) && errorStatus >= 100 && errorStatus <= 599 ? errorStatus : undefined;
  const reason = budgetReasons.get(code) ?? (phase === "wire" ? finishReason === "length" ? "truncated"
    : finishReason === "content_filter" ? "content_filtered" : "wire_invalid"
    : phase === "content" ? "structured_output_invalid" : "unrecognized_failure");
  return z.strictObject(journeyProviderDiagnosticFields).parse({ failureReason: reason,
    ...(status === undefined ? {} : { httpStatus: status }), finishReason,
    ...(phase === "content" && contentShape !== undefined ? { contentShape, contentSource } : {}) });
}

export function summarizeJourneyProviderFailure(traces) {
  const last = traces.findLast(trace => trace.outcome === "failed" && trace.failureReason !== undefined);
  if (!last) return undefined;
  return z.strictObject(journeyProviderDiagnosticFields).parse({ failureReason: last.failureReason,
    ...(last.httpStatus === undefined ? {} : { httpStatus: last.httpStatus }), finishReason: last.finishReason,
    ...(last.contentShape === undefined ? {} : { contentShape: last.contentShape, contentSource: last.contentSource }) });
}
