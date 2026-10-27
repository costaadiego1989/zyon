import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { CorrelationIdStorage } from "./correlation-id.storage.js";

const requestIds = new WeakMap<object, string>();
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"]);

/** Log-only ID: independent from accepted/echoed caller correlation headers. */
export function requestLogId(request: object): string {
  let id = requestIds.get(request);
  if (!id) { id = randomUUID(); requestIds.set(request, id); }
  return id;
}

export function logContext(request?: object): Record<string, string> {
  const requestId = request ? requestLogId(request) : CorrelationIdStorage.getRequestId();
  const result: Record<string, string> = requestId ? { requestId } : {};
  try {
    const sc = trace.getActiveSpan()?.spanContext();
    if (sc && isSpanContextValid(sc)) Object.assign(result, { traceId: sc.traceId, spanId: sc.spanId, trace_id: sc.traceId, span_id: sc.spanId });
  } catch { /* Correlation must never affect logging or business execution. */ }
  return result;
}

/** Explicit validated observation IDs win over the ambient parent span. */
export function mergeLogContext(value: object, ambient: object): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...ambient, ...value };
  for (const key of ["traceId", "spanId", "trace_id", "span_id"]) delete merged[key];
  for (const candidate of [value as Record<string, unknown>, ambient as Record<string, unknown>]) {
    const traceId = candidate.traceId ?? candidate.trace_id, spanId = candidate.spanId ?? candidate.span_id;
    if (typeof traceId === "string" && typeof spanId === "string" && isSpanContextValid({ traceId, spanId, traceFlags: 0 })) {
      Object.assign(merged, { traceId, spanId, trace_id: traceId, span_id: spanId });
      break;
    }
  }
  return merged;
}

export function safeHttpMethod(value: unknown): string {
  return typeof value === "string" && methods.has(value) ? value : "OTHER";
}

export function safeErrorMetadata(error: unknown): { kind: "http_client_error" | "http_server_error" | "unexpected_error"; statusCode: number } {
  try {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (Number.isInteger(status) && status >= 400 && status <= 599)
        return { kind: status >= 500 ? "http_server_error" : "http_client_error", statusCode: status };
    }
  } catch { /* Do not evaluate arbitrary message/code/stack fields. */ }
  return { kind: "unexpected_error", statusCode: 500 };
}

export function ignoreLogFailure(write: () => void): void {
  try { write(); } catch { /* Telemetry is best-effort and must never cause replay. */ }
}

