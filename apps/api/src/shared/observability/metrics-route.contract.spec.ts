import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Controller, Get, Module, Res, type INestApplication, type Type } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { NestFactory } from "@nestjs/core";
import { HttpModule } from "../http/http.module.js";
import { ObservabilityModule } from "./observability.module.js";
import { MetricsController } from "./metrics.controller.js";
import { MetricsController as CompatibilityMetricsController } from "../http/metrics.controller.js";
import { MetricsService } from "./metrics.service.js";
import { MetricsMiddleware, initMetrics, initDomainMetrics, getMetricsRegistry,
  recordCheckoutCreated, recordOrderCreated, recordPaymentProcessed, recordWebhookDelivery, recordWebhookError } from "../http/metrics.middleware.js";
import { apiVersioningMiddleware } from "../http/api-versioning.js";
import type { Request, Response } from "express";

// Use real registration metadata/controllers, Nest router, HTTP middleware and TCP.
// Deliberately omit unrelated domain providers, guards, DB/Redis and exporters.
@Controller("metrics-fixture")
class FixtureController {
  @Get("ok/:id") ok() { return { ok: true }; }
  @Get("fail") fail() { throw new Error("PRIVATE_ERROR"); }
  @Get("stream") stream(@Res() response: Response) { response.write("first"); response.end("last"); }
}

async function withApp(run: (app: { base: string; metrics: MetricsService; controllers: Type[] }) => Promise<void>, reverse = false) {
  const previousEnv = process.env.NODE_ENV;
  const previousSecret = process.env.OPS_SHARED_SECRET;
  let app: INestApplication | undefined;
  const metrics = new MetricsService();
  try {
    process.env.NODE_ENV = "production";
    process.env.OPS_SHARED_SECRET = "test-only-ops-secret";
    initMetrics(); initDomainMetrics();
    const modules = reverse ? [HttpModule, ObservabilityModule] : [ObservabilityModule, HttpModule];
    const controllers = modules.flatMap(mod => Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) as Type[])
      .filter(ctrl => "getMetrics" in ctrl.prototype);
    @Module({ controllers: [...controllers, FixtureController], providers: [{ provide: MetricsService, useValue: metrics }] })
    class MetricsHttpFixture {}
    app = await NestFactory.create(MetricsHttpFixture, { logger: false, abortOnError: false });
    app.use(apiVersioningMiddleware);
    const middleware = new MetricsMiddleware();
    app.use((req: Request, res: Response, next: () => void) => middleware.use(req, res, next));
    await app.listen(0, "127.0.0.1");
    await run({ base: await app.getUrl(), metrics, controllers });
  } finally {
    await app?.close(); metrics.registry.clear();
    if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    if (previousSecret === undefined) delete process.env.OPS_SHARED_SECRET; else process.env.OPS_SHARED_SECRET = previousSecret;
  }
}
const auth = { authorization: "Bearer test-only-ops-secret" };
const request = (base: string, path = "/metrics", headers: Record<string, string> = auth, method = "GET") =>
  fetch(base + path, { headers, method, signal: AbortSignal.timeout(5000) });

test("only one metrics controller is registered across production HTTP/observability modules", async () => {
  await withApp(async ({ controllers }) => { assert.equal(controllers.length, 1); assert.equal(controllers[0], MetricsController); });
});

for (const reverse of [false, true]) {
  test(`anonymous production scrape is denied regardless of module order: reverse=${reverse}`, async () => {
    await withApp(async ({ base }) => {
      const response = await request(base, "/metrics", {});
      assert.equal(response.status, 401);
      assert.ok(!(await response.text()).includes("http_requests_total"));
    }, reverse);
  });
  test(`authenticated scrape contains both registries regardless of module order: reverse=${reverse}`, async () => {
    await withApp(async ({ base, metrics }) => {
      metrics.storefrontLlmOperations.inc({ stage: "provider", outcome: "ok", reason: "completed" });
      const response = await request(base);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /http_requests_total/);
      assert.match(text, /checkouts_created_total/);
      assert.match(text, /checkout_started_total/);
      assert.match(text, /storefront_llm_operations_total/);
    }, reverse);
  });
}

for (const [name, headers] of [
  ["incorrect bearer", { authorization: "Bearer wrong" }],
  ["incorrect ops header", { "x-ops-secret": "wrong" }],
  ["empty ops header", { "x-ops-secret": "" }],
  ["wrong auth scheme", { authorization: "Basic test-only-ops-secret" }],
  ["substring of secret", { authorization: "Bearer test-only-ops" }],
] as const) {
  test(`scrape rejects ${name}`, async () => withApp(async ({ base }) => {
    assert.equal((await request(base, "/metrics", headers)).status, 401);
  }));
}

test("scrape accepts operational header without exposing credentials", async () => withApp(async ({ base }) => {
  const response = await request(base, "/metrics", { "x-ops-secret": "test-only-ops-secret" });
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes("test-only-ops-secret"));
}));

for (const value of [undefined, "", "   "]) {
  test(`production metrics fail closed without configured secret: ${JSON.stringify(value)}`, async () => withApp(async ({ base }) => {
    if (value === undefined) delete process.env.OPS_SHARED_SECRET; else process.env.OPS_SHARED_SECRET = value;
    assert.equal((await request(base)).status, 401);
  }));
}

test("versioned metrics alias applies same access control", async () => withApp(async ({ base }) => {
  assert.equal((await request(base, "/v1/metrics", {})).status, 401);
  const response = await request(base, "/v1/metrics");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("aacp-api-version"), "v1");
  assert.match(await response.text(), /storefront_llm_operations_total/);
}));

test("GET query and HEAD cannot bypass access control", async () => withApp(async ({ base }) => {
  assert.equal((await request(base, "/metrics?token=test-only-ops-secret", {})).status, 401);
  assert.equal((await request(base, "/metrics", {}, "HEAD")).status, 401);
}));

test("authenticated metric response has correct content type and no-store", async () => withApp(async ({ base }) => {
  const response = await request(base);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain;/);
  assert.match(response.headers.get("content-type") ?? "", /version=0\.0\.4/);
  assert.equal(response.headers.get("cache-control"), "no-store");
}));

test("legacy HTTP counters survive repeated initialization and scrape", async () => withApp(async ({ base }) => {
  const registry = getMetricsRegistry();
  await request(base, "/metrics-fixture/ok/PRIVATE_CUSTOMER");
  const before = await registry.getSingleMetric("http_requests_total")!.get();
  initMetrics(); initDomainMetrics();
  assert.equal(getMetricsRegistry(), registry);
  const after = await registry.getSingleMetric("http_requests_total")!.get();
  assert.deepEqual(after, before);
  assert.equal((await request(base)).status, 200);
}));

test("domain helpers and service metrics remain available in one scrape without duplicate families", async () => withApp(async ({ base, metrics }) => {
  recordCheckoutCreated("success"); recordOrderCreated("success"); recordPaymentProcessed("success");
  recordWebhookDelivery("delivered", "fixture"); recordWebhookError("fixture");
  metrics.checkoutStarted.inc({ merchant_id: "fixture" });
  const response = await request(base);
  const text = await response.text();
  for (const name of ["checkouts_created_total", "orders_created_total", "payments_processed_total", "webhook_deliveries_total", "webhook_errors_total", "checkout_started_total"])
    assert.match(text, new RegExp(`^${name}\\{`, "m"));
  const families = [...text.matchAll(/^# HELP (\S+) /gm)].map(match => match[1]);
  assert.equal(new Set(families).size, families.length);
}));

test("HTTP metric labels use route templates and never unmatched raw URLs", async () => withApp(async ({ base }) => {
  await request(base, "/metrics-fixture/ok/PRIVATE_CUSTOMER?token=PRIVATE_TOKEN");
  await request(base, "/PRIVATE_EMAIL@example.com?token=PRIVATE_TOKEN");
  const response = await request(base);
  const text = await response.text();
  assert.ok(!text.includes("PRIVATE"));
  assert.match(text, /route="\/metrics-fixture\/ok\/:id"/);
  assert.match(text, /route="unmatched"/);
}));

test("finish observation counts a response only once, including 5xx", async () => withApp(async ({ base }) => {
  const metric = getMetricsRegistry().getSingleMetric("http_errors_total")!;
  const count = async () => (await metric.get()).values.filter(v => v.labels.route === "/metrics-fixture/fail").reduce((sum, v) => sum + v.value, 0);
  const before = await count();
  assert.equal((await request(base, "/metrics-fixture/fail")).status, 500);
  assert.equal(await count(), before + 1);
}));

test("non-production development access remains compatible", async () => withApp(async ({ base }) => {
  process.env.NODE_ENV = "development"; delete process.env.OPS_SHARED_SECRET;
  assert.equal((await request(base, "/metrics", {})).status, 200);
}));

test("old import path is a compatibility alias, not another controller implementation", () => {
  assert.equal(CompatibilityMetricsController, MetricsController);
});

test("streamed responses are measured without patching response.send", async () => withApp(async ({ base }) => {
  const metric = getMetricsRegistry().getSingleMetric("http_requests_total")!;
  const count = async () => (await metric.get()).values.filter(v => v.labels.route === "/metrics-fixture/stream").reduce((sum, v) => sum + v.value, 0);
  const before = await count();
  const response = await request(base, "/metrics-fixture/stream");
  assert.equal(await response.text(), "firstlast");
  assert.equal(await count(), before + 1);
}));

test("middleware observes finish once and bounds nonstandard HTTP method labels", async () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 200, send: () => undefined });
  const originalSend = response.send;
  const metric = getMetricsRegistry().getSingleMetric("http_requests_total")!;
  const count = async () => (await metric.get()).values.filter(v => v.labels.method === "OTHER" && v.labels.route === "unmatched").reduce((sum, v) => sum + v.value, 0);
  const before = await count();
  let nextCalls = 0;
  new MetricsMiddleware().use({ method: "PRIVATE_METHOD", path: "/PRIVATE_PATH" } as Request, response as unknown as Response, () => { nextCalls++; });
  response.emit("finish"); response.emit("finish");
  assert.equal(nextCalls, 1); assert.equal(response.send, originalSend);
  assert.equal(await count(), before + 1);
  assert.ok(!(await getMetricsRegistry().metrics()).includes("PRIVATE"));
});

test("metric observation failure cannot change response or replay next", () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 200 });
  const metric = getMetricsRegistry().getSingleMetric("http_request_duration_seconds")!;
  assert.ok("observe" in metric);
  const originalObserve = metric.observe;
  try {
    Object.assign(metric, { observe: () => { throw new Error("PRIVATE_TELEMETRY_FAILURE"); } });
    let nextCalls = 0;
    new MetricsMiddleware().use({ method: "GET", path: "/PRIVATE_PATH" } as Request, response as unknown as Response, () => { nextCalls++; });
    assert.doesNotThrow(() => response.emit("finish"));
    assert.equal(nextCalls, 1); assert.equal(response.statusCode, 200);
  } finally { Object.assign(metric, { observe: originalObserve }); }
});

