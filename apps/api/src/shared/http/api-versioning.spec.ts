import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  apiVersioningMiddleware,
  isVersionedRequest,
  stripPublicApiPrefix,
} from "./api-versioning.js";

describe("API V1 compatibility routing", () => {
  it("recognizes only the complete v1 path segment", () => {
    assert.equal(isVersionedRequest("/v1/orders"), true);
    assert.equal(isVersionedRequest("/v1?expand=tenant"), true);
    assert.equal(isVersionedRequest("/v10/orders"), false);
  });

  it("strips v1 while preserving query strings", () => {
    assert.equal(stripPublicApiPrefix("/v1/orders?limit=20"), "/orders?limit=20");
    assert.equal(stripPublicApiPrefix("/v1"), "/");
    assert.equal(stripPublicApiPrefix("/orders"), "/orders");
  });

  it("rewrites versioned requests and marks legacy requests as deprecated", () => {
    const versioned = runMiddleware("/v1/orders?limit=20");
    assert.equal(versioned.url, "/orders?limit=20");
    assert.equal(versioned.headers["AACP-API-Version"], "v1");
    assert.equal(versioned.headers.Deprecation, undefined);

    const legacy = runMiddleware("/orders");
    assert.equal(legacy.url, "/orders");
    assert.equal(legacy.headers.Deprecation, "true");
    assert.match(legacy.headers.Link ?? "", /rel="deprecation"/);
  });
});

function runMiddleware(url: string): {
  url: string;
  headers: Record<string, string>;
} {
  const request = { url } as Request;
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
  } as unknown as Response;
  let called = false;

  apiVersioningMiddleware(
    request,
    response,
    (() => {
      called = true;
    }) as NextFunction,
  );

  assert.equal(called, true);
  return { url: request.url, headers };
}
