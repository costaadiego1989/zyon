import "reflect-metadata";
import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";
import { assertLegacySyntheticIdentity } from "./legacy-prisma-disposable-guards.mjs";
import { assertSyntheticRedisIdentity } from "./local-disposable-redis.mjs";
import { assertConstructionOnlyAmbient } from "./nest-construction-only.guards.mjs";
import { createOwnedJourneyClientTracker } from "./storefront-journey-owned-clients.mjs";
import { seedOwnedStorefrontJourney } from "./storefront-journey-bootstrap.seed.mjs";
import { createJourneyProviderModule } from "./storefront-journey-provider-module.mjs";
import { createCanonicalStorefrontJourneyBindings } from "./storefront-journey-canonical-bindings.mjs";
import { revalidateJourneyCapability } from "./storefront-journey-guards.mjs";
import { assertFreshJourneyRuntimeArtifacts } from "./storefront-journey-compiled-artifact.mjs";

const [databaseUrl, databaseRunId, redisUrl, redisRunId, tree, runId, merchantId, buyerId, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0); assert.equal(tree, "dist-test");
for (const value of [runId, merchantId, buyerId]) assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const database = assertNativePrismaUrl(databaseUrl);
assertSyntheticRedisIdentity(redisUrl, redisRunId, redisRunId);
assertConstructionOnlyAmbient(process.env);
assertFreshJourneyRuntimeArtifacts(); // catches drift between parent preflight/child
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const [{ PrismaClient }, { Redis }] = await Promise.all([import("@prisma/client"), import("ioredis")]);
const verifier = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
const redisVerifier = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 5000, commandTimeout: 5000 });
const phase = (stage, data = {}) => console.log("JOURNEY_BOOTSTRAP_STAGE " + JSON.stringify({ stage, ...data }));
const compiled = relative => import(new URL(`../${tree}/${relative}.js`, import.meta.url));
async function bounded(work, ms, code) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); }
  finally { clearTimeout(timer); }
}
let app, bindings, evidence, failure, stageName = "owned_resource_verification", apiOrigin, fenceInstalled = false, blockedProviderAttempts = 0;
let originalFetch, originalConnect;
const ownedPorts = new Set([Number(database.port), Number(new URL(redisUrl).port)]);
const networkCounts = { providerFetches: 0, unownedSockets: 0, ownedHttpRequests: 0 };
const secrets = []; let clientTracker;
const secret = () => { const value = randomBytes(48).toString("base64url"); secrets.push(value); return value; };
function safeError(error, depth = 0) {
  let message = String(error?.message ?? "unknown");
  for (const value of secrets) message = message.replaceAll(value, "[redacted]");
  message = message.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
  return { name: String(error?.name ?? "UnknownError"), message: message.slice(0, 2500),
    ...(error?.cause && depth < 2 ? { cause: safeError(error.cause, depth + 1) } : {}) };
}
function installZeroProviderFence() {
  originalFetch = globalThis.fetch; originalConnect = net.Socket.prototype.connect;
  globalThis.fetch = async (input, options) => {
    const target = new URL(input instanceof Request ? input.url : input);
    if (apiOrigin && target.origin === apiOrigin && !target.username && !target.password) {
      networkCounts.ownedHttpRequests++; return originalFetch(input, { ...options, redirect: "error" });
    }
    networkCounts.providerFetches++; throw Error("journey_bootstrap_provider_forbidden");
  };
  net.Socket.prototype.connect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args, first = normalized[0];
    const host = first && typeof first === "object" ? first.host ?? "127.0.0.1" : typeof normalized[1] === "string" ? normalized[1] : "127.0.0.1";
    const port = Number(first && typeof first === "object" ? first.port : first);
    if (!first?.path && host === "127.0.0.1" && ownedPorts.has(port)) return originalConnect.apply(this, args);
    networkCounts.unownedSockets++; throw Error("journey_bootstrap_unowned_socket_forbidden");
  };
  fenceInstalled = true;
}
async function captureRealClients({ ping = true, warmLazy = false } = {}) {
  clientTracker ??= createOwnedJourneyClientTracker(app, Number(new URL(redisUrl).port));
  return clientTracker.capture({ ping, warmLazy });
}
try {
  assertLegacySyntheticIdentity(databaseUrl, databaseRunId, await verifier.$queryRaw`SELECT current_database() AS database, run_id FROM synthetic_native_marker`);
  assert.ok(Number((await verifier.$queryRaw`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public'`)[0].count) > 100);
  await redisVerifier.connect();
  assertSyntheticRedisIdentity(redisUrl, redisRunId, await redisVerifier.get("aacp:synthetic:run"));
  stageName = "synthetic_canonical_seed";
  await seedOwnedStorefrontJourney(verifier, { runId, merchantId, buyerId });
  phase(stageName, { products: 2, realProviderCalls: 0 });
  process.env.DATABASE_URL = databaseUrl; process.env.REDIS_URL = redisUrl;
  for (const name of ["JWT_SECRET", "BUYER_JWT_SECRET", "EMBED_TOKEN_SECRET", "INTERNAL_SERVICE_TOKEN"]) process.env[name] = secret();
  for (const name of ["AACP_PAYMENT_ENC_KEY", "AACP_PII_ENC_KEY"]) { const value = randomBytes(32).toString("hex"); secrets.push(value); process.env[name] = value; }
  process.env.LOCAL_LLM_API_KEY = secret(); process.env.LOCAL_LLM_BASE_URL = "https://api.deepseek.com/v1"; process.env.LOCAL_LLM_MODEL = "deepseek-chat";
  process.env.LOG_LEVEL = "silent";
  installZeroProviderFence();
  const { NestFactory, Reflector } = await import("@nestjs/core"), { Module, ValidationPipe } = await import("@nestjs/common");
  const providerModule = await createJourneyProviderModule(tree);
  // Only the approved fetch token is wrapped for attempted-call observation;
  // it still rejects while unbound. No auth/repo/provider response is replaced.
  const providerDefinition = Reflect.getMetadata("providers", providerModule.module)[0], factory = providerDefinition.useValue;
  providerDefinition.useValue = channel => { const guarded = factory(channel); return async (...args) => { blockedProviderAttempts++; return guarded(...args); }; };
  const { AppModule } = await compiled("app.module");
  class JourneyBootstrapRoot {}
  Module({ imports: [providerModule.module, AppModule] })(JourneyBootstrapRoot);
  stageName = "real_nest_construction"; phase(stageName);
  app = await bounded(NestFactory.create(JourneyBootstrapRoot, { abortOnError: false, logger: false, rawBody: true, bodyParser: true }), 45_000, "journey_nest_construction_timeout");
  const { apiVersioningMiddleware } = await compiled("shared/http/api-versioning");
  const { RequestTimeoutInterceptor } = await compiled("shared/http/request-timeout.interceptor");
  app.use(apiVersioningMiddleware);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new RequestTimeoutInterceptor(app.get(Reflector)));
  stageName = "real_lifecycle_init"; phase(stageName);
  await bounded(app.init(), 45_000, "journey_app_init_timeout");
  stageName = "real_loopback_listen";
  await bounded(app.listen(0, "127.0.0.1"), 10_000, "journey_loopback_listen_timeout");
  const listener = app.getHttpServer(), address = listener.address();
  assert.ok(address && address.address === "127.0.0.1" && address.port > 1024 && !ownedPorts.has(address.port));
  apiOrigin = `http://127.0.0.1:${address.port}`; ownedPorts.add(address.port);
  phase(stageName, { literalLoopback: true });
  stageName = "owned_clients_before_http";
  const ownedClients = await captureRealClients({ warmLazy: true });
  phase(stageName, ownedClients);
  const { BuyerJwtService } = await compiled("modules/buyer-account/domain/services/buyer-jwt.service");
  const { RealtimeCapabilityService } = await compiled("shared/auth/realtime-capability");
  const buyerJwt = app.get(BuyerJwtService, { strict: false }), capabilities = app.get(RealtimeCapabilityService, { strict: false });
  const buyerToken = buyerJwt.sign({ globalUserId: buyerId, merchantId, email: `journey.${runId}@example.invalid` }); secrets.push(buyerToken);
  stageName = "real_http_conversation";
  const response = await fetch(`${apiOrigin}/v1/storefront/conversations`, { method: "POST", headers: { origin: apiOrigin, "content-type": "application/json" },
    body: JSON.stringify({ merchant_id: merchantId, buyer_access_token: buyerToken }), signal: AbortSignal.timeout(10_000) });
  if (response.status !== 201) {
    const body = await response.clone().json().catch(() => ({}));
    const code = ["rate_limit_unavailable", "ai_rate_limit_unavailable", "ai_interaction_rate_limited", "rate_limited"].includes(body?.code) ? body.code : "unrecognized_http_error";
    throw Error(`canonical_conversation_creation_failed:${response.status}:${code}`);
  }
  const conversation = await response.json();
  assert.match(conversation.conversation_id, /^conv_[a-f0-9-]{36}$/); assert.equal(conversation.merchant_id, merchantId);
  assert.equal(typeof conversation.conversation_token, "string"); secrets.push(conversation.conversation_token);
  const claims = capabilities.verify(conversation.conversation_token, "storefront-conversation", apiOrigin);
  assert.equal(claims.aiUserId, `buyer:${buyerId}`); assert.equal(claims.resourceId, conversation.conversation_id);
  const manifest = { version: 1, runId, apiOrigin, merchantId, buyerId, sessionId: conversation.conversation_id,
    postgresRunId: databaseRunId, redisRunId, postgresPort: Number(database.port), redisPort: Number(new URL(redisUrl).port) };
  const binding = { runId, merchantId, buyerId, sessionId: manifest.sessionId, apiOrigin, postgresRunId: databaseRunId, redisRunId };
  await verifier.$executeRaw`INSERT INTO synthetic_storefront_journey_binding (run_id,merchant_id,buyer_id,session_id,api_origin,postgres_run_id,redis_run_id)
    VALUES (${runId},${merchantId},${buyerId},${manifest.sessionId},${apiOrigin},${databaseRunId},${redisRunId})`;
  await redisVerifier.set(`aacp:synthetic:journey:${runId}`, JSON.stringify(binding));
  stageName = "canonical_sql_redis_principal_binding";
  bindings = await createCanonicalStorefrontJourneyBindings({ manifest, databaseUrl, redisUrl, artifactTree: tree,
    buyerJwt, capabilities, listener, buyerToken, conversationToken: conversation.conversation_token });
  await revalidateJourneyCapability(bindings.capability);
  assert.equal(networkCounts.providerFetches + networkCounts.unownedSockets + blockedProviderAttempts, 0, "bootstrap_must_not_attempt_any_provider");
  evidence = { canonicalAppModule: true, lifecycleInit: true, httpListen: true, realCanonicalPrincipal: true,
    actualSqlRedisBindings: true, repositoryOverrides: false, authOverrides: false, providerFetchTokenOnly: true,
    providerCalls: 0, paidJourneyValidated: false, actualPspValidated: false, ownedClients };
  phase(stageName, { verified: true, providerCalls: 0 });
} catch (error) { failure = error; }
finally {
  const cleanup = []; let manualDisconnects = 0, harnessQuit = 0;
  if (bindings) try { await bindings.dispose(); } catch (error) { cleanup.push(error); }
  if (app) {
    try { await captureRealClients({ ping: false }); } catch (error) { cleanup.push(error); }
    try { phase("closing_real_app"); await bounded(app.close(), 25_000, "journey_real_app_close_timeout"); } catch (error) { cleanup.push(error); }
    if (clientTracker) try {
      const closed = await clientTracker.close(); manualDisconnects = closed.manualDisconnects; harnessQuit = closed.harnessRedisQuits;
    } catch (error) { cleanup.push(error); }
  }
  try { await bounded(verifier.$disconnect(), 5000, "journey_seed_verifier_cleanup_timeout"); } catch (error) { cleanup.push(error); }
  try { if (redisVerifier.status === "ready") await bounded(redisVerifier.quit(), 5000, "journey_seed_redis_cleanup_timeout"); } catch (error) { cleanup.push(error); }
  redisVerifier.disconnect();
  const providerCalls = networkCounts.providerFetches + networkCounts.unownedSockets + blockedProviderAttempts;
  if (providerCalls !== 0) cleanup.push(Error("journey_bootstrap_provider_attempt_including_cleanup_forbidden"));
  if (fenceInstalled) { globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; }
  if (cleanup.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanup], "journey_bootstrap_cleanup_failed");
  if (evidence) Object.assign(evidence, { providerCalls, appClosed: !failure, cleanupHarnessRequired: harnessQuit + manualDisconnects > 0,
    harnessRedisQuits: harnessQuit, manualRedisDisconnects: manualDisconnects, runtimeShutdownValidated: false });
}
if (failure) {
  console.log("JOURNEY_BOOTSTRAP_FAILURE " + JSON.stringify({ stage: stageName, failure: safeError(failure),
    ...(failure instanceof AggregateError ? { errors: failure.errors.slice(0, 5).map(error => safeError(error)) } : {}),
    providerCalls: networkCounts.providerFetches + networkCounts.unownedSockets + blockedProviderAttempts,
    activeResources: process.getActiveResourcesInfo() }));
  process.exitCode = 1;
} else console.log("JOURNEY_BOOTSTRAP_RESULT " + JSON.stringify(evidence));
