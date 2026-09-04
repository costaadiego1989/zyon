import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { ArgumentsHost } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { SentryExceptionFilter } from "./sentry-exception.filter.js";
import { __setSentrySdkForTesting } from "./sentry.module.js";

interface StubHeaders {
  [key: string]: string | string[] | undefined;
}

type StubResponse = {
  headersSent: boolean;
  status: ReturnType<typeof mock.fn>;
  type: ReturnType<typeof mock.fn>;
  setHeader: ReturnType<typeof mock.fn>;
  send: ReturnType<typeof mock.fn>;
};

function buildHost(opts: {
  path?: string;
  method?: string;
  correlationId?: string;
}): {
  host: ArgumentsHost;
  response: StubResponse;
} {
  const headers: StubHeaders = {};
  if (opts.correlationId) headers["x-correlation-id"] = opts.correlationId;
  const request = {
    path: opts.path ?? "/throw",
    method: opts.method ?? "POST",
    headers,
  } as unknown as Request;

  const status = mock.fn(function statusMock(this: unknown) {
    return this as unknown as Response;
  });
  const type = mock.fn(function typeMock(this: unknown) {
    return this as unknown as Response;
  });
  const setHeader = mock.fn();
  const send = mock.fn(function sendMock(this: unknown) {
    return this as unknown as Response;
  });
  const response = {
    headersSent: false,
    status,
    type,
    setHeader,
    send,
  } as unknown as StubResponse;

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

function makeFakeSdk() {
  const captured: unknown[] = [];
  let withScopeCalled = 0;
  const sdk = {
    withScope: (cb: (scope: { setTag: (k: string, v: string) => void }) => void) => {
      withScopeCalled += 1;
      cb({ setTag: () => undefined });
    },
    captureException: (err: unknown) => {
      captured.push(err);
    },
  };
  return {
    sdk,
    captured,
    get withScopeCalls(): number {
      return withScopeCalled;
    },
  };
}

describe("SentryExceptionFilter", () => {
  afterEach(() => {
    __setSentrySdkForTesting(null, false);
  });

  it("responds with 400 + problem+json for HttpException", () => {
    const filter = new SentryExceptionFilter();
    const { host, response } = buildHost({});

    filter.catch(
      new HttpException({ message: "boom" }, HttpStatus.BAD_REQUEST),
      host,
    );

    assert.equal(response.status.mock.calls.length, 1);
    assert.equal(response.status.mock.calls[0]?.arguments[0], HttpStatus.BAD_REQUEST);
    assert.equal(
      response.type.mock.calls[0]?.arguments[0],
      "application/problem+json",
    );
    const body = response.send.mock.calls[0]?.arguments[0] as {
      status?: number;
      code?: string;
    };
    assert.equal(body.status, HttpStatus.BAD_REQUEST);
  });

  it("returns 500 with problem+json for non-HttpException throws", () => {
    const filter = new SentryExceptionFilter();
    const { host, response } = buildHost({});

    filter.catch(new Error("oh no"), host);

    assert.equal(response.status.mock.calls[0]?.arguments[0], 500);
    const body = response.send.mock.calls[0]?.arguments[0] as {
      status?: number;
      code?: string;
    };
    assert.equal(body.status, 500);
    assert.equal(body.code, "internal_error");
  });

  it("does not write twice when response headers were already sent", () => {
    const filter = new SentryExceptionFilter();
    const harness = buildHost({});
    Object.assign(harness.response, { headersSent: true });

    assert.doesNotThrow(() => {
      filter.catch(new Error("late"), harness.host);
    });
    assert.equal(harness.response.status.mock.calls.length, 0);
  });

  it("skips Sentry capture entirely when the integration is disabled", () => {
    __setSentrySdkForTesting(null, false);
    const fake = makeFakeSdk();
    __setSentrySdkForTesting(fake.sdk, true);

    // Disable capture path by toggling back to disabled.
    __setSentrySdkForTesting(fake.sdk, false);

    const filter = new SentryExceptionFilter();
    const { host } = buildHost({});
    filter.catch(new Error("skip me"), host);

    assert.equal(fake.captured.length, 0);
    assert.equal(fake.withScopeCalls, 0);
  });

  it("captures server errors and plain errors but skips 4xx HttpExceptions", () => {
    const fake = makeFakeSdk();
    __setSentrySdkForTesting(fake.sdk, true);

    const filter = new SentryExceptionFilter();

    // 4xx — should NOT capture
    filter.catch(
      new HttpException("nope", HttpStatus.NOT_FOUND),
      buildHost({}).host,
    );

    // 5xx — should capture
    filter.catch(
      new HttpException("boom", HttpStatus.INTERNAL_SERVER_ERROR),
      buildHost({}).host,
    );

    // Plain Error — should capture
    filter.catch(new Error("explode"), buildHost({}).host);

    assert.equal(fake.captured.length, 2);
  });

  it("swallows Sentry SDK failures and still produces a response", () => {
    const failingSdk = {
      withScope: () => {
        throw new Error("network down");
      },
      captureException: () => undefined,
    };
    __setSentrySdkForTesting(failingSdk, true);

    const filter = new SentryExceptionFilter();
    const { host, response } = buildHost({});
    assert.doesNotThrow(() => {
      filter.catch(new Error("explode"), host);
    });
    assert.equal(response.status.mock.calls[0]?.arguments[0], 500);
  });
});