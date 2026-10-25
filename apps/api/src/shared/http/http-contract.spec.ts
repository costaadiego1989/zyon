import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ProblemDetailsSchema } from "@zyon/contracts";
import type { NextFunction, Response } from "express";
import { EntityTagService } from "./entity-tag.service.js";
import {
  PreconditionFailedException,
  PreconditionRequiredException,
} from "./http-contract.errors.js";
import type { AacpHttpRequest } from "./http-request.js";
import { correlationIdMiddleware } from "./correlation-id.middleware.js";
import { toProblemDetails } from "./problem-details.filter.js";

describe("HTTP contract guarantees", () => {
  it("preserves only the bounded chat receipt through the public problem-details contract", () => {
    for (const [code, status] of [
      ["CHAT_MESSAGE_IN_PROGRESS", "processing"], ["CHAT_MESSAGE_RECONCILIATION_REQUIRED", "unknown"],
      ["CHAT_MESSAGE_ALREADY_COMPLETED", "completed"], ["CHAT_MESSAGE_REJECTED", "rejected"],
      ["CHAT_MESSAGE_RECONCILED", "reconciled"],
    ]) {
      const receipt = { message_id: "message_00000001", status, next_action: "refresh_session" };
      const problem = toProblemDetails(new ConflictException({ code,
        chat_request: { ...receipt, text: "private buyer text", secret: "not-public" },
        response: { authorized_offer: { id: "old-offer" } },
      }), "corr_chat");
      assert.equal(problem.code, code.toLowerCase());
      const parsed = ProblemDetailsSchema.parse(problem);
      assert.deepEqual(parsed.chat_request, receipt);
      assert.doesNotMatch(JSON.stringify(problem), /private buyer|not-public|old-offer/);
    }
  });

  it("does not expose malformed or unrelated chat receipt metadata", () => {
    for (const patch of [{ code: "UNRELATED_ERROR" }, { status: "completed" }, { message_id: "bad" }, { next_action: "repeat_payment" }]) {
      const { code = "CHAT_MESSAGE_IN_PROGRESS", ...receiptPatch } = patch;
      const problem = toProblemDetails(new ConflictException({ code, chat_request: {
        message_id: "message_00000001", status: "processing", next_action: "refresh_session", ...receiptPatch,
      } }), "corr_chat");
      assert.equal(ProblemDetailsSchema.parse(problem).chat_request, undefined);
    }
  });

  it("propagates a valid correlation id and replaces an invalid one", () => {
    const supplied = runCorrelation("checkout:request-123");
    assert.equal(supplied.request.correlationId, "checkout:request-123");
    assert.equal(
      supplied.headers["x-correlation-id"],
      "checkout:request-123",
    );

    const generated = runCorrelation("contains spaces");
    assert.match(generated.request.correlationId ?? "", /^corr_/);
  });

  it("maps validation exceptions to RFC 7807 field errors", () => {
    const problem = toProblemDetails(
      new BadRequestException({
        message: ["email must be an email", "name should not be empty"],
        error: "Bad Request",
      }),
      "corr_123",
    );

    assert.equal(problem.status, 400);
    assert.equal(problem.code, "validation_failed");
    assert.deepEqual(problem.fields, {
      email: ["email must be an email"],
      name: ["name should not be empty"],
    });
    assert.equal(problem.correlation_id, "corr_123");
  });

  it("does not expose unexpected exception details", () => {
    const problem = toProblemDetails(
      new Error("database-password-was-here"),
      "corr_500",
    );

    assert.equal(problem.status, 500);
    assert.equal(problem.code, "internal_error");
    assert.doesNotMatch(problem.detail ?? "", /database-password/);
  });

  it("creates stable ETags and enforces If-Match", () => {
    const service = new EntityTagService();
    const tag = service.create({ b: 2, a: 1 });

    assert.equal(tag, service.create({ a: 1, b: 2 }));
    assert.doesNotThrow(() => service.assertIfMatch(tag, { a: 1, b: 2 }));
    assert.throws(
      () => service.assertIfMatch(undefined, { a: 1 }),
      PreconditionRequiredException,
    );
    assert.throws(
      () => service.assertIfMatch('"stale"', { a: 1 }),
      PreconditionFailedException,
    );
  });
});

function runCorrelation(value?: string): {
  request: AacpHttpRequest;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const request = {
    headers: value ? { "x-correlation-id": value } : {},
    header(name: string) {
      return this.headers[name.toLowerCase()];
    },
  } as AacpHttpRequest;
  const response = {
    setHeader(name: string, headerValue: string) {
      headers[name] = headerValue;
    },
  } as unknown as Response;

  correlationIdMiddleware(
    request,
    response,
    (() => undefined) as NextFunction,
  );
  return { request, headers };
}
