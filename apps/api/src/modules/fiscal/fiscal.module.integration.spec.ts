import "reflect-metadata";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { createFiscalFixture } from "../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../tests/fiscal-schema-seed.js";
import { arrangeIssuance, seedHistoricalFiscalIssuance } from "../../../tests/fiscal-issuance-harness.js";
import { FiscalReconciliationService as HistoricalReconciliation } from "./application/fiscal-reconciliation.service.js";
import { PrismaFiscalStockCoordinator as HistoricalStock } from "../../shared/persistence/fiscal-stock-coordination.js";
import Stripe from "stripe";
import { createHash, createHmac } from "node:crypto";
const require = createRequire(import.meta.url);
let f: Awaited<ReturnType<typeof createFiscalFixture>>,
  app: any,
  runtime: any,
  tenants: any,
  db: any,
  jwt: any,
  base: string;
const originalFetch = globalThis.fetch;
const httpLogs: string[] = [];
const nativeLogRequests: { method: string; path: string; requestId: string }[] = [];
const fixtureEnv = {
  NODE_ENV: "test",
  REDIS_URL: "",
  REDIS_ENABLED: "false",
  BILLING_TRIAL_QUEUE_REQUIRED: "false",
  AACP_PII_ENC_KEY: "synthetic-real-module-private-key",
  JWT_SECRET: "synthetic-real-fiscal-module-jwt-secret-at-least-32",
  STRIPE_SECRET_KEY_TEST: "sk_test_synthetic_runtime",
  STRIPE_PUBLISHABLE_KEY_TEST: "pk_test_synthetic_runtime",
  STRIPE_WEBHOOK_SECRET_TEST: "whsec_synthetic_runtime_original",
  AACP_PAYMENT_ENC_KEY: "synthetic-payment-key",
  META_APP_SECRET: "synthetic-original-meta-app-secret",
  RESEND_API_KEY: "synthetic-original-resend-key",
  RESEND_FROM_EMAIL: "fiscal@example.test",
  LOCAL_LLM_API_KEY: "synthetic-llm",
  LOCAL_LLM_BASE_URL: "https://synthetic-llm.example.test/v1",
  BLING_CLIENT_ID: "synthetic-runtime-app",
  BLING_CLIENT_SECRET: "synthetic-runtime-secret",
  AACP_ERP_ENC_KEY: "synthetic-runtime-erp-key",
};
const previousEnv = Object.fromEntries(
  [
    ...Object.keys(fixtureEnv),
    "DATABASE_URL",
    "FISCAL_RESEND_ACCOUNTS",
    "FISCAL_BLING_SCOPE_PERMISSIONS",
  ].map((k) => [k, process.env[k]])
);
let externalCalls = 0;
let transport:
  | ((
      url: string,
      init?: RequestInit
    ) => Promise<Response | undefined> | Response | undefined)
  | undefined;
const dist = (path: string) =>
  import(new URL("../../../dist/" + path + ".js", import.meta.url).href);
before(
  async () => {
    // Fresh semantic production emit is part of the test: a TS mutation cannot
    // use stale dist. Use the same project/heap as the actual production build.
    const api = fileURLToPath(new URL("../../../", import.meta.url));
    execFileSync(
      process.execPath,
      ["--max-old-space-size=4096", require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
      { cwd: api, encoding: "utf8", timeout: 600000, stdio: "pipe" }
    );
    process.stdout.write("# current semantic build complete\n");
    Object.assign(process.env, fixtureEnv);
    f = await createFiscalFixture();
    process.env.DATABASE_URL = f.databaseUrl;
    globalThis.fetch = (async (url: any, init: any) => {
      if (/^http:\/\/127\.0\.0\.1:\d+/.test(String(url)))
        return originalFetch(url, init);
      externalCalls++;
      const result = await transport?.(String(url), init);
      if (result) return result;
      throw new Error("synthetic_transport_unconfigured");
    }) as typeof fetch;
    const [
      { AppModule },
      persistence,
      tenant,
      { TenantModule },
      { registerTenantMiddleware },
      outbox,
      auth,
      fiscal,
    ] = await Promise.all([
      dist("app.module"),
      dist("shared/persistence/persistence.module"),
      dist("shared/tenant/tenant-context.service"),
      dist("shared/tenant/tenant.module"),
      dist("shared/persistence/tenant.middleware"),
      dist("shared/messaging/outbox-dispatcher.service"),
      dist("modules/auth/domain/services/jwt.service"),
      dist("modules/fiscal/infrastructure/fiscal-runtime"),
    ]);
    tenants = new tenant.TenantContextService();
    db = registerTenantMiddleware(f.prisma, tenants);
    const metrics = await dist("shared/http/metrics.middleware");
    metrics.initMetrics();
    metrics.initDomainMetrics();
    // Capture the actual AppModule Pino options through its supported destination
    // seam; only the pretty transport is removed, never serializers or redaction.
    const loggerModule = Reflect.getMetadata("imports", AppModule).find(
      (entry: any) => entry?.providers?.some((p: any) => p.provide === "pino-params")
    );
    const loggerProvider = loggerModule.providers.find(
      (p: any) => p.provide === "pino-params"
    );
    const loggerParams = loggerProvider.useValue
      ?? await loggerProvider.useFactory();
    if (loggerProvider.useFactory) {
      loggerProvider.useFactory = () => loggerParams;
    }
    const { transport: _pretty, ...httpOptions } = loggerParams.pinoHttp;
    loggerParams.pinoHttp = [httpOptions, { write(chunk: string) { httpLogs.push(chunk); } }];
    // Standard fixture substitution of the database/context providers only. All
    // actual AppModule imports, fiscal factories, controllers and guards remain.
    Reflect.defineMetadata(
      "providers",
      [
        {
          provide: persistence.PrismaLifecycle,
          useValue: new persistence.PrismaLifecycle(db, f.prisma),
        },
        { provide: persistence.PRISMA_CLIENT, useValue: db },
        { provide: persistence.PRISMA_CROSS_MERCHANT_CLIENT, useValue: f.prisma },
      ],
      persistence.PersistenceModule
    );
    Reflect.defineMetadata(
      "providers",
      Reflect.getMetadata("providers", TenantModule).map((p: any) =>
        p === tenant.TenantContextService
          ? { provide: p, useValue: tenants }
          : p
      ),
      TenantModule
    );
    process.stdout.write("# actual AppModule DI starting\n");
    app = await NestFactory.create(AppModule, {
      logger: ["error"],
      rawBody: true,
      abortOnError: false,
    });
    // Scheduling is driven explicitly by these tests, using the real dispatcher.
    process.stdout.write("# actual AppModule DI complete\n");
    app.get(outbox.OutboxDispatcher).onApplicationBootstrap = () => {};
    const { requestLogId } = await dist("shared/logger/log-context");
    // Fixture-only association with the same independent native request ID as
    // the real logger. No path/header is added to production diagnostics.
    app.getHttpServer().on("request", (request: any) => {
      const path = String(request.url ?? "");
      if (request.method === "POST" && (/^\/v1\/webhooks\/(?:fiscal|FISCAL)\/focus\//.test(path)
        || /^\/v1\/storefront\/conversations\/[^/]+\/messages$/.test(path))) {
        nativeLogRequests.push({ method: request.method, path, requestId: requestLogId(request) });
      }
    });
    app.setGlobalPrefix("v1");
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    process.stdout.write("# actual AppModule HTTP listening\n");
    runtime = app.get(fiscal.FiscalRuntime);
    const [{ FISCAL_ASSISTANT }, { StorefrontConversationAdapter }] = await Promise.all([
      dist("modules/fiscal/fiscal-runtime.ports"),
      dist("modules/storefront/infrastructure/adapters/storefront-conversation.adapter"),
    ]);
    const actualAssistant = app.get(FISCAL_ASSISTANT);
    assert.equal(app.get(StorefrontConversationAdapter).fiscal, actualAssistant);
    assert.equal(actualAssistant.documents, runtime.documents);
    assert.equal(actualAssistant.environment, runtime.environment);
    jwt = app.get(auth.JwtService);
  },
  { timeout: 900000 }
);
after(async () => {
  await app?.close();
  await f?.close();
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
async function actor(role = "owner") {
  const merchantId = f.tag + crypto.randomUUID();
  await f.prisma.merchant.create({
    data: { id: merchantId, name: "Actual module synthetic merchant" },
  });
  const user = await f.prisma.merchantUser.create({
    data: { merchantId, email: crypto.randomUUID() + "@example.test", role },
  });
  await f.prisma.merchantTeamMember.create({
    data: { merchantId, userId: user.id, role: role.toUpperCase() },
  });
  const token = await jwt.issue({
    merchantId,
    userId: user.id,
    email: user.email,
    role,
  });
  return {
    merchantId,
    user,
    token,
    request: (method: string, path: string, body?: object) =>
      originalFetch(base + "/v1/merchants/me/fiscal" + path, {
        method,
        headers: {
          authorization: "Bearer " + token,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
  };
}
test("FISCAL-10 real current semantic AppModule boot assembles fiscal routes without issuing or delivering", async () => {
  assert.equal(externalCalls, 0);
  assert.equal(await f.prisma.fiscalIntent.count(), 0);
  assert.equal(typeof runtime.worker.runOnce, "function");
  const response = await originalFetch(
    base + "/v1/merchants/me/fiscal/connection?environment=homologation"
  );
  assert.equal(response.status, 401);
});
test("FISCAL-56 actual module owner configuration route works and staff is denied", async () => {
  const a = await actor();
  assert.equal(
    (await a.request("GET", "/connection?environment=homologation")).status,
    200
  );
  const b = await actor("staff");
  assert.equal(
    (await b.request("GET", "/connection?environment=homologation")).status,
    403
  );
});
test("FISCAL-56 actual module connection/setup private fields are not projected", async () => {
  const a = await actor();
  const response = await a.request("PUT", "/connection", {
    environment: "homologation",
    provider: "focus",
    issuerTaxId: "12ABC34501DE35",
    credential: {
      kind: "company_token",
      secret: "synthetic-private-company-token",
    },
    stockOwner: "zyon",
    emailOwner: "zyon",
    whatsappOwner: "zyon",
  });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(
    JSON.stringify(value).includes("synthetic-private-company-token"),
    false
  );
  assert.equal(value.credentialCipher, undefined);
  assert.equal(value.setupCipher, undefined);
});
test("FISCAL-37 actual runtime Focus configured-header ingress persists original reconciliation outbox", async () => {
  const a = await actor();
  const sale = await seedFiscalSale(f, { merchantId: a.merchantId });
  const config = await a.request(
    "PUT",
    "/connection/" + sale.connection.id + "/setup",
    {
      environment: "homologation",
      focusWebhook: {
        authorizationHeader: "x-fiscal-original-hook",
        authorization: "synthetic-hook-secret-123456",
      },
    }
  );
  assert.equal(config.status, 200);
  const body = {
    ref: sale.intent.stableReference,
    cnpj_emitente: sale.connection.issuerTaxId,
    ambiente: "2",
  };
  const send = (secret: string) =>
    originalFetch(base + "/v1/webhooks/fiscal/focus/" + sale.connection.id, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fiscal-original-hook": secret,
      },
      body: JSON.stringify(body),
    });
  assert.equal((await send("wrong")).status, 401);
  assert.equal((await send("synthetic-hook-secret-123456")).status, 200);
  assert.equal(
    await f.prisma.outboxMessage.count({
      where: {
        merchantId: a.merchantId,
        eventType: "fiscal.reconciliation.requested",
      },
    }),
    1
  );
});
test("FISCAL-61 actual HTTP Pino hides any configured fiscal callback header without changing authentication", async () => {
  const a = await actor();
  const sale = await seedFiscalSale(f, { merchantId: a.merchantId });
  for (const [header, namespace] of [["x-reviewed-" + crypto.randomUUID(), "fiscal"], ["x-correlation-id", "fiscal"], ["x-upper-" + crypto.randomUUID(), "FISCAL"]]) {
  const secret = "private-http-control-" + crypto.randomUUID();
  const setup = await a.request("PUT", "/connection/" + sale.connection.id + "/setup", {
    environment: "homologation", focusWebhook: { authorizationHeader: header, authorization: secret },
  });
  assert.equal(setup.status, 200);
  assert.equal(JSON.stringify(await setup.json()).includes(secret), false);
  const start = httpLogs.length;
  const response = await originalFetch(base + "/v1/webhooks/" + namespace + "/focus/" + sale.connection.id + "?retry=1", {
    method: "POST", headers: { "content-type": "application/json", [header]: secret },
    body: JSON.stringify({ ref: sale.intent.stableReference, cnpj_emitente: sale.connection.issuerTaxId, ambiente: "2" }),
  });
  assert.equal(response.status, 200);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: a.merchantId, eventType: "fiscal.reconciliation.requested" } }), 1);
  const captured = httpLogs.slice(start).join("");
  assert.ok(captured.length > 0, "real completed-request logs captured");
  assert.equal(captured.includes(secret), false, "configured callback credential must never reach diagnostics");
  if (process.env.FISCAL_CURRENT_LOG_DIAGNOSTIC === "1") {
    const observed = nativeLogRequests.at(-1);
    const events = captured.split("\n").filter(Boolean).map(line => JSON.parse(line));
    const event = events.find(log => (log.requestId === observed?.requestId || log.reqId === observed?.requestId)
      && log.res?.statusCode === response.status);
    process.stdout.write("# CURRENT_HTTP_LOG_PROBE " + JSON.stringify({
      nativeRequestId: observed?.requestId, topLevelKeys: event ? Object.keys(event) : [],
      requestId: event?.requestId, reqId: event?.reqId, reqKeys: Object.keys(event?.req ?? {}), method: event?.req?.method,
      resKeys: Object.keys(event?.res ?? {}), statusCode: event?.res?.statusCode,
      matchesByRequestId: Boolean(event), callerSecretAbsent: !captured.includes(secret),
    }) + "\n");
  }
  const observed = nativeLogRequests.at(-1);
  assert.ok(observed?.requestId, "the actual native callback has a server-generated request ID");
  const event = captured.split("\n").filter(Boolean).map(line => JSON.parse(line)).find(log =>
    log.requestId === observed.requestId && log.res?.statusCode === 200);
  assert.ok(event, "the authenticated callback has an actual completed-request event");
  assert.equal(event.requestId, observed.requestId);
  assert.equal(event.reqId, observed.requestId);
  assert.deepEqual(event.req, { method: "POST" });
  assert.equal(event.req.headers, undefined);
  assert.equal(event.req.url, undefined);
  assert.deepEqual(event.res, { statusCode: 200 });
  assert.equal(event.res.statusCode, 200);
  }
});
test("FISCAL-37 actual runtime outbox reconciliation propagates retryable failure and rejects foreign binding", async () => {
  const a = await vertical();
  const paid = await a.createPaid();
  await a.request("PUT", "/connection/" + a.connection.id + "/setup", {
    environment: "homologation",
    paymentConfiguration: {
      paymentIntentId: paid.entity.id,
      confirmed: true,
      environment: "test",
      acquirerTaxId: "12345678000195",
    },
  });
  await a.asMerchant(() => runtime.worker.runOnce(a.scope));
  const intent = await a.intent();
  const sale = {
    merchantId: a.merchantId,
    environment: a.scope.environment,
    intent,
    connection: a.connection,
    provider: "focus",
  };
  transport = async () => Response.json({}, { status: 503 });
  const payload = {
    intentId: sale.intent.id,
    environment: sale.environment,
    connectionId: sale.connection.id,
    provider: sale.provider,
    stableReference: sale.intent.stableReference,
  };
  await assert.rejects(
    tenants.run(
      { merchantId: sale.merchantId, userId: "test", role: "system" },
      () => runtime.webhook.consume(sale.merchantId, payload)
    ),
    /reconciliation_pending/
  );
  await assert.rejects(
    runtime.webhook.consume("foreign", payload),
    /identity_mismatch/
  );
});
test("FISCAL-60 actual runtime durable authorized handler retries incomplete artifacts", async () => {
  const sale = await seedFiscalSale(f, { issuance: true });
  const { DOMAIN_EVENT_BUS } = await import(
    new URL(
      "../../../dist/shared/events/domain-event-bus.port.js",
      import.meta.url
    ).href
  );
  const handlers = app
    .get(DOMAIN_EVENT_BUS)
    .handlersFor("fiscal.document.authorized");
  assert.equal(handlers.length, 1);
  await assert.rejects(
    handlers[0].handle({
      eventType: "fiscal.document.authorized",
      merchantId: sale.merchantId,
      payload: { intentId: sale.intent.id, environment: sale.environment },
    }),
    /pending/
  );
});
test("FISCAL-38 both actual compiled checkout factory paths fail closed without fiscal tenant context", async () => {
  const [{ CheckoutModule }, { CheckoutPersistenceModule }, { CHECKOUT_REPOSITORY }, { FISCAL_ORDER_COMMIT_FACTORY }, { PRISMA_CLIENT }] = await Promise.all([
    dist("modules/checkout/checkout.module"), dist("modules/checkout/checkout-persistence.module"), dist("modules/checkout/domain/ports/checkout-repository.port"), dist("modules/fiscal/fiscal-runtime.ports"), dist("shared/persistence/persistence.module"),
  ]);
  for (const productionModule of [CheckoutModule, CheckoutPersistenceModule]) {
    const factory = Reflect.getMetadata("providers", productionModule).find((provider: any) => provider.provide === CHECKOUT_REPOSITORY);
    const otherDependencies = factory.inject.filter((token: any) => typeof token === "function").map((provide: any) => ({ provide, useValue: {} }));
    class MissingTenantBoundary {}
    Module({ providers: [{ provide: PRISMA_CLIENT, useValue: {} }, { provide: FISCAL_ORDER_COMMIT_FACTORY, useValue: app.get(FISCAL_ORDER_COMMIT_FACTORY) }, ...otherDependencies, factory] })(MissingTenantBoundary);
    await assert.rejects(NestFactory.createApplicationContext(MissingTenantBoundary, { logger: false, abortOnError: false }), /fiscal_tenant_context_required/);
  }
});
test("FISCAL-10 actual module commercial repository has transaction participant and shared callbacks", async () => {
  const { CHECKOUT_REPOSITORY } = await import(
    new URL(
      "../../../dist/modules/checkout/domain/ports/checkout-repository.port.js",
      import.meta.url
    ).href
  );
  const repo = app.get(CHECKOUT_REPOSITORY);
  assert.equal(typeof repo.fiscalParticipant, "function");
  const { FISCAL_WEBHOOK_DISPATCH } = await import(
    new URL(
      "../../../dist/shared/integrations/fiscal-webhook-dispatch.port.js",
      import.meta.url
    ).href
  );
  const { FISCAL_DELIVERY_DISPATCH } = await import(
    new URL(
      "../../../dist/shared/integrations/fiscal-delivery-dispatch.port.js",
      import.meta.url
    ).href
  );
  assert.equal(app.get(FISCAL_WEBHOOK_DISPATCH), runtime.webhook);
  assert.equal(app.get(FISCAL_DELIVERY_DISPATCH), runtime.deliveryCallbacks);
});

async function vertical(
  options: {
    provider?: "focus" | "bling";
    taxPending?: boolean;
    guest?: boolean;
  } = {}
) {
  const a = await actor(),
    provider = options.provider ?? "focus",
    sessionId = "session_" + crypto.randomUUID().replaceAll("-", ""),
    orderId = "pi_" + crypto.randomUUID().replaceAll("-", "");
  let assistantOrderId = orderId;
  const scope = { merchantId: a.merchantId, environment: "homologation" },
    asMerchant = <T>(work: () => T): T =>
      tenants.run(
        { merchantId: a.merchantId, userId: a.user.id, role: "owner" },
        work
      );
  await f.prisma.merchant.update({
    where: { id: a.merchantId },
    data: { storeSlug: "original-" + a.merchantId },
  });
  const companyToken = "synthetic-original-company-" + sessionId;
  const companies = new Map([
    ["original-company", { issuer: "12ABC34501DE35", token: companyToken }],
  ]);
  let pspCreate = 0,
    pspRead = 0,
    fiscalWrite = 0,
    authorized = false,
    rejected = false,
    blingRestored = false;
  const sent: string[] = [],
    emailRequests: { kind: "otp" | "fiscal"; idempotencyKey: string; to: string; subject: string; html: string }[] = [],
    llmTrace: { phase: "classifier" | "main"; tools: string[]; returnedTools: string[] }[] = [],
    issued: Record<string, any>[] = [];
  let stripeOriginal: any;
  transport = async (url, init) => {
    if (url.includes("viacep.com.br/"))
      return Response.json({
        logradouro: "Rua Um",
        bairro: "Centro",
        localidade: "Sao Paulo",
        uf: "SP",
        ibge: "3550308",
        cep: "01001-000",
      });
    if (url.includes("api.focusnfe.com.br/v2/empresas/")) {
      const id = new URL(url).pathname.split("/").pop()!;
      const company = companies.get(id)!;
      return Response.json({
        id,
        cnpj: company?.issuer,
        certificado_cnpj: company?.issuer,
        certificado_valido_de: new Date(Date.now() - 86400000).toISOString(),
        certificado_valido_ate: new Date(Date.now() + 86400000).toISOString(),
        token_homologacao: company?.token,
        habilita_nfe: true,
        enviar_email_destinatario: false,
        enviar_email_homologacao: false,
      });
    }
    if (url.includes("homologacao.focusnfe.com.br/v2/nfe")) {
      if (init?.method === "POST") {
        fiscalWrite++;
        issued.push(JSON.parse(String(init.body)));
        return Response.json(
          { status: "processando_autorizacao" },
          { status: 202 }
        );
      }
      if (!fiscalWrite) return Response.json({}, { status: 404 });
      const ref = new URL(url).pathname.split("/").pop();
      const intent = await f.prisma.fiscalIntent.findFirstOrThrow({
        where: { stableReference: ref },
        include: { connection: true },
      });
      return Response.json({
        ref: intent.stableReference,
        cnpj_emitente: intent.connection.issuerTaxId,
        status: rejected ? "erro_autorizacao" : authorized ? "autorizado" : "processando_autorizacao",
        ...(rejected ? { status_sefaz: "598", mensagem_sefaz: "private-provider-error-should-not-be-logged" } : {}),
        numero: "22",
        serie: "1",
        chave_nfe:
          "NFe352611" +
          intent.connection.issuerTaxId +
          "550010000000221123456780",
        protocolo_nota_fiscal: {
          ambiente: "2",
          numero_protocolo: "151260029467289",
          data_recebimento: new Date().toISOString(),
        },
      });
    }
    if (url.includes("api.bling.com.br/Api/v3/empresas/me/dados-basicos"))
      return Response.json({ data: { cnpj: "12ABC34501DE35" } });
    if (url.includes("api.bling.com.br/Api/v3/nfe?"))
      return Response.json({ data: blingRestored ? [{ id: 77 }] : [] });
    if (url.endsWith("api.bling.com.br/Api/v3/nfe/77")) {
      const intent = await f.prisma.fiscalIntent.findFirstOrThrow({
        where: { merchantId: a.merchantId },
      });
      return Response.json({
        data: { id: 77, numeroPedidoLoja: intent.stableReference, situacao: 1 },
      });
    }
    if (url.includes("api.resend.com/domains/"))
      return Response.json({
        id: "original-domain",
        name: "example.test",
        status: "verified",
      });
    if (url === "https://api.resend.com/emails") {
      assert.equal(init?.method, "POST");
      const payload = JSON.parse(String(init.body));
      const idempotencyKey = new Headers(init.headers).get("idempotency-key") ?? "";
      assert.equal(typeof payload.to, "string"); assert.equal(typeof payload.subject, "string"); assert.equal(typeof payload.html, "string");
      if (idempotencyKey.startsWith("checkout-otp:")) {
        assert.ok(idempotencyKey.startsWith("checkout-otp:" + a.merchantId + ":" + sessionId + ":"));
        emailRequests.push({ kind: "otp", idempotencyKey, to: payload.to, subject: payload.subject, html: payload.html });
        return Response.json({ id: "otp_email_" + sessionId });
      }
      assert.match(idempotencyKey, /^fiscal-[a-f0-9]{64}$/);
      emailRequests.push({ kind: "fiscal", idempotencyKey, to: payload.to, subject: payload.subject, html: payload.html });
      sent.push("email");
      return Response.json({ id: "email_" + sessionId });
    }
    if (/graph.facebook.com\/v23.0\/\d+\/messages$/.test(url)) {
      const body = JSON.parse(String(init?.body));
      assert.match(body.text?.body ?? "", /Nota fiscal/);
      sent.push("whatsapp");
      return Response.json({ messages: [{ id: "wamid_" + sessionId }] });
    }
    if (url.includes("synthetic-llm.example.test")) {
      const request = JSON.parse(String(init?.body));
      let classifier = false;
      for (const message of request.messages) {
        if (message.role !== "system" || typeof message.content !== "string") continue;
        try { const prompt = JSON.parse(message.content); classifier ||= prompt.id === "storefront.intent" && prompt.version === 2; }
        catch { /* Only the actual structured classifier prompt selects its contract. */ }
      }
      const tools = (request.tools ?? []).map((tool: any) => tool.function.name);
      if (classifier) {
        assert.equal(tools.length, 0);
        const classification = { schemaVersion: 2, domain: "STORE_SUPPORT", intent: "COMPLEX_QUESTION", confidence: 0.99,
          requiresTool: true, needsProductDiscovery: false, shoppingPhase: null };
        const { storefrontIntentOutputSchema } = await dist("modules/storefront/domain/contracts/storefront-intent.schemas");
        assert.deepEqual(storefrontIntentOutputSchema.parse(classification), classification);
        llmTrace.push({ phase: "classifier", tools, returnedTools: [] });
        return Response.json({ id: "synthetic_classification", choices: [{ index: 0, finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(classification) } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
      }
      const called = request.messages.some((m: any) => m.role === "tool");
      if (!called) assert.ok(tools.includes("get_invoice"), "the actual current turn announces its invoice tool");
      llmTrace.push({ phase: "main", tools, returnedTools: called ? [] : ["get_invoice"] });
      return Response.json({
        id: "synthetic_completion",
        choices: [
          {
            index: 0,
            finish_reason: called ? "stop" : "tool_calls",
            message: called
              ? { role: "assistant", content: JSON.stringify({ schemaVersion: 1, message: "Consulte a nota no pedido." }) }
              : {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "fiscal_tool",
                      type: "function",
                      function: {
                        name: "get_invoice",
                        arguments: JSON.stringify({ orderId: assistantOrderId }),
                      },
                    },
                  ],
                },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    }
    return undefined;
  };
  const { StripePaymentAdapter } = await dist(
    "modules/payment/infrastructure/stripe-payment.adapter"
  );
  const stripe = app.get(StripePaymentAdapter);
  stripe.stripe = new Stripe(fixtureEnv.STRIPE_SECRET_KEY_TEST, {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient((async (url, init) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer " + fixtureEnv.STRIPE_SECRET_KEY_TEST
      );
      if (init?.method === "POST") {
        pspCreate++;
        const body = new URLSearchParams(String(init.body));
        stripeOriginal = {
          id: orderId,
          object: "payment_intent",
          amount: Number(body.get("amount")),
          amount_received: 0,
          amount_capturable: 0,
          currency: body.get("currency"),
          status: "requires_payment_method",
          livemode: false,
          client_secret: orderId + "_secret_synthetic",
          metadata: {
            merchant_id: body.get("metadata[merchant_id]"),
            session_id: body.get("metadata[session_id]"),
            intent_id: body.get("metadata[intent_id]"),
          },
        };
        return Response.json(stripeOriginal);
      }
      pspRead++;
      return Response.json({
        ...stripeOriginal,
        amount_received: stripeOriginal.amount,
        status: "succeeded",
        latest_charge: {
          id: "ch_" + sessionId,
          object: "charge",
          payment_intent: orderId,
          livemode: false,
          paid: true,
          captured: true,
          status: "succeeded",
          amount: stripeOriginal.amount,
          amount_captured: stripeOriginal.amount,
          amount_refunded: 0,
          currency: stripeOriginal.currency,
          created: Math.floor(Date.now() / 1000),
          refunded: false,
          disputed: false,
          payment_method_details: {
            type: "card",
            card: {
              funding: "credit",
              brand: "visa",
              authorization_code: "ORIGINALAUTH",
            },
          },
        },
      });
    }) as typeof fetch),
  });
  const { PAYMENT_PLATFORM_REPOSITORY } = await dist(
    "modules/payment/domain/ports/payment-platform-repository.port"
  );
  await asMerchant(() =>
    app.get(PAYMENT_PLATFORM_REPOSITORY).saveConnection({
      merchantId: a.merchantId,
      provider: "stripe",
      environment: "test",
      status: "active",
      chargesEnabled: true,
      payoutsEnabled: true,
      externalAccountId: "acct_synthetic",
    })
  );
  let erp: any;
  if (provider === "bling") {
    const { encryptErpSecret } = await dist("shared/crypto/erp-secret-cipher");
    const { blingTokenGrantMetadata } = await dist(
      "shared/integrations/bling-credentials"
    );
    erp = await f.prisma.erpConnection.create({
      data: {
        merchantId: a.merchantId,
        provider: "bling",
        status: "connected",
        accessTokenCipher: encryptErpSecret("original-bling-token"),
        refreshTokenCipher: encryptErpSecret("original-bling-refresh"),
        tokenExpiresAt: new Date(Date.now() + 3600000),
        config: blingTokenGrantMetadata({
          access_token: "original-bling-token",
          scope: ["synthetic_fiscal_scope"],
        }),
      },
    });
    process.env.FISCAL_BLING_SCOPE_PERMISSIONS = JSON.stringify({
      synthetic_fiscal_scope: [
        "fiscal_read",
        "fiscal_write",
        "order_write",
        "contact_write",
      ],
    });
  }
  const connected = await a.request("PUT", "/connection", {
    environment: "homologation",
    provider,
    issuerTaxId: "12ABC34501DE35",
    ...(provider === "bling"
      ? { erpConnectionId: erp.id }
      : { credential: { kind: "company_token", secret: companyToken } }),
    stockOwner: "zyon",
    emailOwner: "zyon",
    whatsappOwner: "zyon",
  });
  assert.equal(connected.status, 200);
  const connection = await connected.json();
  const rules = {
    currency: "BRL",
    supportedProductTypes: ["physical"],
    policyVersion: "original_policy_v1",
    items: {
      shirt: {
        productType: "physical",
        ncm: "61091000",
        cfop: "5102",
        origin: "0",
        unit: "UN",
        taxes:
          provider === "bling"
            ? { "simples.cst": "102", "pis.cst": "07", "cofins.cst": "07" }
            : {
                icms_situacao_tributaria: "102",
                pis_situacao_tributaria: "07",
                cofins_situacao_tributaria: "07",
              },
      },
    },
    paymentMappings: { "03": { id: 88, code: "03" } },
    operation:
      provider === "bling"
        ? {
            departureDateBasis: "issued_at",
            expectedDateBasis: "issued_at",
            fretePorConta: 0,
            indicadorIe: 9,
            lojaId: 1,
            crt: 1,
            cupomFiscal: 0,
            products: { shirt: { productId: 11, naturezaOperacaoId: 1 } },
          }
        : {
            natureza_operacao: "Venda de mercadoria",
            tipo_documento: 1,
            finalidade_emissao: 1,
            local_destino: 1,
            consumidor_final: 1,
            presenca_comprador: 2,
            modalidade_frete: 0,
            indicador_inscricao_estadual_destinatario: 9,
          },
  };
  const profileBody = {
    environment: "homologation",
    provider,
    operation: "sale",
    issuerRegime: "simples_nacional",
    sourceContractVersion:
      provider === "focus" ? "focus-nfe-v2-2026-11" : "bling-v3-2026-11",
    itemRules: rules,
    recipientRequirements: ["name", "taxId"],
  };
  const saveProfile = async () => {
    const response = await a.request("POST", "/profiles", profileBody);
    assert.equal(response.status, 201);
    const profile = await response.json();
    assert.equal(
      (
        await a.request("POST", "/profiles/" + profile.id + "/confirm", {
          environment: "homologation",
        })
      ).status,
      201
    );
    return profile;
  };
  let profile = options.taxPending ? undefined : await saveProfile();
  const setup = {
    environment: "homologation",
    companyId: "original-company",
    fiscalTimeZone: "America/Sao_Paulo",
    ...(provider === "bling"
      ? {
          accountConfiguration: {
            profileVersionId: profile.id,
            policyVersion: "original_policy_v1",
            confirmed: true,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            certificateValidUntil: new Date(
              Date.now() + 86400000
            ).toISOString(),
            effects: {
              stockOnSave: false,
              stockOnAuthorize: false,
              stockOnCancel: false,
              accountsOnSave: false,
              accountsOnAuthorize: false,
              accountsOnCancel: false,
              automaticEmail: false,
            },
          },
        }
      : {}),
  };
  assert.equal(
    (await a.request("PUT", "/connection/" + connection.id + "/setup", setup))
      .status,
    200
  );
  assert.equal(
    (
      await a.request("POST", "/connection/" + connection.id + "/activate", {
        environment: "homologation",
      })
    ).status,
    201
  );
  connection.activatedAt = (
    await f.prisma.fiscalConnection.findUniqueOrThrow({
      where: { id: connection.id },
    })
  ).activatedAt?.toISOString();
  const { CHECKOUT_REPOSITORY } = await dist(
    "modules/checkout/domain/ports/checkout-repository.port"
  );
  const repo = app.get(CHECKOUT_REPOSITORY);
  const customer = {
    fullName: "Original Buyer",
    email:
      "buyer-" +
      crypto
        .randomUUID()
        .replaceAll("-", "")
        .replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d))) +
      "@example.test",
    email_verified: !options.guest,
    cpf: "52998224725",
    phone: "31999999999",
    address_verified: true,
    address: {
      zip: "01001000",
      street: "Rua Um",
      number: "12",
      complement: "",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  };
  await asMerchant(() =>
    repo.saveSession({
      merchantId: a.merchantId,
      sessionId,
      globalUserId: "buyer_" + sessionId,
      conversationId: sessionId,
      cart: {
        currency: "BRL",
        total: 10,
        items: [
          {
            sku: "shirt",
            name: "Original Shirt",
            price: 10,
            quantity: 1,
            productType: "physical",
          },
        ],
      },
      customer: options.guest
        ? { address: customer.address, address_verified: true }
        : customer,
      shipping: { customerPrice: 0, method: "original_delivery" },
      chatHistory: [],
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  );
  const { CompleteOrderUseCase } = await dist(
      "modules/checkout/application/use-cases/complete-order.use-case"
    ),
    complete = app.get(CompleteOrderUseCase),
    completion = {
      merchant_id: a.merchantId,
      session_id: sessionId,
      external_order_id: orderId,
      order_total: 10,
      currency: "BRL",
    };
  const approveCreated = async () => {
    const { HandleStripeWebhookUseCase } = await dist(
      "modules/payment/application/handle-stripe-webhook.use-case"
    );
    const event = {
        id: "evt_" + sessionId,
        type: "payment_intent.succeeded",
        object: "event",
        livemode: stripeOriginal.livemode,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            ...stripeOriginal,
            status: "succeeded",
            amount_received: stripeOriginal.amount,
          },
        },
      },
      raw = Buffer.from(JSON.stringify(event));
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: raw.toString(),
      secret: fixtureEnv.STRIPE_WEBHOOK_SECRET_TEST,
    });
    await asMerchant(() =>
      app.get(HandleStripeWebhookUseCase).execute(raw, signature)
    );
  };
  const createPaid = async () => {
    const { PAYMENT_PROVIDER_PORT } = await dist(
        "modules/payment/domain/ports/payment-provider.port"
      ),
      { PAYMENT_REPOSITORY } = await dist(
        "modules/payment/domain/ports/payment-repository.port"
      ),
      { PaymentIntentEntity } = await dist(
        "modules/payment/domain/payment-intent.entity"
      ),
      { HandleStripeWebhookUseCase } = await dist(
        "modules/payment/application/handle-stripe-webhook.use-case"
      );
    const entity = PaymentIntentEntity.create({
      merchantId: a.merchantId,
      sessionId,
      idempotencyKey: "original",
      amountCents: 1000,
      currency: "BRL",
      method: "card",
    });
    const providerPort = app.get(PAYMENT_PROVIDER_PORT);
    const original = await asMerchant(() =>
      providerPort.preparePayment({
        merchantId: a.merchantId,
        sessionId,
        intentId: entity.id,
        amountCents: 1000,
        currency: "BRL",
        method: "card",
        provider: "stripe",
      })
    );
    entity.prepareCreation(original);
    entity.claimCreation("original_lease", new Date());
    const created = await asMerchant(() =>
      providerPort.createPayment(original)
    );
    entity.markRequiresAction({ providerPaymentId: created.providerPaymentId });
    entity.completeCreation("original_lease");
    entity.setBuyerFacingPayload(created.buyerFacingPayload);
    await asMerchant(() =>
      app.get(PAYMENT_REPOSITORY).saveIntent({ intent: entity })
    );
    await approveCreated();
    return { entity, original };
  };
  return {
    ...a,
    scope,
    asMerchant,
    sessionId,
    orderId,
    connection,
    profile,
    erp,
    customer,
    repo,
    complete,
    completion,
    saveProfile,
    createPaid,
    approveCreated,
    companies,
    issued,
    sent,
    emailRequests,
    llmTrace,
    authorize: () => {
      authorized = true;
    },
    reject: () => { rejected = true; },
    setAssistantOrderId: (value: string) => { assistantOrderId = value; },
    restoreBling: () => {
      blingRestored = true;
    },
    counts: () => ({ pspCreate, pspRead, fiscalWrite }),
    snapshot: () =>
      f.prisma.fiscalSaleSnapshot.findFirstOrThrow({
        where: { merchantId: a.merchantId, orderId },
      }),
    intent: () =>
      f.prisma.fiscalIntent.findFirstOrThrow({
        where: { merchantId: a.merchantId, orderId },
      }),
  };
}
test("FISCAL-10/19 actual signed paid repository produces immutable commercial snapshot and normal runtime issues one original note", async () => {
  const a = await vertical();
  const paid = await a.createPaid();
  const original = await a.snapshot();
  assert.equal(original.paymentProofRef, paid.entity.id);
  assert.equal(original.merchantId, a.merchantId); assert.equal(original.orderMerchantId, a.merchantId);
  assert.equal(original.completedOrderId, (await f.prisma.completedOrder.findFirstOrThrow({ where: { merchantId: a.merchantId, externalOrderId: a.orderId } })).id);
  assert.equal((await a.intent()).state, "queued");
  await a.asMerchant(() => runtime.worker.runOnce(a.scope));
  assert.equal(
    (await a.intent()).lastErrorCode,
    "fiscal_payment_acquirer_configuration_required"
  );
  assert.equal(a.counts().fiscalWrite, 0);
  const setup = await a.request(
    "PUT",
    "/connection/" + a.connection.id + "/setup",
    {
      environment: "homologation",
      paymentConfiguration: {
        paymentIntentId: paid.entity.id,
        confirmed: true,
        environment: "test",
        acquirerTaxId: "12345678000195",
      },
    }
  );
  assert.equal(setup.status, 200, JSON.stringify(await setup.clone().json()));
  assert.equal((await a.intent()).state, "queued");
  await a.asMerchant(() => runtime.worker.runOnce(a.scope));
  assert.equal(a.counts().fiscalWrite, 1);
  assert.equal(a.issued[0].items[0].quantidade_comercial, 1);
  assert.equal(a.issued[0].valor_total, 10);
  assert.equal(a.issued[0].cnpj_emitente, a.connection.issuerTaxId);
  assert.equal((await a.intent()).connectionId, a.connection.id);
  const revision = await f.prisma.fiscalIssuanceRevision.findFirstOrThrow({
    where: { intentId: (await a.intent()).id },
  });
  const reads = a.counts().pspRead;
  a.authorize();
  await a.asMerchant(async () =>
    runtime.reconciliation.reconcile(a.scope, (await a.intent()).id)
  );
  assert.equal((await a.intent()).state, "authorized");
  assert.deepEqual(await a.snapshot(), original);
  assert.equal(a.counts().pspCreate, 1);
  assert.equal(a.counts().pspRead, reads);
  assert.equal(
    (revision.paymentEvidence as any).receipt.authorizationCode,
    "ORIGINALAUTH"
  );
  assert.equal(
    await f.prisma.buyerPurchaseRecord.count({
      where: { merchantId: a.merchantId, orderId: a.orderId },
    }),
    1
  );
});
test("FISCAL-18 actual revoked Bling bridge moves paid intent to action_required then protected original reconnect resumes frozen operation", async () => {
  const a = await vertical({ provider: "bling" });
  const paid = await a.createPaid();
  await a.request("PUT", "/connection/" + a.connection.id + "/setup", {
    environment: "homologation",
    paymentConfiguration: {
      paymentIntentId: paid.entity.id,
      confirmed: true,
      environment: "test",
      acquirerTaxId: "12345678000195",
    },
  });
  await f.prisma.erpConnection.update({
    where: { id: a.erp.id },
    data: { status: "error" },
  });
  await a.asMerchant(() => runtime.worker.runOnce(a.scope));
  const intent = await a.intent();
  assert.equal(intent.state, "action_required");
  assert.equal(intent.lastErrorCode, "fiscal_erp_reconnect_required");
  const before = await f.prisma.fiscalIssuanceRevision.findFirstOrThrow({
    where: { intentId: intent.id },
  });
  const reads = a.counts().pspRead;
  const detail = await a.request(
    "GET",
    "/invoices/" + intent.id + "?environment=homologation"
  );
  assert.ok(
    (await detail.json()).allowedActions.some(
      (v: any) => v.kind === "reconnect"
    )
  );
  await f.prisma.erpConnection.update({
    where: { id: a.erp.id },
    data: { status: "connected" },
  });
  a.restoreBling();
  const reconnect = await a.request(
    "POST",
    "/connection/" + a.connection.id + "/reconnect",
    { environment: "homologation" }
  );
  assert.equal(reconnect.status, 201);
  assert.equal((await a.intent()).state, "queued");
  await a.asMerchant(() => runtime.worker.runOnce(a.scope));
  const current = await a.intent();
  assert.equal(current.state, "processing");
  assert.equal(current.remoteInvoiceId, "77");
  assert.equal(current.connectionId, intent.connectionId);
  assert.equal(current.stableReference, intent.stableReference);
  assert.deepEqual(
    await f.prisma.fiscalIssuanceRevision.findFirstOrThrow({
      where: { intentId: intent.id },
    }),
    before
  );
  assert.equal(a.counts().pspRead, reads);
  assert.equal(a.counts().pspCreate, 1);
  assert.equal(
    (
      await f.prisma.fiscalConnection.findUniqueOrThrow({
        where: { id: a.connection.id },
      })
    ).activatedAt?.toISOString(),
    a.connection.activatedAt
  );
});

async function canonicalIdentity(a: Awaited<ReturnType<typeof vertical>>) {
  await assert.rejects(
    a.asMerchant(() => a.complete.execute(a.completion)),
    /fiscal_customer_data_required/
  );
  assert.equal(a.counts().pspCreate, 0);
  assert.equal(
    await f.prisma.fiscalSaleSnapshot.count({
      where: { merchantId: a.merchantId },
    }),
    0
  );
  const [{ CheckoutCustomerService }, { FiscalRecipientUpdateService }] = await Promise.all([
    dist("modules/checkout/application/services/checkout-customer.service"),
    dist("modules/fiscal/application/fiscal-recipient-update.service"),
  ]);
  const prepared = await a.asMerchant(() => app.get(FiscalRecipientUpdateService).prepare({
    merchantId: a.merchantId, sessionId: a.sessionId, mode: "buyer",
  }));
  assert.equal(prepared.active, true); assert.equal(prepared.mode, "buyer");
  const customer = app.get(CheckoutCustomerService);
  const say = async (text: string, prompt?: string) =>
    a.asMerchant(async () =>
      customer.processCustomerInput(
        await a.repo.getSession(a.merchantId, a.sessionId),
        text,
        prompt,
        "Original merchant"
      )
    );
  await say("31999999999", "Qual seu telefone?");
  await say(a.customer.email, "Qual seu e-mail?");
  let session = await a.asMerchant(() =>
    a.repo.getSession(a.merchantId, a.sessionId)
  );
  assert.notEqual(session.customer.email_verified, true);
  const otpEmails = a.emailRequests.filter(email => email.kind === "otp");
  assert.equal(otpEmails.length, 1); assert.equal(otpEmails[0].to, a.customer.email);
  assert.ok(session.customer.otp_code); assert.ok(otpEmails[0].html.includes(session.customer.otp_code));
  assert.equal(otpEmails[0].idempotencyKey, "checkout-otp:" + a.merchantId + ":" + a.sessionId + ":" + session.customer.otp_code);
  assert.equal(otpEmails[0].subject, session.customer.otp_code + " é seu código de confirmação");
  await say(session.customer.otp_code, "Informe o código recebido.");
  await say("Meu nome e Original Buyer", "Qual seu nome?");
  await say("52998224725", "Qual seu CPF?");
  session = await a.asMerchant(() =>
    a.repo.getSession(a.merchantId, a.sessionId)
  );
  assert.equal(session.customer.email_verified, true);
  assert.equal(session.customer.cpf, "52998224725");
  assert.equal(session.customer.phone, "31999999999");
  const account = await f.prisma.buyerAccount.findUniqueOrThrow({
    where: { globalUserId: session.globalUserId },
  });
  assert.equal(account.email, a.customer.email);
  return account;
}
async function canonicalPaid() {
  const a = await vertical({ guest: true }),
    account = await canonicalIdentity(a);
  const paid = await a.createPaid();
  const snapshot = await a.snapshot();
  assert.equal(snapshot.buyerGlobalUserId, account.globalUserId);
  assert.equal((snapshot.recipient as any).taxId, "52998224725");
  assert.ok((snapshot.recipient as any).name);
  assert.ok((snapshot.recipient as any).address.cityCode);
  assert.equal(
    (
      await a.request("PUT", "/connection/" + a.connection.id + "/setup", {
        environment: "homologation",
        paymentConfiguration: {
          intentId: (await a.intent()).id,
          confirmed: true,
          environment: "test",
          acquirerTaxId: "12345678000195",
        },
      })
    ).status,
    200
  );
  await a.asMerchant(() => runtime.worker.runOnce(a.scope));
  a.authorize();
  await a.asMerchant(async () =>
    runtime.reconciliation.reconcile(a.scope, (await a.intent()).id)
  );
  assert.equal((await a.intent()).state, "authorized");
  return { ...a, paid, account, originalSnapshot: snapshot };
}
test("FISCAL-63 actual paid producers and normal runtime expose separate committed document and blocked-channel metrics", async () => {
  const before = Object.fromEntries(await Promise.all(["authorized", "rejected", "reconciliation_required"].map(async outcome => [outcome, await fiscalMetric("fiscal_documents_total", { provider: "focus", environment: "homologation", outcome })])));
  const a = await canonicalPaid();
  assert.equal(await fiscalMetric("fiscal_documents_total", { provider: "focus", environment: "homologation", outcome: "authorized" }), before.authorized + 1);
  await a.asMerchant(async () => runtime.reconciliation.reconcile(a.scope, (await a.intent()).id));
  assert.equal(await fiscalMetric("fiscal_documents_total", { provider: "focus", environment: "homologation", outcome: "authorized" }), before.authorized + 1, "authenticated read replay is not a new authorization");
  const savedAccounts = process.env.FISCAL_RESEND_ACCOUNTS;
  delete process.env.FISCAL_RESEND_ACCOUNTS;
  const blockedBefore = await fiscalMetric("fiscal_deliveries_total", { outcome: "blocked" });
  try { await a.asMerchant(async () => runtime.deliveries.dispatchAll(a.scope, (await a.intent()).id)); }
  finally { if (savedAccounts === undefined) delete process.env.FISCAL_RESEND_ACCOUNTS; else process.env.FISCAL_RESEND_ACCOUNTS = savedAccounts; }
  assert.equal(await fiscalMetric("fiscal_deliveries_total", { outcome: "blocked" }), blockedBefore + 2);
  assert.equal((await a.intent()).state, "authorized");
  const prepare = async () => {
    const b = await vertical(); const paid = await b.createPaid();
    assert.equal((await b.request("PUT", "/connection/" + b.connection.id + "/setup", { environment: "homologation", paymentConfiguration: { paymentIntentId: paid.entity.id, confirmed: true, environment: "test", acquirerTaxId: "12345678000195" } })).status, 200);
    await b.asMerchant(() => runtime.worker.runOnce(b.scope));
    return b;
  };
  const rejected = await prepare(); rejected.reject();
  await rejected.asMerchant(async () => runtime.reconciliation.reconcile(rejected.scope, (await rejected.intent()).id));
  assert.equal((await rejected.intent()).state, "rejected");
  assert.equal(await fiscalMetric("fiscal_documents_total", { outcome: "rejected" }), before.rejected + 1);
  const uncertain = await prepare();
  transport = () => new Response("private-provider-error-should-not-be-logged", { status: 503 });
  await uncertain.asMerchant(async () => runtime.reconciliation.reconcile(uncertain.scope, (await uncertain.intent()).id));
  assert.equal((await uncertain.intent()).state, "reconciliation_required");
  assert.equal(await fiscalMetric("fiscal_documents_total", { outcome: "reconciliation_required" }), before.reconciliation_required + 1);
  assert.equal(await fiscalMetric("fiscal_documents_total", { outcome: "authorized" }), before.authorized + 1);
  assert.equal(a.counts().pspCreate + rejected.counts().pspCreate + uncertain.counts().pspCreate, 3);
  assert.equal(httpLogs.join("").includes("private-provider-error-should-not-be-logged"), false);
  const metrics = await originalFetch(base + "/v1/metrics");
  assert.equal(metrics.status, 200);
  const fiscal = (await metrics.text()).split("\n").filter(line => /^fiscal_/.test(line));
  assert.ok(fiscal.some(line => /fiscal_documents_total.*outcome="authorized"/.test(line)), "served existing metrics endpoint includes fiscal outcomes");
  for (const line of fiscal) {
    assert.doesNotMatch(line, /merchant_id|intent_id|account_id|receipt|taxId|payload|stableReference/);
    assert.equal(line.includes(a.merchantId) || line.includes(a.orderId), false);
  }
});
test("FISCAL-76 actual public completion before OTP cannot freeze an unrecognized owner even when recipient fields exist", async () => {
  const a = await vertical({ guest: true });
  await a.asMerchant(async () => {
    const session = await a.repo.getSession(a.merchantId, a.sessionId);
    await a.repo.saveSession({
      ...session,
      customer: { ...a.customer, email_verified: false },
    });
  });
  await assert.rejects(
    a.asMerchant(() => a.complete.execute(a.completion)),
    /fiscal_customer_data_required/
  );
  assert.equal(
    await f.prisma.completedOrder.count({
      where: { merchantId: a.merchantId },
    }),
    0
  );
  assert.equal(
    await f.prisma.fiscalSaleSnapshot.count({
      where: { merchantId: a.merchantId },
    }),
    0
  );
  assert.equal(a.counts().pspCreate, 0);
});
test("FISCAL-41/76 actual canonical OTP guest paid sale reaches BuyerHub and actual assistant HTTP fiscal block without seeded purchase", async () => {
  const a = await canonicalPaid();
  assert.equal(
    await f.prisma.buyerPurchaseRecord.count({
      where: {
        merchantId: a.merchantId,
        orderId: a.orderId,
        globalUserId: a.account.globalUserId,
      },
    }),
    1
  );
  const { BuyerJwtService } = await dist(
      "modules/buyer-account/domain/services/buyer-jwt.service"
    ),
    buyerToken = app.get(BuyerJwtService).sign({
      globalUserId: a.account.globalUserId,
      email: a.account.email,
      merchantId: a.merchantId,
    });
  const portal = await originalFetch(
    base +
      "/v1/buyer/me/orders/" +
      a.merchantId +
      "/" +
      a.orderId +
      "/fiscal?environment=homologation",
    { headers: { authorization: "Bearer " + buyerToken } }
  );
  assert.equal(portal.status, 200);
  const notes = await portal.json();
  assert.equal(notes.items[0].state, "authorized");
  assert.equal(notes.items[0].number, "22");
  const { RealtimeCapabilityService } = await dist(
      "shared/auth/realtime-capability"
    ),
    origin = "http://localhost:3000",
    capability = app.get(RealtimeCapabilityService).issue({
      purpose: "storefront-conversation",
      merchantId: a.merchantId,
      resourceId: a.sessionId,
      aiUserId: "buyer:" + a.account.globalUserId,
      origin,
    });
  const response = await originalFetch(
    base + "/v1/storefront/conversations/" + a.sessionId + "/messages",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + capability.token,
        "x-buyer-authorization": "Bearer " + buyerToken,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_message: "Nota fiscal do pedido " + a.orderId,
        global_user_id: "attacker",
        buyerId: "attacker",
      }),
    }
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  const block = result.blocks.find((b: any) => b.type === "fiscal_invoices");
  assert.ok(block);
  assert.ok(a.llmTrace.some(row => row.phase === "classifier" && row.returnedTools.length === 0));
  assert.ok(a.llmTrace.some(row => row.phase === "main" && row.tools.includes("get_invoice") && row.returnedTools.includes("get_invoice")));
  assert.equal(block.data.invoices[0].intentId, (await a.intent()).id);
  assert.equal(block.data.invoices[0].state, "authorized");
  assert.equal(block.data.invoices[0].number, "22");
  assert.deepEqual(await a.snapshot(), a.originalSnapshot);
  assert.equal(a.counts().pspCreate, 1);
});
async function fiscalMetric(name: string, labels: Record<string, string>): Promise<number> {
  const { MetricsService } = await dist("shared/observability/metrics.service");
  const metric = app.get(MetricsService).registry.getSingleMetric(name);
  assert.ok(metric, "real runtime metric registered: " + name);
  return (await metric.get()).values.filter((row: any) => Object.entries(labels).every(([key, value]) => row.labels[key] === value)).reduce((sum: number, row: any) => sum + row.value, 0);
}
test("FISCAL-48/49 actual authenticated Meta original-order request enables automatic eligible channels independently of missing files", async () => {
  const emailBefore = await fiscalMetric("fiscal_deliveries_total", { channel: "email", transport: "resend", outcome: "accepted" });
  const whatsappBefore = await fiscalMetric("fiscal_deliveries_total", { channel: "whatsapp", transport: "meta", outcome: "accepted" });
  const deliveredBefore = await fiscalMetric("fiscal_deliveries_total", { channel: "whatsapp", transport: "meta", outcome: "delivered" });
  const a = await canonicalPaid();
  const { WHATSAPP_CONFIG_REPOSITORY } = await dist(
    "modules/whatsapp-channel/domain/ports/whatsapp-config-repository.port"
  );
  const config = await a.asMerchant(() =>
    app.get(WHATSAPP_CONFIG_REPOSITORY).upsert(a.merchantId, {
      enabled: true,
      provider: "META_CLOUD",
      status: "ACTIVE",
      whatsappNumber: "+5511888888888",
      credentials: {
        accessToken: "synthetic-original-meta-token",
        phoneNumberId: "123456789012345",
        wabaId: "123456789012346",
      },
    })
  );
  await f.prisma.whatsAppSession.create({
    data: {
      merchantId: a.merchantId,
      buyerPhone: "+5531999999999",
      checkoutSessionId: a.sessionId,
      deviceId: "META_CLOUD:" + config.id,
    },
  });
  const originalSession = await f.prisma.checkoutSession.findUniqueOrThrow({
    where: { merchantId_sessionId: { merchantId: a.merchantId, sessionId: a.sessionId } },
    select: { createdAt: true },
  });
  const earliestProviderSecond = Math.ceil(originalSession.createdAt.getTime() / 1000);
  while (Math.floor(Date.now() / 1000) < earliestProviderSecond) {
    await new Promise(resolve => setTimeout(resolve, Math.max(1, earliestProviderSecond * 1000 - Date.now())));
  }
  const raw = JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "123456789012345" },
              messages: [
                {
                  id: "wamid_original_request_" + a.sessionId,
                  from: "5531999999999",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "Envie a nota fiscal do pedido " + a.orderId },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const incoming = await originalFetch(base + "/v1/webhooks/whatsapp/meta", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256":
        "sha256=" +
        createHmac("sha256", fixtureEnv.META_APP_SECRET)
          .update(raw)
          .digest("hex"),
    },
    body: raw,
  });
  assert.equal(incoming.status, 200);
  const record = await f.prisma.whatsAppWebhookInbox.findFirstOrThrow({
    where: {
      merchantId: a.merchantId,
      eventId: "wamid_original_request_" + a.sessionId,
    },
  });
  assert.equal((record.payload as any).providerTimestampVerified, true);
  process.env.FISCAL_RESEND_ACCOUNTS = JSON.stringify([
    {
      keyFingerprint: createHash("sha256")
        .update(fixtureEnv.RESEND_API_KEY)
        .digest("hex"),
      fromEmail: fixtureEnv.RESEND_FROM_EMAIL,
      domainId: "original-domain",
      hookRef: "original-runtime-hook",
      hookSecret:
        "whsec_" +
        Buffer.from("synthetic-original-hook-secret").toString("base64"),
    },
  ]);
  const { DOMAIN_EVENT_BUS } = await dist(
    "shared/events/domain-event-bus.port"
  );
  const authorizedHandlers = app
    .get(DOMAIN_EVENT_BUS)
    .handlersFor("fiscal.document.authorized");
  assert.equal(authorizedHandlers.length, 1);
  await assert.rejects(
    authorizedHandlers[0].handle({
      eventType: "fiscal.document.authorized",
      merchantId: a.merchantId,
      payload: { environment: "homologation", intentId: (await a.intent()).id },
    }),
    /fiscal_recovery_pending/
  );
  const deliveries = await f.prisma.fiscalDelivery.findMany({
    where: { merchantId: a.merchantId },
  });
  assert.equal(
    deliveries.find((d) => d.channel === "email")!.state,
    "accepted"
  );
  assert.equal(
    deliveries.find((d) => d.channel === "whatsapp")!.state,
    "accepted"
  );
  assert.deepEqual(a.sent.sort(), ["email", "whatsapp"]);
  assert.equal(a.emailRequests.length, 2);
  assert.equal(a.emailRequests.filter(email => email.kind === "otp").length, 1);
  assert.equal(a.emailRequests.filter(email => email.kind === "fiscal").length, 1);
  assert.equal(await fiscalMetric("fiscal_deliveries_total", { channel: "email", transport: "resend", outcome: "accepted" }), emailBefore + 1);
  assert.equal(await fiscalMetric("fiscal_deliveries_total", { channel: "whatsapp", transport: "meta", outcome: "accepted" }), whatsappBefore + 1);
  assert.equal((await a.intent()).state, "authorized");
  const whatsapp = deliveries.find((d) => d.channel === "whatsapp")!;
  const statusRaw = Buffer.from(
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123456789012346",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: whatsapp.transportAccountId },
                statuses: [
                  {
                    id: whatsapp.providerMessageId,
                    status: "delivered",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: "5531999999999",
                  },
                ],
              },
            },
          ],
        },
      ],
    })
  );
  const receipt = await originalFetch(base + "/v1/webhooks/whatsapp/meta", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256":
        "sha256=" +
        createHmac("sha256", fixtureEnv.META_APP_SECRET)
          .update(statusRaw)
          .digest("hex"),
    },
    body: statusRaw,
  });
  assert.equal(receipt.status, 200);
  assert.equal(await fiscalMetric("fiscal_deliveries_total", { channel: "whatsapp", transport: "meta", outcome: "delivered" }), deliveredBefore + 1);
  assert.equal((await originalFetch(base + "/v1/webhooks/whatsapp/meta", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + createHmac("sha256", fixtureEnv.META_APP_SECRET).update(statusRaw).digest("hex") }, body: statusRaw })).status, 200);
  assert.equal(await fiscalMetric("fiscal_deliveries_total", { channel: "whatsapp", transport: "meta", outcome: "delivered" }), deliveredBefore + 1, "signed delivery replay does not count twice");
  assert.equal(
    (
      await f.prisma.fiscalDelivery.findUniqueOrThrow({
        where: { id: whatsapp.id },
      })
    ).state,
    "delivered"
  );
  assert.equal(
    (
      await f.prisma.fiscalDelivery.findFirstOrThrow({
        where: { documentId: whatsapp.documentId, channel: "email" },
      })
    ).state,
    "accepted"
  );
});
test("FISCAL-07 actual full HTTP and canonical client preserve only missing address number before any PSP", async () => {
  const a = await vertical();
  await a.asMerchant(async () => {
    const session = await a.repo.getSession(a.merchantId, a.sessionId);
    delete session.customer.address.number;
    await a.repo.saveSession(session);
  });
  const response = await originalFetch(base + "/v1/payment/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      merchant_id: a.merchantId,
      session_id: a.sessionId,
      idempotency_key: "original-first",
      method: "card",
    }),
  });
  assert.equal(response.status, 400);
  const body = await response.clone().json();
  assert.equal(body.code, "fiscal_customer_data_required");
  assert.deepEqual(body.fields, ["address.number"]);
  const { CheckoutApiError } = await import(
    new URL(
      "../../../../widget_v2/src/api/checkout-api-error.ts",
      import.meta.url
    ).href
  );
  const error = await CheckoutApiError.fromResponse("payment", response);
  assert.deepEqual(error.details.fields, ["address.number"]);
  assert.equal(a.counts().pspCreate, 0);
  assert.equal(
    await f.prisma.paymentIntent.count({ where: { merchantId: a.merchantId } }),
    0
  );
});
test("FISCAL-05 actual global 409 readiness response retains concrete checks for protected configuration", async () => {
  const a = await actor();
  const connect = await a.request("PUT", "/connection", {
    environment: "homologation",
    provider: "focus",
    issuerTaxId: "12ABC34501DE35",
    credential: {
      kind: "company_token",
      secret: "synthetic-uninspected-company",
    },
    stockOwner: "zyon",
    emailOwner: "zyon",
    whatsappOwner: "zyon",
  });
  assert.equal(connect.status, 200);
  const row = await connect.json();
  const response = await a.request(
    "POST",
    "/connection/" + row.id + "/activate",
    { environment: "homologation" }
  );
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "fiscal_connection_not_ready");
  assert.ok(body.pending.includes("issuer"));
  assert.ok(body.pending.includes("permissions"));
});
// These test-only seeds prepare an archived cross-store security proof. They do
// not enable marketplace admission or substitute for shipping authorization.
async function seedHistoricalMarketplaceInventory(prisma: any, product: any) {
  const locations = await prisma.inventoryLocation.findMany({
    where: { merchantId: product.merchantId, isActive: true },
  });
  const location = locations.find((row: any) => row.isDefault) ?? await prisma.inventoryLocation.create({
    data: { merchantId: product.merchantId, name: "Historical fixture inventory", isDefault: true },
  });
  for (const variant of product.variants) {
    const stock = await prisma.productStock.findFirst({ where: { variantId: variant.id } });
    await prisma.inventoryItem.upsert({
      where: { merchantId_sku_locationId: { merchantId: product.merchantId, sku: variant.sku, locationId: location.id } },
      create: { merchantId: product.merchantId, sku: variant.sku, productName: product.name,
        locationId: location.id, quantity: stock?.quantity ?? 0 },
      update: { quantity: stock?.quantity ?? 0 },
    });
  }
}

async function seedHistoricalMarketplaceShipping(prisma: any, scope: { merchantId: string; sessionId: string }) {
  const [{ PrismaCheckoutRepository }, { QuoteMarketplaceShippingService }, { carrierQuoteSnapshot }, { marketplaceShippingContractHash }] = await Promise.all([
    dist("modules/checkout/infrastructure/prisma/prisma-checkout.repository"),
    dist("modules/shipping/application/use-cases/quote-marketplace-shipping.service"),
    dist("modules/shipping/domain/marketplace-shipment-journal"),
    dist("modules/shipping/domain/marketplace-shipping-contract"),
  ]);
  const checkout = new PrismaCheckoutRepository(prisma);
  const session = await checkout.getSession(scope.merchantId, scope.sessionId);
  await checkout.saveSession({ ...session, customer: { ...session.customer, address: {
    zip: "30130010", street: "Historical fixture street", number: "10", city: "Belo Horizonte", state: "MG",
    ...session.customer?.address,
  } } });
  const participants = new Set<string>([scope.merchantId, ...session.cart.items
    .map((item: any) => item.marketplace?.sourceMerchantId).filter(Boolean)]);
  for (const merchantId of participants) {
    await prisma.merchant.update({ where: { id: merchantId }, data: {
      melhorEnvioAccessToken: "test-only-carrier-account", melhorEnvioEnabled: true,
    } });
    await prisma.marketplaceConfig.upsert({ where: { merchantId },
      create: { merchantId, enabled: true, allowedCategories: [], blockedMerchants: [] }, update: { enabled: true } });
    await prisma.merchantBillingSubscription.upsert({ where: { merchantId },
      create: { merchantId, status: "active", planKey: "scale" }, update: { status: "active", planKey: "scale" } });
    await checkout.getRules(merchantId);
    const rule = await prisma.merchantRule.findUniqueOrThrow({ where: { merchantId } });
    await prisma.merchantRule.update({ where: { merchantId }, data: { originZip: rule.originZip || "01001000", allowFreeShipping: false } });
    if (merchantId !== scope.merchantId) await prisma.marketplaceConnection.upsert({
      where: { buyerMerchantId_sellerMerchantId: { buyerMerchantId: scope.merchantId, sellerMerchantId: merchantId } },
      create: { buyerMerchantId: scope.merchantId, sellerMerchantId: merchantId }, update: {},
    });
  }
  for (const item of session.cart.items) {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: item.variantId } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: {
      weightGrams: variant.weightGrams || 500, heightCm: variant.heightCm || 10,
      widthCm: variant.widthCm || 15, lengthCm: variant.lengthCm || 20,
    } });
    await prisma.productPrice.upsert({ where: { variantId: variant.id },
      create: { variantId: variant.id, basePriceInCents: Math.round(item.price * 100) }, update: {} });
  }
  const service = new QuoteMarketplaceShippingService(prisma, { fetchQuotes: async (origin: any) => {
    const products = origin.shipmentContract.products;
    const snapshot = carrierQuoteSnapshot({ environment: "test", serviceId: 1, amountCents: 100,
      accountFingerprint: marketplaceShippingContractHash(["melhor-envio", "https://sandbox.melhorenvio.com.br", "test-only-carrier-account"]),
      products: products.map((product: any) => ({ id: product.lineItemId, unitValueCents: product.unitValueCents, quantity: product.quantity })),
      packages: [{ price: "1.00", dimensions: {
        height: products.reduce((sum: number, product: any) => sum + product.heightCm * product.quantity, 0),
        width: Math.max(...products.map((product: any) => product.widthCm)),
        length: Math.max(...products.map((product: any) => product.lengthCm)),
      }, weight: products.reduce((sum: number, product: any) => sum + product.weightKg * product.quantity, 0),
      insurance_value: origin.shipmentContract.insuranceTotalCents / 100,
      products: products.map((product: any) => ({ id: product.lineItemId, quantity: product.quantity })),
      }],
    });
    assert.ok(snapshot, "the controlled carrier must produce a valid packed quote snapshot");
    return [{ carrier_key: "melhor-envio-1", currency: "BRL", label: "Historical fixture carrier",
      price: 100, eta_days: 2, is_free: false, marketplaceCarrierQuote: snapshot }];
  } });
  const quoted = await service.quote(scope);
  return service.select({ ...scope, selections: quoted.origins.map((origin: any) => ({
    merchantId: origin.merchantId, quoteId: origin.quoteId, carrierKey: origin.results[0].carrier_key,
  })) });
}

test("FISCAL-24/42 FI-D16 excludes new cross-store issuance and preserves archived private ownership through assistant", async () => {
  const a = await vertical({ guest: true }),
    account = await canonicalIdentity(a),
    seller = await actor();
  for (const merchantId of [a.merchantId, seller.merchantId]) {
    await f.prisma.marketplaceConfig.create({
      data: {
        merchantId,
        enabled: true,
        allowedCategories: [],
        blockedMerchants: [],
      },
    });
    await f.prisma.merchantBillingSubscription.create({
      data: { merchantId, status: "active", planKey: "scale" },
    });
  }
  await f.prisma.marketplaceConnection.create({
    data: {
      buyerMerchantId: a.merchantId,
      sellerMerchantId: seller.merchantId,
    },
  });
  const { PAYMENT_PLATFORM_REPOSITORY } = await dist(
    "modules/payment/domain/ports/payment-platform-repository.port"
  );
  await tenants.run(
    { merchantId: seller.merchantId, userId: seller.user.id, role: "owner" },
    () =>
      app.get(PAYMENT_PLATFORM_REPOSITORY).saveConnection({
        merchantId: seller.merchantId,
        provider: "stripe",
        environment: "test",
        status: "active",
        chargesEnabled: true,
        payoutsEnabled: true,
        externalAccountId: "acct_synthetic_seller",
      })
  );
  const sku = "seller_" + crypto.randomUUID(),
    product = await f.prisma.product.create({
      data: {
        merchantId: seller.merchantId,
        name: "Original seller shirt",
        type: "physical",
        variants: {
          create: {
            sku,
            price: { create: { basePriceInCents: 1000 } },
            stock: { create: { quantity: 2 } },
          },
        },
      },
      include: { variants: true },
    });
  await seedHistoricalMarketplaceInventory(f.prisma, product);
  const projection = await f.prisma.federatedProduct.create({
    data: {
      sourceMerchantId: seller.merchantId,
      sourceProductId: product.id,
      name: "Untrusted stale projection",
      priceCents: 1,
      searchableText: "synthetic",
    },
  });
  const cartRef = crypto.randomUUID(),
    { PrismaMarketplaceCartRepository, marketplaceCartAllocations } = await dist(
      "modules/marketplace/infrastructure/repositories/prisma-marketplace-cart.repository"
    ),
    { CheckoutCartAuthorityService } = await dist(
      "modules/checkout/application/services/checkout-cart-authority.service"
    );
  const historicalCart = await new PrismaMarketplaceCartRepository(f.prisma).add({
    merchantId: a.merchantId,
    sellerMerchantId: seller.merchantId,
    checkoutSessionId: cartRef,
    federatedProductId: projection.id,
    quantity: 1,
  });
  await assert.rejects(new CheckoutCartAuthorityService(f.prisma, {}).resolveStorefront(a.merchantId, cartRef),
    /checkout_product_unavailable/, "the current local checkout still refuses new cross-store admission");
  const allocations = await marketplaceCartAllocations(f.prisma, a.merchantId, cartRef, historicalCart.cart.items);
  // Seed only the archived internal checkout shape from its actual persisted
  // lines and server allocations. Current public cart authority remains closed.
  const cart = {
    currency: "BRL", source: "storefront", cart_ref: cartRef, currentDiscount: 0,
    total: historicalCart.cart.total / 100,
    items: historicalCart.cart.items.map((line: any) => {
      const allocation = allocations.get(line.variantId);
      assert.ok(allocation, "the historical line has an actual scoped persisted allocation");
      assert.equal(line.productId, product.id);
      return { sku: line.sku, name: line.name, variantId: line.variantId, product_id: line.productId,
        productType: product.type, quantity: line.quantity, price: line.unitPriceCents / 100, marketplace: allocation };
    }),
  };
  assert.equal(cart.items[0].price, 10);
  assert.equal(cart.items[0].marketplace.sourceMerchantId, seller.merchantId);
  await a.asMerchant(async () => {
    const session = await a.repo.getSession(a.merchantId, a.sessionId);
    // A full snapshot now clears absent shipping in the real repository.
    await a.repo.saveSession({
      ...session,
      cart,
      shipping: undefined,
      shippingOptions: undefined,
    });
    const cleared = await a.repo.getSession(a.merchantId, a.sessionId);
    assert.equal(cleared.shipping, undefined);
    assert.equal(cleared.shippingOptions, undefined);
  });
  await seedHistoricalMarketplaceShipping(f.prisma, {
    merchantId: a.merchantId,
    sessionId: a.sessionId,
  });
  const issuer = "12345678000195",
    company = "seller-company",
    token = "synthetic-original-seller-company";
  a.companies.set(company, { issuer, token });
  const connectionResponse = await seller.request("PUT", "/connection", {
    environment: "homologation",
    provider: "focus",
    issuerTaxId: issuer,
    credential: { kind: "company_token", secret: token },
    stockOwner: "zyon",
    emailOwner: "zyon",
    whatsappOwner: "zyon",
  });
  assert.equal(connectionResponse.status, 200);
  const connection = await connectionResponse.json();
  const rule = a.profile.itemRules.items.shirt,
    profileResponse = await seller.request("POST", "/profiles", {
      environment: "homologation",
      provider: "focus",
      operation: "sale",
      issuerRegime: "simples_nacional",
      sourceContractVersion: "focus-nfe-v2-2026-11",
      recipientRequirements: ["name", "taxId"],
      itemRules: { ...a.profile.itemRules, items: { [sku]: rule } },
    });
  assert.equal(profileResponse.status, 201);
  const profile = await profileResponse.json();
  assert.equal(
    (
      await seller.request("POST", "/profiles/" + profile.id + "/confirm", {
        environment: "homologation",
      })
    ).status,
    201
  );
  assert.equal(
    (
      await seller.request("PUT", "/connection/" + connection.id + "/setup", {
        environment: "homologation",
        companyId: company,
        fiscalTimeZone: "America/Sao_Paulo",
      })
    ).status,
    200
  );
  assert.equal(
    (
      await seller.request(
        "POST",
        "/connection/" + connection.id + "/activate",
        { environment: "homologation" }
      )
    ).status,
    201
  );
  const { CreateMarketplacePaymentService } = await dist(
      "modules/payment/application/create-marketplace-payment.service"
    ),
    created = await a.asMerchant(() =>
      app.get(CreateMarketplacePaymentService).execute({
        merchant_id: a.merchantId,
        session_id: a.sessionId,
        idempotency_key: "original-private-marketplace",
        method: "card",
      })
    );
  assert.equal(created.status, "requires_action");
  await a.approveCreated();
  assert.equal(await f.prisma.fiscalIntent.count({ where: { orderId: a.orderId } }), 0);
  assert.equal(await f.prisma.fiscalSaleSnapshot.count({ where: { orderId: a.orderId } }), 0);
  const commercial = await f.prisma.completedOrder.findFirstOrThrow({ where: { merchantId: a.merchantId, externalOrderId: a.orderId } });
  assert.equal(commercial.orderTotal.toNumber(), 11); assert.equal((commercial.lineItemsJson as any[]).length, 1);
  const paid = await f.prisma.paymentIntent.findFirstOrThrow({ where: { merchantId: a.merchantId, sessionId: a.sessionId, status: "approved" } });
  const originalFunding = await f.prisma.marketplaceFundingPlan.findUniqueOrThrow({ where: { paymentIntentId: paid.id } });
  assert.equal(originalFunding.status, "awaiting_capture"); assert.equal(originalFunding.providerPaymentId, null);
  const completed = await f.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: a.merchantId, eventType: "order.completed" } });
  assert.equal((completed.payload as any).fiscal_stock_ownership, undefined);
  assert.equal(a.counts().fiscalWrite, 0); assert.equal(a.counts().pspCreate, 1);
  // Historical cross-store records are explicit archive fixtures, never new issuance.
  const archive = await arrangeIssuance(f, { orderMerchantId: a.merchantId, orderId: "historical_" + a.orderId, buyerGlobalUserId: account.globalUserId });
  await seedHistoricalFiscalIssuance(f, archive); archive.setRemote("authorized");
  await new HistoricalReconciliation(archive.store, archive.factory, { read: async () => ({ found: false, reasonCode: "none" }) }, new HistoricalStock(f.prisma)).reconcile(archive.scope, archive.sale.intent.id);
  const intent = archive.sale.intent, snapshot = archive.sale.snapshot;
  assert.equal(archive.writes().length, 0);
  const notes = await a.asMerchant(() =>
    runtime.documents.forOrder(
      { kind: "buyer", globalUserId: account.globalUserId },
      {
        merchantId: a.merchantId,
        environment: "homologation",
        orderId: archive.sale.orderId,
      }
    )
  );
  assert.equal(notes.length, 1);
  assert.equal(notes[0].sellerMerchantId, archive.sale.merchantId);
  assert.equal(notes[0].state, "authorized"); assert.equal(notes[0].authorizationProtocol, "151260029467289");
  const { StorefrontConversationAdapter } = await dist(
    "modules/storefront/infrastructure/adapters/storefront-conversation.adapter"
  );
  a.setAssistantOrderId(archive.sale.orderId);
  const reply = await a.asMerchant(() =>
    app.get(StorefrontConversationAdapter).reply({
      merchantId: a.merchantId,
      sessionId: a.sessionId,
      cartId: a.sessionId,
      userMessage: "Nota fiscal do pedido " + archive.sale.orderId,
      merchantName: "Original host",
        storeCategory: "physical",
        history: [],
      buyerContext: {
        globalUserId: account.globalUserId,
        email: account.email,
      },
    })
  );
  const block = reply.blocks.find((b: any) => b.type === "fiscal_invoices");
  assert.ok(block);
  assert.equal(block.data.invoices[0].sellerMerchantId, archive.sale.merchantId);
  assert.equal(block.data.invoices[0].intentId, intent.id);
  const { FiscalPaymentEvidenceReader } = await dist(
    "modules/fiscal/infrastructure/fiscal-payment-evidence.reader"
  );
  const { PAYMENT_PROVIDER_PORT } = await dist(
    "modules/payment/domain/ports/payment-provider.port"
  );
  const privateReader = new FiscalPaymentEvidenceReader(
    db,
    app.get(PAYMENT_PROVIDER_PORT),
    runtime.setup,
    tenants
  );
  const readsBeforeForeignBinding = a.counts().pspRead;
  await f.prisma.marketplaceFundingPlan.update({
    where: { paymentIntentId: paid.id },
    data: { providerPaymentId: "pi_foreign_original_operation" },
  });
  await assert.rejects(
    tenants.run(
      { merchantId: seller.merchantId, userId: seller.user.id, role: "owner" },
      async () => await privateReader.read(snapshot)
    ),
    /fiscal_order_scope_unsupported/
  );
  assert.equal(a.counts().pspRead, readsBeforeForeignBinding);
});
test("FISCAL-20 actual SDK paid tax-pending sale first issues after protected confirmation from immutable original lines", async () => {
  const a = await vertical({ taxPending: true }),
    paid = await a.createPaid(),
    snapshot = await a.snapshot(),
    intent = await a.intent();
  assert.equal(intent.state, "action_required");
  assert.equal(intent.lastErrorCode, "fiscal_profile_unconfirmed");
  assert.equal(a.counts().fiscalWrite, 0);
  assert.equal(
    (
      await f.prisma.paymentIntent.findUniqueOrThrow({
        where: { id: paid.entity.id },
      })
    ).status,
    "approved"
  );
  await a.asMerchant(async () => {
    const session = await a.repo.getSession(a.merchantId, a.sessionId);
    await a.repo.saveSession({
      ...session,
      cart: {
        ...session.cart,
        total: 90,
        items: session.cart.items.map((i: any) => ({
          ...i,
          name: "Current changed product",
          quantity: 9,
        })),
      },
      customer: { ...session.customer, fullName: "Current changed recipient" },
    });
  });
  await a.saveProfile();
  assert.equal((await a.intent()).state, "queued");
  assert.equal(
    (
      await a.request("PUT", "/connection/" + a.connection.id + "/setup", {
        environment: "homologation",
        paymentConfiguration: {
          intentId: intent.id,
          confirmed: true,
          environment: "test",
          acquirerTaxId: "12345678000195",
        },
      })
    ).status,
    200
  );
  await a.asMerchant(() => runtime.worker.runOnce(a.scope));
  assert.equal(a.counts().fiscalWrite, 1);
  assert.equal(a.issued[0].items[0].quantidade_comercial, 1);
  assert.equal(a.issued[0].valor_total, 10);
  assert.equal(a.issued[0].nome_destinatario, "Original Buyer");
  assert.deepEqual(await a.snapshot(), snapshot);
  assert.equal(a.counts().pspCreate, 1);
  assert.equal(
    await f.prisma.fiscalDocument.count({ where: { intentId: intent.id } }),
    1
  );
});


test("FISCAL-61 actual assistant buyer and visitor headers authenticate while HTTP logs redact both credentials", async () => {
  const a = await canonicalPaid();
  const { BuyerJwtService } = await dist("modules/buyer-account/domain/services/buyer-jwt.service");
  const { AiUserIdentityService } = await dist("shared/http/ai-user-identity.service");
  const { RealtimeCapabilityService } = await dist("shared/auth/realtime-capability");
  const buyerToken = app.get(BuyerJwtService).sign({ globalUserId: a.account.globalUserId, email: a.account.email, merchantId: a.merchantId });
  const visitorToken = new AiUserIdentityService().resolve({merchantId:a.merchantId}).token;
  assert.ok(visitorToken);
  const origin = "http://localhost:3000";
  const capability = app.get(RealtimeCapabilityService).issue({purpose:"storefront-conversation",merchantId:a.merchantId,resourceId:a.sessionId,aiUserId:"buyer:"+a.account.globalUserId,origin});
  const before = httpLogs.length;
  const privateHeaders = {"x-buyer-authorization":"Bearer "+buyerToken,"x-ai-user-token":visitorToken};
  const portal = await originalFetch(base+"/v1/buyer/me/orders/"+a.merchantId+"/"+a.orderId+"/fiscal?environment=homologation",{headers:{authorization:"Bearer "+buyerToken,...privateHeaders}});
  assert.equal(portal.status,200);
  const notes = await portal.json();
  assert.equal(notes.items[0].authorizationProtocol,"151260029467289");
  assert.equal(notes.items[0].state,"authorized");
  const messagePath = "/v1/storefront/conversations/"+a.sessionId+"/messages";
  const response = await originalFetch(base+messagePath,{method:"POST",headers:{authorization:"Bearer "+capability.token,...privateHeaders,origin,"content-type":"application/json"},body:JSON.stringify({user_message:"Nota fiscal do pedido "+a.orderId})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.blocks.find((block:any)=>block.type==="fiscal_invoices").data.invoices[0].intentId,(await a.intent()).id);
  const observed = nativeLogRequests.filter(row => row.path === messagePath).at(-1);
  assert.ok(observed?.requestId, "the actual native assistant request has a server-generated request ID");
  const completedAssistant = () => httpLogs.slice(before).map(row => JSON.parse(row)).find(row =>
    row.requestId === observed.requestId && row.res?.statusCode === 201);
  for(let attempt=0;attempt<50 && !completedAssistant();attempt++) await new Promise(resolve=>setTimeout(resolve,10));
  const captured=httpLogs.slice(before).join("");
  assert.equal(captured.includes(buyerToken),false,"buyer credential must not enter actual HTTP logs");
  assert.equal(captured.includes(visitorToken),false,"visitor credential must not enter actual HTTP logs");
  if (process.env.FISCAL_CURRENT_LOG_DIAGNOSTIC === "1") {
    const observed = nativeLogRequests.filter(row => row.path === messagePath).at(-1);
    const events = captured.split("\n").filter(Boolean).map(row => JSON.parse(row));
    const event = events.find(row => (row.requestId === observed?.requestId || row.reqId === observed?.requestId)
      && row.res?.statusCode === response.status);
    process.stdout.write("# CURRENT_ASSISTANT_LOG_PROBE " + JSON.stringify({
      nativeRequestId: observed?.requestId, topLevelKeys: event ? Object.keys(event) : [],
      requestId: event?.requestId, reqId: event?.reqId, reqKeys: Object.keys(event?.req ?? {}), method: event?.req?.method,
      resKeys: Object.keys(event?.res ?? {}), statusCode: event?.res?.statusCode,
      matchesByRequestId: Boolean(event), buyerCredentialAbsent: !captured.includes(buyerToken), visitorCredentialAbsent: !captured.includes(visitorToken),
    }) + "\n");
  }
  const event=completedAssistant();
  assert.ok(event,"actual assistant request was logged");
  assert.equal(event.requestId,observed.requestId);
  assert.equal(event.reqId,observed.requestId);
  assert.deepEqual(event.req,{method:"POST"});
  assert.equal(event.req.headers,undefined);
  assert.equal(event.req.url,undefined);
  assert.deepEqual(event.res,{statusCode:201});
  assert.equal(event.res.statusCode,201);
  assert.equal(a.counts().pspCreate,1);
  assert.deepEqual(await a.snapshot(),a.originalSnapshot);
});

test("TINY-07 actual AppModule exposes Olist setup and consumes its durable notification through the registered runtime", async () => {
  const previousPublic = process.env.API_PUBLIC_URL, previousDashboard = process.env.DASHBOARD_URL;
  process.env.API_PUBLIC_URL = "https://callback.example.test"; process.env.DASHBOARD_URL = "https://dashboard.example.test";
  const logStart = httpLogs.length;
  try {
    const a = await actor();
    assert.equal((await a.request("GET", "/olist/oauth/configuration?environment=homologation")).status, 200);
    const start = await a.request("POST", "/olist/oauth/authorize", { environment: "homologation", issuerTaxId: "12ABC34501DE35", clientId: "actual-private-app", clientSecret: "actual-private-app-secret", stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon" });
    assert.equal(start.status, 201); const authorization = await start.json() as { state: string };
    assert.match(authorization.state, /^[A-Za-z0-9_-]{43}$/);
    const sale = await seedFiscalSale(f, { merchantId: a.merchantId, provider: "tiny" });
    await f.prisma.fiscalIntent.update({ where: { id: sale.intent.id }, data: { state: "processing" } });
    await f.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { credentialCipher: runtime.cipher.encrypt(JSON.stringify({ contract: "olist_oauth_v3", environment: sale.environment, issuerTaxId: sale.connection.issuerTaxId, token: "actual-local-access", refreshToken: "actual-local-refresh", expiresAt: new Date(Date.now() + 3600000).toISOString(), clientId: "actual-private-app", clientSecret: "actual-private-app-secret" })) } });
    const configured = await a.request("POST", "/olist/connection/" + sale.connection.id + "/notifications", { environment: "homologation" });
    assert.equal(configured.status, 201);
    const url = new URL((await configured.json() as { notificationUrl: string }).notificationUrl);
    const response = await originalFetch(base + url.pathname + url.search, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: "authorized", privateData: "not-trusted" }) });
    assert.equal(response.status, 200);
    const event = await f.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: a.merchantId, eventType: "fiscal.olist.notification.received" } });
    const { DOMAIN_EVENT_BUS } = await dist("shared/events/domain-event-bus.port");
    const handlers = app.get(DOMAIN_EVENT_BUS).handlersFor(event.eventType);
    assert.equal(handlers.length, 1);
    await handlers[0].handle({ eventType: event.eventType, merchantId: a.merchantId, payload: event.payload });
    const query = await f.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: a.merchantId, eventType: "fiscal.reconciliation.requested" } });
    assert.equal((query.payload as { intentId: string }).intentId, sale.intent.id);
    assert.equal((query.payload as { connectionId: string }).connectionId, sale.connection.id);
    assert.equal((query.payload as { provider: string }).provider, "tiny");
    assert.equal((await f.prisma.fiscalIntent.findUniqueOrThrow({ where: { id: sale.intent.id } })).state, "processing");
    assert.equal(httpLogs.slice(logStart).join("").includes(url.searchParams.get("key")!), false);
    assert.equal(httpLogs.slice(logStart).join("").includes("actual-private-app-secret"), false);
  } finally {
    if (previousPublic === undefined) delete process.env.API_PUBLIC_URL; else process.env.API_PUBLIC_URL = previousPublic;
    if (previousDashboard === undefined) delete process.env.DASHBOARD_URL; else process.env.DASHBOARD_URL = previousDashboard;
  }
});
