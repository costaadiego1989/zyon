import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { NextFunction, Response } from "express";
import { CorrelationIdMiddleware } from "./correlation-id.middleware.js";
import { CorrelationIdStorage } from "./correlation-id.storage.js";
import type { AacpHttpRequest } from "../http/http-request.js";

type HeaderBag = Record<string, string | undefined>;

function createRequest(headers: HeaderBag): AacpHttpRequest {
  return {
    header(name: string): string | undefined {
      const lower = name.toLowerCase();
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) {
          return headers[key];
        }
      }
      return undefined;
    },
    headers: { ...headers },
  } as unknown as AacpHttpRequest;
}

function createResponse(): Response & {
  headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  return {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    headers,
  } as unknown as Response & { headers: Map<string, string> };
}

describe("CorrelationIdMiddleware", () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it("generates a correlation id when none is supplied", () => {
    const request = createRequest({});
    const response = createResponse();
    let nextCalled = false;
    let capturedInsideNext: string | undefined;

    middleware.use(request, response, () => {
      nextCalled = true;
      capturedInsideNext = CorrelationIdStorage.get();
    });

    assert.equal(nextCalled, true, "next() must be invoked");
    assert.match(
      request.correlationId as string,
      /^corr_[0-9a-f-]{36}$/,
      "generated id must be corr_<uuid>",
    );
    assert.equal(
      capturedInsideNext,
      request.correlationId,
      "ALS must be populated inside next()",
    );
    assert.equal(
      response.headers.get("x-correlation-id"),
      request.correlationId,
      "response must echo the correlation id header",
    );
    assert.equal(
      CorrelationIdStorage.get(),
      undefined,
      "ALS frame must not leak past next()",
    );
  });

  it("accepts a well-formed inbound correlation id", () => {
    const supplied = "trace.abc_123-XYZ:42";
    const request = createRequest({ "x-correlation-id": supplied });
    const response = createResponse();
    let nextCalled = false;

    middleware.use(request, response, () => {
      nextCalled = true;
      assert.equal(CorrelationIdStorage.get(), supplied);
    });

    assert.equal(nextCalled, true);
    assert.equal(request.correlationId, supplied);
    assert.equal(response.headers.get("x-correlation-id"), supplied);
    assert.equal(
      request.headers["x-correlation-id"],
      supplied,
      "request header must be normalized",
    );
  });

  it("rejects malformed inbound ids and falls back to a generated one", () => {
    const malformed = "bad id with spaces and a\nnewline";
    const request = createRequest({ "x-correlation-id": malformed });
    const response = createResponse();
    let nextCalled = false;

    middleware.use(request, response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.notEqual(request.correlationId, malformed);
    assert.match(
      request.correlationId as string,
      /^corr_[0-9a-f-]{36}$/,
    );
    assert.equal(
      response.headers.get("x-correlation-id"),
      request.correlationId,
    );
  });

  it("rejects inbound ids that exceed the length cap", () => {
    const tooLong = `a`.repeat(129);
    const request = createRequest({ "x-correlation-id": tooLong });
    const response = createResponse();

    middleware.use(request, response, () => {});

    assert.match(request.correlationId as string, /^corr_/);
    assert.notEqual(request.correlationId, tooLong);
  });

  it("trims whitespace around an otherwise-valid id", () => {
    const request = createRequest({ "x-correlation-id": "  corr_clean  " });
    const response = createResponse();

    middleware.use(request, response, () => {});

    assert.equal(request.correlationId, "corr_clean");
  });

  it("isolates concurrent requests in their own ALS frames", () => {
    const reqA = createRequest({});
    const resA = createResponse();
    const reqB = createRequest({});
    const resB = createResponse();

    let idInsideA: string | undefined;
    let idInsideB: string | undefined;

    middleware.use(reqA, resA, () => {
      idInsideA = CorrelationIdStorage.get();
    });
    middleware.use(reqB, resB, () => {
      idInsideB = CorrelationIdStorage.get();
    });

    assert.ok(idInsideA, "frame A must observe its own id");
    assert.ok(idInsideB, "frame B must observe its own id");
    assert.notEqual(idInsideA, idInsideB, "frames must not share state");
    assert.equal(reqA.correlationId, idInsideA);
    assert.equal(reqB.correlationId, idInsideB);
  });

  it("exposes the pattern and header constants for downstream use", () => {
    assert.equal(CorrelationIdStorage.HEADER, "x-correlation-id");
    assert.ok(CorrelationIdStorage.PATTERN instanceof RegExp);
    assert.equal(CorrelationIdStorage.isValid("ok_id-1.2:3"), true);
    assert.equal(CorrelationIdStorage.isValid("with space"), false);
  });
});