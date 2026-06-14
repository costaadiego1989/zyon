import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { firstValueFrom, of } from "rxjs";
import type { AacpHttpRequest } from "../http-request.js";
import {
  IDEMPOTENCY_OPTIONS,
} from "./idempotent.decorator.js";
import { IdempotencyInterceptor } from "./idempotency.interceptor.js";
import type {
  IdempotencyClaim,
  IdempotencyClaimInput,
  IdempotencyReplay,
  IdempotencyRepository,
} from "./idempotency.repository.js";

describe("IdempotencyInterceptor", () => {
  it("stores the first response before returning it", async () => {
    const repository = new MemoryIdempotencyRepository();
    const interceptor = new IdempotencyInterceptor(
      new Reflector(),
      repository,
    );
    const fixture = httpFixture("idem_order_123");

    const result = await firstValueFrom(
      interceptor.intercept(fixture.context, {
        handle: () => of({ order_id: "ord_1" }),
      }),
    );

    assert.deepEqual(result, { order_id: "ord_1" });
    assert.equal(repository.completed?.statusCode, 201);
    assert.deepEqual(repository.completed?.responseBody, {
      order_id: "ord_1",
    });
  });

  it("replays a completed response without invoking the handler", async () => {
    const repository = new MemoryIdempotencyRepository();
    repository.nextClaim = {
      outcome: "replay",
      replay: {
        statusCode: 201,
        responseBody: { order_id: "ord_existing" },
        responseHeaders: { etag: '"etag_1"' },
      },
    };
    const interceptor = new IdempotencyInterceptor(
      new Reflector(),
      repository,
    );
    const fixture = httpFixture("idem_order_123");
    let invoked = false;

    const result = await firstValueFrom(
      interceptor.intercept(fixture.context, {
        handle: () => {
          invoked = true;
          return of({});
        },
      }),
    );

    assert.equal(invoked, false);
    assert.deepEqual(result, { order_id: "ord_existing" });
    assert.equal(fixture.headers["Idempotency-Replayed"], "true");
  });

  it("keeps the claim when persisting the completed response fails", async () => {
    const repository = new MemoryIdempotencyRepository();
    repository.failCompletion = true;
    const interceptor = new IdempotencyInterceptor(
      new Reflector(),
      repository,
    );
    const fixture = httpFixture("idem_order_123");

    await assert.rejects(
      () =>
        firstValueFrom(
          interceptor.intercept(fixture.context, {
            handle: () => of({ order_id: "ord_1" }),
          }),
        ),
      /idempotency_storage_unavailable/,
    );
    assert.equal(repository.releaseCount, 0);
  });
});

class MemoryIdempotencyRepository implements IdempotencyRepository {
  nextClaim: IdempotencyClaim = {
    outcome: "acquired",
    recordId: "idem_record_1",
  };
  completed?: IdempotencyReplay;
  failCompletion = false;
  releaseCount = 0;

  async claim(_input: IdempotencyClaimInput): Promise<IdempotencyClaim> {
    return this.nextClaim;
  }

  async complete(
    _recordId: string,
    _merchantId: string,
    _requestFingerprint: string,
    replay: IdempotencyReplay,
  ): Promise<void> {
    if (this.failCompletion) {
      throw new Error("idempotency_storage_unavailable");
    }
    this.completed = replay;
  }

  async release(): Promise<void> {
    this.releaseCount += 1;
  }
}

function httpFixture(idempotencyKey: string): {
  context: ExecutionContext;
  headers: Record<string, string>;
} {
  const handler = () => undefined;
  Reflect.defineMetadata(IDEMPOTENCY_OPTIONS, {}, handler);
  const request = {
    tenantPrincipal: {
      kind: "human",
      tenantId: "mrc_1",
      userId: "usr_1",
      email: "owner@example.com",
      role: "owner",
    },
    method: "POST",
    originalUrl: "/v1/orders",
    url: "/orders",
    query: {},
    body: { cart_id: "cart_1" },
    header(name: string) {
      return name.toLowerCase() === "idempotency-key"
        ? idempotencyKey
        : undefined;
    },
  } as AacpHttpRequest;
  const headers: Record<string, string> = {};
  const responseLike: {
    statusCode: number;
    status(value: number): unknown;
    setHeader(name: string, value: string): unknown;
    getHeader(name: string): string | undefined;
  } = {
    statusCode: 201,
    status(value: number) {
      responseLike.statusCode = value;
      return responseLike;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return responseLike;
    },
    getHeader(name: string) {
      return headers[name];
    },
  };
  const response = responseLike as unknown as Response;

  const context = {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, headers };
}
