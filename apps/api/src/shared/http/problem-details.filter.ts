import type { ProblemDetails } from "@zyon/contracts";
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { OptimisticConcurrencyError } from "./http-contract.errors.js";
import type { AacpHttpRequest } from "./http-request.js";

@Catch()
export class ProblemDetailsFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<AacpHttpRequest>();
    const response = context.getResponse<Response>();
    const correlationId = request.correlationId ?? `corr_${randomUUID()}`;
    const problem = toProblemDetails(exception, correlationId);

    if (problem.status >= 500) {
      this.logger.error(
        `${problem.code} ${request.method ?? "HTTP"} ${request.originalUrl ?? request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.setHeader("x-correlation-id", correlationId);
    if (problem.status === 429 && problem.retry_after_seconds) response.setHeader("Retry-After", String(problem.retry_after_seconds));
    response
      .status(problem.status)
      .type("application/problem+json")
      .send(problem);
  }
}

export function toProblemDetails(
  exception: unknown,
  correlationId: string,
): ProblemDetails {
  if (exception instanceof OptimisticConcurrencyError) {
    return {
      type: problemType(exception.code),
      title: "Precondition Failed",
      status: HttpStatus.PRECONDITION_FAILED,
      code: exception.code,
      detail: exception.message,
      correlation_id: correlationId,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const payload = exception.getResponse();
    const response = isRecord(payload) ? payload : {};
    const detail = readDetail(
      typeof payload === "string" ? payload : response,
      exception.message,
    );
    const fields = readFieldErrors(response.message);
    const code = fields
      ? "validation_failed"
      : readCode(response.code, detail, status);
    const chatRequest = readChatRequestReceipt(response.chat_request, code);

    return {
      type: problemType(code),
      title: fields ? "Validation Failed" : readTitle(response.error, status),
      status,
      code,
      ...(detail ? { detail } : {}),
      ...(fields ? { fields } : {}),
      ...(status === 429 && Number.isSafeInteger(response.retry_after_seconds ?? response.retryAfterSeconds) && Number(response.retry_after_seconds ?? response.retryAfterSeconds) > 0 ? { retry_after_seconds: Number(response.retry_after_seconds ?? response.retryAfterSeconds) } : {}),
      ...(chatRequest ? { chat_request: chatRequest } : {}),
      correlation_id: correlationId,
    };
  }

  return {
    type: problemType("internal_error"),
    title: "Internal Server Error",
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: "internal_error",
    detail: "An unexpected error occurred.",
    correlation_id: correlationId,
  };
}

// Only this explicit receipt projection crosses the public error boundary.
// Never pass through arbitrary exception payloads, cached offers or message text.
function readChatRequestReceipt(value: unknown, code: string) {
  const states: Record<string, "processing" | "unknown" | "completed" | "rejected" | "reconciled"> = {
    chat_message_in_progress: "processing",
    chat_message_reconciliation_required: "unknown",
    chat_message_already_completed: "completed",
    chat_message_rejected: "rejected",
    chat_message_reconciled: "reconciled",
  };
  if (!states[code] || !isRecord(value) || value.status !== states[code]
    || typeof value.message_id !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(value.message_id)
    || value.next_action !== "refresh_session") return undefined;
  return { message_id: value.message_id, status: states[code], next_action: "refresh_session" as const };
}

function readDetail(payload: string | Record<string, unknown>, fallback: string): string {
  if (typeof payload === "string") return payload;
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.message === "string") return payload.message;
  if (Array.isArray(payload.message)) return "One or more fields are invalid.";
  return fallback;
}

function readFieldErrors(value: unknown): Record<string, string[]> | undefined {
  if (!Array.isArray(value)) return undefined;

  const fields: Record<string, string[]> = {};
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const field = entry.split(" ")[0] || "request";
    fields[field] = [...(fields[field] ?? []), entry];
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function readCode(value: unknown, detail: string, status: number): string {
  if (typeof value === "string" && value.trim()) return normalizeCode(value);
  if (detail && !detail.includes(" ")) return normalizeCode(detail);
  return STATUS_CODES[status] ?? "request_failed";
}

function readTitle(value: unknown, status: number): string {
  if (typeof value === "string" && value.trim()) return value;
  return STATUS_TITLES[status] ?? "Request Failed";
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function problemType(code: string): string {
  return `https://docs.aacp.dev/problems/${encodeURIComponent(code)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUS_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  412: "Precondition Failed",
  422: "Unprocessable Entity",
  428: "Precondition Required",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  422: "validation_failed",
  428: "precondition_required",
  429: "rate_limit_exceeded",
  500: "internal_error",
};
