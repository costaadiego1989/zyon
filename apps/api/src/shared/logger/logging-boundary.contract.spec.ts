import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import pino, { type LoggerOptions } from "pino";
import { pinoHttp, type Options as HttpLoggerOptions } from "pino-http";
import { Controller, Get, HttpException, Logger, Module, ConsoleLogger, type ArgumentsHost, type ExecutionContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { LoggerModule as PinoModule, Logger as PinoNestLogger } from "nestjs-pino";
import { firstValueFrom, lastValueFrom, of, throwError, toArray } from "rxjs";
import { trace, context, propagation } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { LoggerModule } from "./logger.module.js";
import { CorrelationIdStorage } from "./correlation-id.storage.js";
import { correlationIdMiddleware } from "../http/correlation-id.middleware.js";
import { ProblemDetailsFilter, toProblemDetails } from "../http/problem-details.filter.js";
import { ObservabilityInterceptor } from "../observability/observability.interceptor.js";
import { SentryExceptionFilter } from "../observability/sentry-exception.filter.js";
import { __setSentrySdkForTesting } from "../observability/sentry.module.js";
import { createTracingSdk } from "../observability/tracing-sdk.js";

// Read the real shared module factory, not a duplicate test configuration.
function settings(): HttpLoggerOptions {
  const modules = Reflect.getMetadata("imports", LoggerModule) as Array<{ providers: Array<{ useFactory?: () => { pinoHttp: HttpLoggerOptions } }> }>;
  return modules[0]!.providers.find(provider => provider.useFactory)!.useFactory!().pinoHttp;
}
function logs() {
  let output = "";
  const sink = { write(chunk: string) { output += chunk; } };
  return { sink, events: () => output.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) as Array<Record<string, any>> };
}
const privateAbsent = (value: unknown) => assert.ok(!JSON.stringify(value).includes("PRIVATE"));
function filterHarness() {
  const entries: unknown[] = [], headers: Record<string, unknown> = {};
  const request = { method: "POST", path: "/PRIVATE_BUYER", originalUrl: "/PRIVATE_BUYER?token=PRIVATE_TOKEN", url: "/PRIVATE_BUYER",
    correlationId: "public-correlation", headers: { "x-correlation-id": "PRIVATE_HEADER" } };
  const response = { headersSent: false, statusCode: 0, body: undefined as unknown,
    setHeader: (key: string, value: unknown) => { headers[key] = value; },
    status(value: number) { this.statusCode = value; return this; }, type(_value: string) { return this; }, send(value: unknown) { this.body = value; return this; } };
  const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ArgumentsHost;
  const logger = { error: (...args: unknown[]) => entries.push(args), warn: (...args: unknown[]) => entries.push(args), debug: (...args: unknown[]) => entries.push(args) };
  return { entries, headers, request, response, host, logger };
}
function interceptorHarness() {
  const entries: unknown[] = [], metrics = { total: 0, duration: 0 };
  const interceptor = new ObservabilityInterceptor({ apiOperationTotal: { inc: () => metrics.total++ },
    apiOperationDuration: { observe: () => metrics.duration++ } } as never);
  Object.assign(interceptor, { logger: { debug: (...args: unknown[]) => entries.push(args), warn: (...args: unknown[]) => entries.push(args) } });
  class TestController {} function execute() {}
  const execution = { getClass: () => TestController, getHandler: () => execute } as unknown as ExecutionContext;
  return { interceptor, entries, metrics, execution };
}

test("active HTTP middleware populates ALS without changing the public correlation header", async () => {
  const request = { headers: { "x-correlation-id": "public:request" }, header: () => "public:request" };
  const headers: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => correlationIdMiddleware(request as never, { setHeader: (key: string, value: unknown) => headers[key] = value } as never, () => {
    Promise.resolve().then(() => {
      try { assert.equal(CorrelationIdStorage.get(), "public:request"); resolve(); } catch (error) { reject(error); }
    });
  }));
  assert.equal(headers["x-correlation-id"], "public:request"); assert.equal(CorrelationIdStorage.get(), undefined);
});

test("concurrent active HTTP middleware scopes do not mix or leak correlation", async () => {
  await Promise.all(Array.from({ length: 5 }, (_, index) => new Promise<void>((resolve, reject) => {
    const id = `public:${index}`;
    correlationIdMiddleware({ headers: {}, header: () => id } as never, { setHeader: () => {} } as never, () => {
      Promise.resolve().then(() => { try { assert.equal(CorrelationIdStorage.get(), id); resolve(); } catch (error) { reject(error); } });
    });
  })));
  assert.equal(CorrelationIdStorage.get(), undefined);
});

test("reusing a public correlation header across requests does not reuse the internal request id", () => {
  const ids: Array<string | undefined> = [];
  for (let index = 0; index < 2; index++) correlationIdMiddleware({ headers: {}, header: () => "same-public-id" } as never,
    { setHeader: () => {} } as never, () => ids.push(CorrelationIdStorage.getRequestId()));
  assert.ok(ids.every(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)));
  assert.notEqual(ids[0], ids[1]); assert.equal(CorrelationIdStorage.getRequestId(), undefined);
});

test("Pino serializer projects request metadata without body, arbitrary headers, IP or URL", () => {
  const f = logs(), options = settings();
  const logger = pino({ ...options, transport: undefined, level: "debug" } as LoggerOptions, f.sink);
  const req = { method: "POST", url: "/PRIVATE_ID?email=PRIVATE_EMAIL", originalUrl: "/PRIVATE_ID", headers: { "x-custom": "PRIVATE_HEADER" },
    body: { user_message: "PRIVATE_PROMPT", history: ["PRIVATE_HISTORY"] }, query: { q: "PRIVATE_QUERY" }, remoteAddress: "PRIVATE_IP" };
  const snapshot = JSON.stringify(req);
  logger.info({ req, res: { statusCode: 503, headers: { "set-cookie": "PRIVATE_COOKIE" }, body: "PRIVATE_BODY" } }, "request_probe");
  privateAbsent(f.events()); assert.equal(JSON.stringify(req), snapshot);
  assert.equal(f.events()[0]?.req.method, "POST"); assert.equal(f.events()[0]?.res.statusCode, 503);
});

for (const error of [new Error("PRIVATE_ERROR"), new HttpException({ code: "PRIVATE_CODE", message: "PRIVATE_MESSAGE" }, 503),
  { message: "PRIVATE_OBJECT", stack: "PRIVATE_STACK", code: "PRIVATE_CODE" }, "PRIVATE_THROW"]) {
  test(`Pino error serializer never emits exception text, code or stack: ${typeof error}/${error instanceof Error}`, () => {
    const f = logs(); const logger = pino({ ...settings(), transport: undefined } as LoggerOptions, f.sink);
    logger.error({ err: error }, "operation_failed"); privateAbsent(f.events()); assert.equal(f.events()[0]?.msg, "operation_failed");
  });
}

test("logger configuration reads NODE_ENV at factory time rather than import time", () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  try { assert.equal(settings().transport, undefined); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("request context enrichment uses generated IDs, never caller correlation content", () => {
  const f = logs();
  CorrelationIdStorage.run("PRIVATE_CALLER", () => {
    const options = settings(), req = { headers: { "x-correlation-id": "PRIVATE_HEADER" } };
    const properties = typeof options.customProps === "function" ? options.customProps(req as never, {} as never) : {};
    const logger = pino({ ...options, transport: undefined } as LoggerOptions, f.sink);
    logger.info(properties, "context_probe");
  });
  privateAbsent(f.events()); assert.match(f.events()[0]?.requestId, /^[a-f0-9-]{36}$/);
});

for (const valid of [true, false]) {
  test(`trace enrichment validates context and keeps camel/snake aliases: valid=${valid}`, t => {
    t.mock.method(trace, "getActiveSpan", () => ({ spanContext: () => ({ traceId: valid ? "a".repeat(32) : "0".repeat(32), spanId: valid ? "b".repeat(16) : "0".repeat(16), traceFlags: 1 }) }));
    const f = logs(), logger = pino({ ...settings(), transport: undefined } as LoggerOptions, f.sink);
    logger.info("trace_probe"); const event = f.events()[0]!;
    assert.equal(event.traceId, valid ? "a".repeat(32) : undefined); assert.equal(event.trace_id, event.traceId);
    assert.equal(event.spanId, valid ? "b".repeat(16) : undefined); assert.equal(event.span_id, event.spanId);
  });
}

test("broken active-span lookup cannot break logging", t => {
  t.mock.method(trace, "getActiveSpan", () => { throw new Error("PRIVATE_CONTEXT_MANAGER"); });
  const f = logs(), logger = pino({ ...settings(), transport: undefined } as LoggerOptions, f.sink);
  assert.doesNotThrow(() => logger.info("context_failure")); privateAbsent(f.events());
});

test("explicit observation child-span IDs keep both aliases identical to the child, not the ambient parent", t => {
  t.mock.method(trace, "getActiveSpan", () => ({ spanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }) }));
  const f = logs(), logger = pino({ ...settings(), transport: undefined } as LoggerOptions, f.sink);
  const observation = { event: "storefront.observation", traceId: "a".repeat(32), spanId: "c".repeat(16) };
  logger.info(observation);
  assert.equal(f.events()[0]?.spanId, "c".repeat(16)); assert.equal(f.events()[0]?.span_id, "c".repeat(16));
  assert.equal(f.events()[0]?.traceId, f.events()[0]?.trace_id); assert.equal(Object.hasOwn(observation, "span_id"), false);
});

test("invalid explicit trace metadata is dropped instead of becoming arbitrary log content", () => {
  const f = logs(), logger = pino({ ...settings(), transport: undefined } as LoggerOptions, f.sink);
  logger.info({ traceId: "PRIVATE_TRACE", spanId: "PRIVATE_SPAN", trace_id: "PRIVATE_TRACE", span_id: "PRIVATE_SPAN", correlationId: "PRIVATE_CALLER" }, "metadata_probe");
  privateAbsent(f.events()); assert.equal(f.events()[0]?.traceId, undefined); assert.equal(f.events()[0]?.span_id, undefined);
});

test("real Pino HTTP completion does not log private URLs, arbitrary headers, body or error", async () => {
  const f = logs(), options = settings();
  const middleware = pinoHttp({ ...options, transport: undefined }, f.sink);
  let receivedUrl: string | undefined;
  const server = createServer((req, res) => middleware(req, res, () => {
    receivedUrl = req.url; Object.assign(res, { err: new Error("PRIVATE_EXCEPTION") });
    res.statusCode = 503; res.setHeader("set-cookie", "PRIVATE_COOKIE"); res.end("ok");
  }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/PRIVATE_PATH?token=PRIVATE_TOKEN`, { headers: { "x-correlation-id": "PRIVATE_CORRELATION", "x-custom": "PRIVATE_CUSTOM" } });
    assert.equal(response.status, 503); await response.text();
    assert.equal(receivedUrl, "/PRIVATE_PATH?token=PRIVATE_TOKEN"); privateAbsent(f.events());
    assert.equal(f.events().at(-1)?.res.statusCode, 503);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("problem filter logs bounded metadata but leaves the public error payload unchanged", () => {
  const f = filterHarness(), filter = new ProblemDetailsFilter(); Object.assign(filter, { logger: f.logger });
  const error = new HttpException({ message: "PRIVATE_PUBLIC_DETAIL", code: "PRIVATE_PUBLIC_CODE" }, 503);
  filter.catch(error, f.host);
  assert.deepEqual(f.response.body, toProblemDetails(error, "public-correlation"));
  assert.equal(f.response.statusCode, 503); privateAbsent(f.entries);
});

test("problem filter telemetry failure cannot prevent the original response", () => {
  const f = filterHarness(), filter = new ProblemDetailsFilter(); Object.assign(filter, { logger: { error: () => { throw new Error("PRIVATE_LOGGER"); } } });
  assert.doesNotThrow(() => filter.catch(new Error("PRIVATE_ERROR"), f.host)); assert.equal(f.response.statusCode, 500);
});

test("problem filter does not write again after headers have been sent", () => {
  const f = filterHarness(), filter = new ProblemDetailsFilter(); f.response.headersSent = true;
  Object.assign(filter, { logger: f.logger }); filter.catch(new Error("PRIVATE_LATE_ERROR"), f.host);
  assert.equal(f.response.statusCode, 0); assert.equal(f.response.body, undefined);
});

test("problem filter retains retry-after and bounded chat receipts", () => {
  const f = filterHarness(), filter = new ProblemDetailsFilter(); Object.assign(filter, { logger: f.logger });
  const error = new HttpException({ code: "RATE_LIMIT_EXCEEDED", retry_after_seconds: 7, message: "rate_limit_exceeded" }, 429);
  filter.catch(error, f.host); assert.equal(f.headers["Retry-After"], "7"); assert.deepEqual(f.response.body, toProblemDetails(error, "public-correlation"));
});

test("Sentry filter forwards only a normalized exception and bounded tags to the SDK seam", () => {
  const f = filterHarness(), filter = new SentryExceptionFilter(), captured: unknown[] = [], tags: unknown[] = [];
  Object.assign(filter, { logger: f.logger });
  __setSentrySdkForTesting({ withScope: callback => callback({ setTag: (...args) => tags.push(args) }), captureException: error => captured.push(error) }, true);
  try {
    filter.catch(new Error("PRIVATE_ERROR"), f.host); assert.equal(captured.length, 1);
    privateAbsent([f.entries, tags, captured.map(error => ({ ...error as object, message: (error as Error).message, stack: (error as Error).stack }))]);
    assert.equal(f.response.statusCode, 500);
  } finally { __setSentrySdkForTesting(null, false); }
});

test("Sentry SDK and logger failures never prevent a response or leak their exception text", () => {
  const f = filterHarness(), filter = new SentryExceptionFilter(); Object.assign(filter, { logger: f.logger });
  __setSentrySdkForTesting({ withScope: () => { throw new Error("PRIVATE_SDK_TOKEN"); }, captureException: () => {} }, true);
  try { filter.catch(new Error("PRIVATE_ERROR"), f.host); assert.equal(f.response.statusCode, 500); privateAbsent(f.entries); }
  finally { __setSentrySdkForTesting(null, false); }
});

test("a failing Sentry local logger cannot block the public error response", () => {
  const f = filterHarness(), filter = new SentryExceptionFilter();
  Object.assign(filter, { logger: { error: () => { throw new Error("PRIVATE_SINK"); }, warn: () => { throw new Error("PRIVATE_SINK"); } } });
  __setSentrySdkForTesting({ withScope: () => { throw new Error("PRIVATE_SDK"); }, captureException: () => {} }, true);
  try { assert.doesNotThrow(() => filter.catch(new Error("PRIVATE_ERROR"), f.host)); assert.equal(f.response.statusCode, 500); }
  finally { __setSentrySdkForTesting(null, false); }
});

test("unknown HTTP method is reduced to OTHER instead of logging its contents", () => {
  const f = logs(), logger = pino({ ...settings(), transport: undefined } as LoggerOptions, f.sink);
  logger.info({ req: { method: "PRIVATE_METHOD" } }, "method_probe");
  assert.equal(f.events()[0]?.req.method, "OTHER"); privateAbsent(f.events());
});

test("interceptor error metadata is bounded and exception identity is unchanged", async () => {
  const f = interceptorHarness(), error = new Error("PRIVATE_PROVIDER_ERROR"); Object.assign(error, { code: "PRIVATE_CODE" });
  await assert.rejects(firstValueFrom(f.interceptor.intercept(f.execution, { handle: () => throwError(() => error) })), value => value === error);
  assert.equal(f.metrics.total, 1); privateAbsent(f.entries);
});

test("interceptor records one completed operation, not each stream value", async () => {
  const f = interceptorHarness(); let calls = 0;
  const result = await lastValueFrom(f.interceptor.intercept(f.execution, { handle: () => { calls++; return of(1, 2, 3); } }).pipe(toArray()));
  assert.deepEqual(result, [1, 2, 3]); assert.equal(calls, 1); assert.equal(f.metrics.total, 1); assert.equal(f.metrics.duration, 1);
});

test("interceptor logger failure cannot turn success into error or replay work", async () => {
  const f = interceptorHarness(); let calls = 0;
  Object.assign(f.interceptor, { logger: { debug: () => { throw new Error("PRIVATE_SINK"); }, warn: () => { throw new Error("PRIVATE_SINK"); } } });
  assert.equal(await lastValueFrom(f.interceptor.intercept(f.execution, { handle: () => { calls++; return of(42); } })), 42);
  assert.equal(calls, 1); assert.equal(f.metrics.total, 1);
});

test("synchronous handler failure is observed once without replacing the error", async () => {
  const f = interceptorHarness(), error = new Error("PRIVATE_SYNC"); let calls = 0;
  await assert.rejects(firstValueFrom(f.interceptor.intercept(f.execution, { handle: () => { calls++; throw error; } })), value => value === error);
  assert.equal(calls, 1); assert.equal(f.metrics.total, 1); privateAbsent(f.entries);
});

test("Nest/Pino service logs observe the active child span and share one generated request id", async () => {
  const f = logs(), memory = new InMemorySpanExporter();
  const sdk = await createTracingSdk({ endpoint: "http://127.0.0.1:1/v1/traces", serviceName: "zyon-api", sampler: "always_on", sampleRatio: 1, autoInstrumentation: false }, memory);
  sdk.start();
  let traceId: string | undefined, spanId: string | undefined;
  @Controller("probe") class ProbeController {
    @Get() execute() {
      return trace.getTracer("test").startActiveSpan("storefront.turn", span => {
        traceId = span.spanContext().traceId; spanId = span.spanContext().spanId;
        new Logger("Probe").log({ event: "storefront.probe" }); span.end();
        return { status: "ok", correlation: CorrelationIdStorage.get() };
      });
    }
  }
  @Module({ imports: [PinoModule.forRoot({ pinoHttp: [{ ...settings(), transport: undefined }, f.sink] })], controllers: [ProbeController] })
  class LocalModule { configure(consumer: { apply: (...args: unknown[]) => { forRoutes: (path: string) => void } }) { consumer.apply(correlationIdMiddleware).forRoutes("*"); } }
  const app = await NestFactory.create(LocalModule, { logger: false, forceCloseConnections: true });
  try {
    app.useLogger(app.get(PinoNestLogger)); await app.listen(0, "127.0.0.1");
    const response = await fetch(`${await app.getUrl()}/probe?token=PRIVATE_QUERY`, { headers: { "x-correlation-id": "PRIVATE_CALLER" } });
    assert.equal(response.headers.get("x-correlation-id"), "PRIVATE_CALLER");
    assert.equal((await response.json() as { correlation: string }).correlation, "PRIVATE_CALLER");
    const event = f.events().find(value => value.event === "storefront.probe")!;
    assert.ok(event); assert.equal(event.traceId, traceId); assert.equal(event.trace_id, traceId); assert.equal(event.spanId, spanId);
    assert.match(event.requestId, /^[a-f0-9-]{36}$/); privateAbsent(f.events());
    assert.equal(event.reqId, event.requestId);
    const completion = f.events().find(value => value.res?.statusCode === 200)!;
    assert.equal(completion.requestId, event.requestId);
  } finally {
    await app.close(); await sdk.shutdown(); trace.disable(); context.disable(); propagation.disable(); Logger.overrideLogger(new ConsoleLogger());
  }
});

test("production composition and legacy wrapper use the same safe factory and bootstrap logger", async () => {
  const source = await readFile(new URL("../../../src/app.module.ts", import.meta.url), "utf8");
  assert.match(source, /createHttpLoggerOptions/); assert.doesNotMatch(source, /serializers:\s*\{ req: redactRequestUrl/);
  const main = await readFile(new URL("../../../src/application-bootstrap.ts", import.meta.url), "utf8");
  assert.match(main, /bufferLogs:\s*true/); assert.match(main, /app\.useLogger\(app\.get\(PinoLogger\)\)/);
});

