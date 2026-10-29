import assert from "node:assert/strict";
import { HttpException, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import {
  RateLimit,
  SKIP_RATE_LIMIT_KEY,
  SkipRateLimit,
} from "./rate-limit.decorators.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimitStore } from "./rate-limit.store.js";

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

interface FakeRequest extends Mutable<Pick<Request, "ip" | "method" | "path" | "baseUrl" | "headers">> {
  socket?: { remoteAddress?: string };
}

function makeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    method: "GET",
    path: "/v1/widgets",
    baseUrl: "",
    ip: "203.0.113.10",
    headers: {},
    ...overrides,
  };
}

function makeResponse(): Response {
  const headers: Record<string, string> = {};
  return {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
    headers,
  } as unknown as Response;
}

function makeContext(
  request: FakeRequest,
  response: Response,
  handlerOrClass: { handler?: object; cls?: object } = {},
) {
  return {
    switchToHttp: () => ({
      getRequest: () => request as unknown as Request,
      getResponse: () => response,
    }),
    getHandler: () => handlerOrClass.handler ?? (() => undefined),
    getClass: () => handlerOrClass.cls ?? class TestController {},
  } as never;
}

const DEFAULT_OPTIONS = { max: 3, windowMs: 60_000, countFailedRequests: true };

describe("RateLimitGuard", () => {
  it("allows requests under the configured budget and emits headers", () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimitStore(), DEFAULT_OPTIONS);
    const response = makeResponse();

    const ok = guard.canActivate(makeContext(makeRequest(), response));
    assert.equal(ok, true);
    assert.equal(response.getHeader("X-RateLimit-Limit"), "3");
    assert.equal(response.getHeader("X-RateLimit-Remaining"), "2");
    assert.ok(response.getHeader("X-RateLimit-Reset"));
    assert.equal(response.getHeader("Retry-After"), undefined);
  });

  it("throws 429 once the budget is exhausted and sets Retry-After", () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimitStore(), DEFAULT_OPTIONS);

    for (let i = 0; i < DEFAULT_OPTIONS.max; i++) {
      const r = makeResponse();
      assert.equal(guard.canActivate(makeContext(makeRequest(), r)), true);
    }

    const blocked = makeResponse();
    assert.throws(
      () => guard.canActivate(makeContext(makeRequest(), blocked)),
      (err: unknown) => {
        assert.ok(err instanceof HttpException);
        const httpErr = err as HttpException;
        assert.equal(httpErr.getStatus(), HttpStatus.TOO_MANY_REQUESTS);
        const body = httpErr.getResponse() as { message: string; retryAfterSeconds: number };
        assert.equal(body.message, "rate_limit_exceeded");
        assert.ok(body.retryAfterSeconds >= 1);
        return true;
      },
    );
    assert.ok(blocked.getHeader("Retry-After"));
    assert.equal(blocked.getHeader("X-RateLimit-Remaining"), "0");
  });

  it("isolates buckets per IP", () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimitStore(), DEFAULT_OPTIONS);

    for (let i = 0; i < DEFAULT_OPTIONS.max; i++) {
      guard.canActivate(makeContext(makeRequest({ ip: "203.0.113.10" }), makeResponse()));
    }
    // ip A is exhausted; ip B should still pass
    assert.doesNotThrow(() =>
      guard.canActivate(makeContext(makeRequest({ ip: "198.51.100.7" }), makeResponse())),
    );
  });

  it("honors X-Forwarded-For when present", () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimitStore(), DEFAULT_OPTIONS);
    const request = makeRequest({
      ip: "10.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.55, 10.0.0.1" },
    });

    for (let i = 0; i < DEFAULT_OPTIONS.max; i++) {
      assert.equal(guard.canActivate(makeContext(request, makeResponse())), true);
    }
    assert.throws(() => guard.canActivate(makeContext(request, makeResponse())));
  });

  it("skips the limiter for excluded health paths", () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimitStore(), DEFAULT_OPTIONS);
    for (const path of ["/health", "/ready", "/readyz", "/livez", "/metrics"]) {
      for (let i = 0; i < DEFAULT_OPTIONS.max + 5; i++) {
        assert.equal(
          guard.canActivate(makeContext(makeRequest({ path }), makeResponse())),
          true,
          `expected ${path} to bypass`,
        );
      }
    }
  });

  it("honors @SkipRateLimit on a handler", () => {
    const reflector = new Reflector();
    const guard = new RateLimitGuard(reflector, new RateLimitStore(), DEFAULT_OPTIONS);

    class Probe {
      @SkipRateLimit()
      handler(): void {
        /* noop */
      }
    }

    const ctx = makeContext(makeRequest(), makeResponse(), {
      handler: Probe.prototype.handler,
    });
    for (let i = 0; i < 10; i++) {
      assert.equal(guard.canActivate(ctx), true);
    }
  });

  it("per-route @RateLimit override tightens the budget", () => {
    const reflector = new Reflector();
    const guard = new RateLimitGuard(reflector, new RateLimitStore(), DEFAULT_OPTIONS);

    class Probe {
      @RateLimit(1, 60_000)
      handler(): void {
        /* noop */
      }
    }

    const ctx = makeContext(makeRequest(), makeResponse(), {
      handler: Probe.prototype.handler,
    });
    assert.equal(guard.canActivate(ctx), true);
    assert.throws(() => guard.canActivate(ctx));
  });

  it("evicts expired buckets to bound memory", () => {
    const store = new RateLimitStore();
    const guard = new RateLimitGuard(new Reflector(), store, { max: 2, windowMs: 60_000, countFailedRequests: true });

    guard.canActivate(makeContext(makeRequest({ ip: "203.0.113.1" }), makeResponse()));
    guard.canActivate(makeContext(makeRequest({ ip: "203.0.113.2" }), makeResponse()));

    const future = Date.now() + 120_000;
    const removed = store.evictExpired(future);
    assert.equal(removed, 2);
    assert.equal(store.evictExpired(future), 0);
  });

  it("falls back to socket.remoteAddress when ip is missing", () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimitStore(), DEFAULT_OPTIONS);
    const request = makeRequest({ ip: undefined, socket: { remoteAddress: "203.0.113.99" } });
    assert.equal(guard.canActivate(makeContext(request, makeResponse())), true);
  });

  it("ignores invalid env-derived config rather than blocking traffic", () => {
    const bad = { max: 0, windowMs: 0, countFailedRequests: true };
    const guard = new RateLimitGuard(new Reflector(), new RateLimitStore(), bad);
    assert.equal(guard.canActivate(makeContext(makeRequest(), makeResponse())), true);
  });

  it("decorator metadata key is exported", () => {
    assert.equal(typeof SKIP_RATE_LIMIT_KEY, "string");
  });
});
