import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";
import { assertLegacySyntheticIdentity } from "./legacy-prisma-disposable-guards.mjs";
import { assertSyntheticRedisIdentity } from "./local-disposable-redis.mjs";
import { assertConstructionOnlyAmbient, awaitConstructionRedisReady, closeConstructionRedis, createConstructionRedisSocketProof, constructionOnlyArtifactEntries } from "./nest-construction-only.guards.mjs";
import { installConstructionProviderTrap } from "./nest-construction-provider-trap.mjs";

const [databaseUrl, databaseRunId, redisUrl, redisRunId, artifactTree, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, "exact_construction_worker_arguments_required");
constructionOnlyArtifactEntries(artifactTree);
assertNativePrismaUrl(databaseUrl);
assertSyntheticRedisIdentity(redisUrl, redisRunId, redisRunId);
assertConstructionOnlyAmbient(process.env);
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const verifier = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
try {
  assertLegacySyntheticIdentity(databaseUrl, databaseRunId,
    await verifier.$queryRaw`SELECT current_database() AS database, run_id FROM synthetic_native_marker`);
  const tables = await verifier.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  assert.deepEqual(tables, [{ table_name: "synthetic_native_marker" }], "marker_only_database_required_no_business_fixtures");
} finally { await verifier.$disconnect(); }
const { Redis } = await import("ioredis");
const redisVerifier = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null,
  connectTimeout: 5000, commandTimeout: 5000 });
try {
  await redisVerifier.connect();
  assertSyntheticRedisIdentity(redisUrl, redisRunId, await redisVerifier.get("aacp:synthetic:run"));
} finally { redisVerifier.disconnect(); }

// Only verified run-owned URLs and freshly generated test material enter the
// real factories. No dotenv or arbitrary module/artifact path is accepted.
process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;
process.env.JWT_SECRET = randomBytes(48).toString("base64url");
const compiled = path => import(new URL(`../${artifactTree}/${path}.js`, import.meta.url));
const { NestFactory } = await import("@nestjs/core");
let app, rawRedis, failure, evidence, providerTrap, queueReadiness;
const diagnosticClients = [];
const redisSocketProof = createConstructionRedisSocketProof(Number(new URL(redisUrl).port));
function clientSocket(client) {
  const connector = Object.getOwnPropertyDescriptor(client, "connector")?.value;
  return connector && Object.getOwnPropertyDescriptor(connector, "stream")?.value;
}
const phase = (stage, fields = {}) => console.log("NEST_CONSTRUCTION_STAGE " + JSON.stringify({ stage, ...fields }));
async function bounded(work, deadlineMs, code) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), deadlineMs); })]); }
  finally { clearTimeout(timer); }
}
async function awaitOwnedConstructedQueues(application) {
  const [{ ModulesContainer }, { Queue }] = await Promise.all([import("@nestjs/core"), import("bullmq")]);
  const queues = new Map(), redisClients = new Map();
  for (const module of application.get(ModulesContainer).values()) {
    for (const wrapper of module.providers.values()) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== "object") continue;
      if (instance instanceof Queue) queues.set(instance, instance.constructor.name);
      if (instance instanceof Redis) redisClients.set(instance, instance.constructor.name);
      for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(instance))) {
        if (!("value" in descriptor)) continue; // never execute an arbitrary getter
        const value = descriptor.value;
        if (value instanceof Queue) queues.set(value, `${instance.constructor.name}.${field}`);
        if (value instanceof Redis) redisClients.set(value, `${instance.constructor.name}.${field}`);
      }
    }
  }
  const owners = await Promise.all([...queues].map(async ([queue, owner]) => {
    try {
      const client = await bounded(queue.waitUntilReady(), 10_000, "construction_queue_ready_timeout");
      assert.equal(client.options.host, "127.0.0.1"); assert.equal(client.options.port, Number(new URL(redisUrl).port));
      assert.equal(await bounded(client.ping(), 5000, "construction_queue_ping_timeout"), "PONG");
      assert.equal(client.status, "ready");
      diagnosticClients.push({ owner, client });
      return owner;
    } catch (error) { throw new Error(`construction_queue_ready_failed:${owner}`, { cause: error }); }
  }));
  const connectingClients = [...redisClients].filter(([client]) => client.status !== "wait" && client.status !== "end");
  for (const [client, owner] of redisClients) diagnosticClients.push({ owner, client });
  const readyClients = await Promise.all(connectingClients.map(async ([client, owner]) => {
    try {
      assert.equal(client.options.host, "127.0.0.1"); assert.equal(client.options.port, Number(new URL(redisUrl).port));
      await awaitConstructionRedisReady(client);
      assert.equal(await bounded(client.ping(), 5000, "construction_owned_redis_ping_timeout"), "PONG");
      return owner;
    } catch (error) { throw new Error(`construction_redis_ready_failed:${owner}`, { cause: error }); }
  }));
  const socketCapture = await redisSocketProof.captureAll([...new Set(diagnosticClients.map(({ client }) => client))]
    .filter(client => client.status !== "wait" && client.status !== "end")
    .map(client => ({ owner: client, socket: clientSocket(client) })));
  return { count: owners.length, owners, redisClients: redisClients.size, connectingClientsReady: readyClients.length, ...socketCapture,
    redisOwners: readyClients, lazyClientsUntouched: redisClients.size - readyClients.length, allReady: true };
}
try {
  phase("ownership_verified");
  providerTrap = await installConstructionProviderTrap(Number(new URL(databaseUrl).port), Number(new URL(redisUrl).port));
  process.env.LOCAL_LLM_API_KEY = "synthetic-construction-" + randomBytes(24).toString("hex");
  process.env.LOCAL_LLM_BASE_URL = providerTrap.baseUrl;
  process.env.LOCAL_LLM_MODEL = "deepseek-chat";
  const { AppModule } = await compiled("app.module");
  phase("constructing");
  app = await NestFactory.create(AppModule, { abortOnError: false, logger: false });
  phase("constructed");
  // Queue constructors open real Redis connections before lifecycle init. Wait
  // only for these existing clients' handshake/round trip, never start workers.
  queueReadiness = await awaitOwnedConstructedQueues(app);
  phase("clients_ready", { queues: queueReadiness.count, redisClients: queueReadiness.redisClients, readyRedisClients: queueReadiness.connectingClientsReady });
  const [{ PaymentModule }, { CheckoutModule }, { NotificationsModule },
    { PAYMENT_REPOSITORY }, { CHECKOUT_REPOSITORY }, { CHECKOUT_SESSION_REPOSITORY },
    { PrismaPaymentRepository }, { PrismaCheckoutRepository }, { ORDER_QUOTA_NOTICE_VALIDITY },
    { OrderQuotaNoticeValidityService }, { OrderQuotaService }, { REDIS_CLIENT_TOKEN }, { RecoveryScannerJob }] = await Promise.all([
    compiled("modules/payment/payment.module"), compiled("modules/checkout/checkout.module"), compiled("modules/notifications/notifications.module"),
    compiled("modules/payment/domain/ports/payment-repository.port"), compiled("modules/checkout/domain/ports/checkout-repository.port"),
    compiled("modules/checkout/domain/ports/checkout-session.repository.port"), compiled("modules/payment/infrastructure/prisma-payment.repository"),
    compiled("modules/checkout/infrastructure/prisma/prisma-checkout.repository"), compiled("modules/notifications/domain/ports/order-quota-notice.port"),
    compiled("modules/notifications/application/services/order-quota-notice-validity.service"), compiled("modules/payment/application/services/order-quota.service"),
    compiled("shared/cache/redis.module"), compiled("modules/cart-recovery/infrastructure/jobs/recovery-scanner.job"),
  ]);
  rawRedis = app.get(REDIS_CLIENT_TOKEN, { strict: false });
  const payment = app.select(PaymentModule), checkout = app.select(CheckoutModule), notifications = app.select(NotificationsModule);
  assert.ok(payment.get(PAYMENT_REPOSITORY, { strict: true }) instanceof PrismaPaymentRepository);
  const repository = checkout.get(CHECKOUT_REPOSITORY, { strict: true });
  assert.ok(repository instanceof PrismaCheckoutRepository);
  assert.equal(checkout.get(CHECKOUT_SESSION_REPOSITORY, { strict: true }), repository);
  const validity = notifications.get(ORDER_QUOTA_NOTICE_VALIDITY, { strict: true });
  assert.ok(validity instanceof OrderQuotaNoticeValidityService);
  assert.equal(Reflect.get(validity, "quotas"), payment.get(OrderQuotaService, { strict: true }));
  assert.equal(Reflect.get(app, "isInitialized"), false);
  assert.equal(app.getHttpServer().listening, false);
  const recovery = app.get(RecoveryScannerJob, { strict: false });
  assert.equal(Reflect.get(recovery, "initialHandle"), null);
  assert.equal(Reflect.get(recovery, "intervalHandle"), null);
  assert.equal(providerTrap.evidence().providerCalls, 0, "construction_must_not_call_any_provider");
  evidence = { constructionOnly: true, artifactTree, canonicalAppModule: true, repositoryInstances: "real", quotaDependency: "resolved",
    lifecycleInit: false, httpListen: false, providerOverrides: false, providerValidation: false,
    databaseFixture: "owned_marker_only", externalNetwork: "owned_data_ports_only", syntheticProviderConfig: true,
    ownedQueuesReady: queueReadiness.count, ownedRedisClientsReady: queueReadiness.connectingClientsReady,
    nativeTcpCorroborations: queueReadiness.nativeTcpCorroborations,
    lazyRedisClientsUntouched: queueReadiness.lazyClientsUntouched };
} catch (error) { failure = error; }
finally {
  const cleanup = [];
  if (app) {
    try {
      // Cache's raw Redis factory has no Nest lifecycle hook; retrieve its exact
      // owned instance even when a later construction assertion failed.
      rawRedis ??= app.get((await compiled("shared/cache/redis.module")).REDIS_CLIENT_TOKEN, { strict: false });
      if (rawRedis) {
        await awaitConstructionRedisReady(rawRedis);
        await redisSocketProof.captureAll([{ owner: rawRedis, socket: clientSocket(rawRedis) }]);
      }
    } catch (error) { cleanup.push(error); }
    try { phase("closing_app"); await bounded(app.close(), 15_000, "construction_app_close_timeout"); phase("app_closed"); }
    catch (error) { cleanup.push(new Error("construction_app_close_failed", { cause: error })); }
  }
  if (rawRedis) {
    try { if (rawRedis.status !== "end") await bounded(rawRedis.quit(), 5000, "construction_raw_redis_close_timeout"); phase("raw_redis_closed"); }
    catch (error) { rawRedis.disconnect(); cleanup.push(new Error("construction_raw_redis_close_failed", { cause: error })); }
  }
  if (app) {
    try {
      const clients = new Map(diagnosticClients.map(({ client, owner }) => [client, owner]));
      if (rawRedis) clients.set(rawRedis, "REDIS_CLIENT_TOKEN");
      let nestStatusEnded = 0, nestPhysicallyClosed = 0, harnessQuit = 0, harnessDisconnects = 0, lazyUntouched = 0;
      await Promise.all([...clients].map(async ([client, owner]) => {
        assert.equal(client.options.host, "127.0.0.1");
        assert.equal(client.options.port, Number(new URL(redisUrl).port));
        if (client.status === "wait") { lazyUntouched++; return; }
        const stream = clientSocket(client);
        if (client.status === "end") nestStatusEnded++; else harnessQuit++;
        if (stream) {
          redisSocketProof.assertCaptured(client, stream);
          if (stream.closed) nestPhysicallyClosed++;
        }
        try {
          const closed = await closeConstructionRedis(client, stream);
          if (closed.manualDisconnect) harnessDisconnects++;
        }
        catch (error) {
          phase("owned_client_close_failed", { owner, status: client.status, streamType: stream?.constructor?.name ?? null,
            streamClosed: stream?.closed ?? null, streamDestroyed: stream?.destroyed ?? null,
            readableEnded: stream?.readableEnded ?? null, writableEnded: stream?.writableEnded ?? null });
          throw error;
        }
      }));
      phase("owned_clients_closed", { nestStatusEnded, nestPhysicallyClosed, harnessQuit, harnessDisconnects, lazyUntouched });
      if (evidence) evidence.redisCleanup = { nestStatusEnded, nestPhysicallyClosed, harnessQuit, harnessDisconnects,
        lazyUntouched, physicalCloseAwaited: true, cleanupHarnessRequired: harnessQuit + harnessDisconnects > 0,
        runtimeShutdownValidated: false };
    } catch (error) { cleanup.push(new Error("construction_captured_redis_close_failed", { cause: error })); }
  }
  if (providerTrap) {
    try {
      const counts = providerTrap.evidence();
      assert.equal(counts.providerCalls, 0, "construction_must_not_call_any_provider_including_shutdown");
      if (evidence) Object.assign(evidence, counts);
    } catch (error) { cleanup.push(error); }
    try { await bounded(providerTrap.dispose(), 5000, "construction_provider_sentinel_close_timeout"); phase("provider_sentinel_closed"); }
    catch (error) { cleanup.push(error); }
  }
  if (cleanup.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanup], "construction_cleanup_failed");
}
if (failure) {
  const details = (error, depth = 0) => ({ name: error?.name ?? "UnknownError", message: String(error?.message ?? "unknown").slice(0, 3000),
    stack: typeof error?.stack === "string" ? error.stack.split("\n").slice(1, 6) : [],
    ...(depth < 3 && error?.cause ? { cause: details(error.cause, depth + 1) } : {}),
    ...(depth < 2 && error instanceof AggregateError ? { errors: [...error.errors].slice(0, 8).map(value => details(value, depth + 1)) } : {}) });
  console.error("NEST_CONSTRUCTION_FAILURE " + JSON.stringify({ constructionOnly: true, failed: true, error: failure.name,
    constructionReached: Boolean(app), providerCalls: providerTrap?.evidence().providerCalls ?? null,
    queueReadiness,
    details: details(failure) }));
  process.exitCode = 1;
} else {
  console.log("NEST_CONSTRUCTION_RESULT " + JSON.stringify({ ...evidence, appClosed: true, rawRedisClosed: true }));
  const diagnostic = setTimeout(() => phase("unexpected_remaining_resources", { resources: process.getActiveResourcesInfo(),
    clients: diagnosticClients.map(({ owner, client }) => ({ owner, status: client.status })) }), 5000);
  diagnostic.unref(); // never keeps a successful child alive or turns failure green
}
