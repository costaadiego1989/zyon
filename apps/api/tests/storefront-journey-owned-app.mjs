import "reflect-metadata";
import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";
import { assertLegacySyntheticIdentity } from "./legacy-prisma-disposable-guards.mjs";
import { assertSyntheticRedisIdentity } from "./local-disposable-redis.mjs";
import { assertConstructionOnlyAmbient } from "./nest-construction-only.guards.mjs";
import { assertFreshJourneyRuntimeArtifacts } from "./storefront-journey-compiled-artifact.mjs";
import { emitJourneyLifecycle } from "./storefront-journey-lifecycle.mjs";
import { seedOwnedCommerceJourney } from "./storefront-journey-commerce.seed.mjs";
import { createJourneyProviderModule } from "./storefront-journey-provider-module.mjs";
import { createCanonicalStorefrontJourneyBindings } from "./storefront-journey-canonical-bindings.mjs";
import { revalidateJourneyCapability } from "./storefront-journey-guards.mjs";
import { installStorefrontJourneyEgress } from "./storefront-journey-egress.mjs";
import { createOriginalApprovedJourneyBudget, inspectOriginalJourneyBudget } from "./storefront-journey-original-budget.mjs";
import { createJourneyHttpOperations } from "./storefront-journey-http-operations.mjs";
import { SANDBOX_LLM_APPROVAL, sandboxLlmApprovalForId } from "./storefront-sandbox-llm-budget.mjs";
import { createOwnedJourneyClientTracker, journeyBounded as bounded } from "./storefront-journey-owned-clients.mjs";

const inputSchema = z.strictObject({ databaseUrl: z.string(), databaseRunId: z.uuidv4(), redisUrl: z.string(), redisRunId: z.uuidv4(),
  tree: z.literal("dist-test"), runId: z.uuidv4(), merchantId: z.uuidv4(), buyerId: z.uuidv4(),
  phase: z.enum(["commerce-no-provider", "approved-llm"]), receiveProviderKey: z.custom(value => typeof value === "function").optional() });

/** Shared test-only real AppModule lifecycle. No main.ts/dotenv, fake auth,
 * repository override, E2E payment provider or response stub. The existing
 * bootstrap-only worker/flags are intentionally unaffected. */
export async function createOwnedStorefrontJourneyApp(rawInput) {
  const parsed = inputSchema.safeParse(rawInput);
  assert.ok(parsed.success, "journey_owned_app_inputs_invalid");
  const input = Object.freeze({ ...parsed.data }), { databaseUrl, databaseRunId, redisUrl, redisRunId, tree, runId, merchantId, buyerId, phase } = input;
  assert.equal(typeof input.receiveProviderKey === "function", phase === "approved-llm", "journey_phase_private_key_channel_mismatch");
  assertConstructionOnlyAmbient(process.env); assertFreshJourneyRuntimeArtifacts();
  const database = assertNativePrismaUrl(databaseUrl);
  assertSyntheticRedisIdentity(redisUrl, redisRunId, redisRunId);
  inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
  const ownedPorts = new Set([Number(database.port), Number(new URL(redisUrl).port)]);
  const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect;
  let app, prisma, redis, bindings, tracker, providerModule, listener, apiOrigin, bridge, egress, llm, closed = false, initialFence = true;
  let providerFactoryAttempts = 0, providerTransportBound = false, initialized = false, cleanupEvidence;
  const counts = { forbiddenFetches: 0, forbiddenSockets: 0, ownedHttpRequests: 0 };
  const assignedEnvironment = [], secret = () => randomBytes(48).toString("base64url");
  const assign = (name, value) => { assert.equal(process.env[name], undefined, "journey_no_ambient_secret_override"); assignedEnvironment.push(name); process.env[name] = value; };
  const compiled = path => import(new URL(`../${tree}/${path}.js`, import.meta.url));
  const earlyFetch = async (value, options) => {
    const target = new URL(value instanceof Request ? value.url : value);
    if (apiOrigin && target.origin === apiOrigin && !target.username && !target.password) { counts.ownedHttpRequests++; return originalFetch(value, { ...options, redirect: "error" }); }
    counts.forbiddenFetches++; throw Error("journey_unbound_external_fetch_forbidden");
  };
  const earlyConnect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args, first = normalized[0];
    const host = first && typeof first === "object" ? first.host ?? "127.0.0.1" : typeof normalized[1] === "string" ? normalized[1] : "127.0.0.1";
    const port = Number(first && typeof first === "object" ? first.port : first);
    if (!first?.path && host === "127.0.0.1" && ownedPorts.has(port)) return originalConnect.apply(this, args);
    counts.forbiddenSockets++; throw Error("journey_unbound_external_socket_forbidden");
  };
  globalThis.fetch = earlyFetch; net.Socket.prototype.connect = earlyConnect;
  function evidence() {
    return { canonicalAppModule: Boolean(app), lifecycleInit: initialized, httpListen: Boolean(listener?.listening),
      realCanonicalPrincipal: Boolean(bindings), actualSqlRedisBindings: Boolean(bindings), repositoryOverrides: false, authOverrides: false,
      providerFactoryAttempts, ...counts, ...(egress ? { egress: egress.evidence() } : {}),
      actualPspValidated: false, deployedSandboxValidated: false, ...(cleanupEvidence ?? {}) };
  }
  async function close() {
    if (closed) return cleanupEvidence; closed = true;
    const errors = [], attemptsBeforeClose = providerFactoryAttempts;
    const step = async (stage, work) => {
      emitJourneyLifecycle(stage, "start");
      try { const value = await work(); emitJourneyLifecycle(stage, "completed"); return value; }
      catch (error) { emitJourneyLifecycle(stage, "failed"); errors.push(error); }
    };
    if (bridge) await step("bridge_dispose", () => bridge.dispose());
    if (bindings) await step("bindings_dispose", () => bindings.dispose());
    if (tracker) await step("redis_capture", () => tracker.capture({ ping: false }));
    if (app) await step("app_close", () => bounded(app.close(), 25_000, "journey_owned_app_close_timeout"));
    if (tracker) { const value = await step("redis_close", () => tracker.close()); if (value) cleanupEvidence = value; }
    if (prisma) await step("prisma_close", () => bounded(prisma.$disconnect(), 5000, "journey_owned_prisma_close_timeout"));
    if (redis) {
      await step("verifier_close", () => redis.status === "ready" ? bounded(redis.quit(), 5000, "journey_owned_verifier_redis_close_timeout") : undefined);
      redis.disconnect();
    }
    if (providerFactoryAttempts !== attemptsBeforeClose || counts.forbiddenFetches || counts.forbiddenSockets)
      errors.push(Error("journey_uncontrolled_or_cleanup_provider_attempt"));
    if (phase === "commerce-no-provider" && providerFactoryAttempts !== 0) errors.push(Error("journey_commerce_must_not_attempt_provider"));
    if (egress) {
      const observed = egress.evidence();
      if (observed.deniedFetches || observed.deniedSockets) errors.push(Error("journey_approved_egress_violation"));
      try {
        egress.dispose();
        assert.ok(globalThis.fetch === earlyFetch && net.Socket.prototype.connect === earlyConnect, "journey_early_fence_restore_identity_required");
        globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect;
      } catch (error) { errors.push(error); }
    } else if (initialFence) {
      if (globalThis.fetch !== earlyFetch || net.Socket.prototype.connect !== earlyConnect) errors.push(Error("journey_early_fence_cleanup_conflict"));
      else { globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; }
    }
    for (const name of assignedEnvironment) delete process.env[name];
    cleanupEvidence = { ...cleanupEvidence, appClosed: errors.length === 0, runtimeShutdownValidated: false };
    if (errors.length) throw new AggregateError(errors, "journey_owned_app_cleanup_failed");
    return cleanupEvidence;
  }
  try {
    const [{ PrismaClient }, { Redis }] = await Promise.all([import("@prisma/client"), import("ioredis")]);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
    redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 5000, commandTimeout: 5000 });
    assertLegacySyntheticIdentity(databaseUrl, databaseRunId, await prisma.$queryRaw`SELECT current_database() AS database, run_id FROM synthetic_native_marker`);
    assert.ok(Number((await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public'`)[0].count) > 100, "journey_full_canonical_schema_required");
    await redis.connect(); assertSyntheticRedisIdentity(redisUrl, redisRunId, await redis.get("aacp:synthetic:run"));
    // Marker evidence precedes ANY request for private provider material.
    const providerKey = phase === "approved-llm" ? await input.receiveProviderKey() : secret();
    assert.ok(typeof providerKey === "string" && providerKey.length >= 16 && providerKey.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(providerKey), "journey_private_provider_key_invalid");
    const seed = await seedOwnedCommerceJourney(prisma, { runId, merchantId, buyerId });
    assign("DATABASE_URL", databaseUrl); assign("REDIS_URL", redisUrl);
    for (const name of ["JWT_SECRET", "BUYER_JWT_SECRET", "EMBED_TOKEN_SECRET", "INTERNAL_SERVICE_TOKEN"]) assign(name, secret());
    for (const name of ["AACP_PAYMENT_ENC_KEY", "AACP_PII_ENC_KEY"]) assign(name, randomBytes(32).toString("hex"));
    assign("LOCAL_LLM_API_KEY", providerKey); assign("LOCAL_LLM_BASE_URL", "https://api.deepseek.com/v1"); assign("LOCAL_LLM_MODEL", "deepseek-chat"); assign("LOG_LEVEL", "silent");
    const { NestFactory, Reflector } = await import("@nestjs/core"), { Module, ValidationPipe } = await import("@nestjs/common");
    providerModule = await createJourneyProviderModule(tree);
    const definition = Reflect.getMetadata("providers", providerModule.module)[0], factory = definition.useValue;
    definition.useValue = channel => { const fetch = factory(channel); return async (...args) => { providerFactoryAttempts++; return fetch(...args); }; };
    const { AppModule } = await compiled("app.module");
    class OwnedJourneyRoot {}
    Module({ imports: [providerModule.module, AppModule] })(OwnedJourneyRoot);
    app = await bounded(NestFactory.create(OwnedJourneyRoot, { abortOnError: false, logger: false, rawBody: true, bodyParser: true }), 45_000, "journey_owned_nest_construction_timeout");
    tracker = createOwnedJourneyClientTracker(app, Number(new URL(redisUrl).port));
    const { apiVersioningMiddleware } = await compiled("shared/http/api-versioning");
    const { RequestTimeoutInterceptor } = await compiled("shared/http/request-timeout.interceptor");
    app.use(apiVersioningMiddleware);
    // Registered before init/router. A later private binding changes only this
    // closed-over delegate, never the production auth/controller providers.
    app.use((request, response, next) => {
      if (bridge) { bridge.middleware(request, response, next); return; }
      const path = request.originalUrl ?? request.url;
      if (path?.startsWith("/v1/storefront/conversations/") && path.endsWith("/messages")) {
        response.status(403).json({ code: "journey_verified_transport_not_bound" }); return;
      }
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new RequestTimeoutInterceptor(app.get(Reflector)));
    await bounded(app.init(), 45_000, "journey_owned_app_init_timeout"); initialized = true;
    await bounded(app.listen(0, "127.0.0.1"), 10_000, "journey_owned_app_listen_timeout");
    listener = app.getHttpServer(); const address = listener.address();
    assert.ok(address && address.address === "127.0.0.1" && address.port > 1024 && !ownedPorts.has(address.port));
    apiOrigin = `http://127.0.0.1:${address.port}`; ownedPorts.add(address.port);
    // Warm real lazy quota clients only after owned markers/options validate.
    // No request replay, changed production timeout, quota/auth bypass or mock.
    const ownedClients = await tracker.capture({ warmLazy: true });
    const { BuyerJwtService } = await compiled("modules/buyer-account/domain/services/buyer-jwt.service");
    const { RealtimeCapabilityService } = await compiled("shared/auth/realtime-capability");
    const buyerJwt = app.get(BuyerJwtService, { strict: false }), capabilities = app.get(RealtimeCapabilityService, { strict: false });
    const buyerToken = buyerJwt.sign({ globalUserId: buyerId, merchantId, email: seed.customer.email });
    const response = await fetch(`${apiOrigin}/v1/storefront/conversations`, { method: "POST", headers: { origin: apiOrigin, "content-type": "application/json" },
      body: JSON.stringify({ merchant_id: merchantId, buyer_access_token: buyerToken }), signal: AbortSignal.timeout(10_000) });
    if (response.status !== 201) {
      const body = await response.clone().json().catch(() => ({}));
      const code = ["rate_limit_unavailable", "ai_rate_limit_unavailable", "ai_interaction_rate_limited", "rate_limited"].includes(body?.code) ? body.code : "unrecognized_http_error";
      throw Error(`journey_real_conversation_creation_failed:${response.status}:${code}`);
    }
    const conversation = await response.json(), conversationToken = conversation.conversation_token;
    const claims = capabilities.verify(conversationToken, "storefront-conversation", apiOrigin);
    assert.equal(claims.aiUserId, `buyer:${buyerId}`); assert.equal(claims.resourceId, conversation.conversation_id); assert.equal(conversation.merchant_id, merchantId);
    const manifest = { version: 1, runId, apiOrigin, merchantId, buyerId, sessionId: conversation.conversation_id,
      postgresRunId: databaseRunId, redisRunId, postgresPort: Number(database.port), redisPort: Number(new URL(redisUrl).port) };
    const binding = { runId, merchantId, buyerId, sessionId: manifest.sessionId, apiOrigin, postgresRunId: databaseRunId, redisRunId };
    await prisma.$executeRaw`INSERT INTO synthetic_storefront_journey_binding (run_id,merchant_id,buyer_id,session_id,api_origin,postgres_run_id,redis_run_id)
      VALUES (${runId},${merchantId},${buyerId},${manifest.sessionId},${apiOrigin},${databaseRunId},${redisRunId})`;
    await redis.set(`aacp:synthetic:journey:${runId}`, JSON.stringify(binding));
    bindings = await createCanonicalStorefrontJourneyBindings({ manifest, databaseUrl, redisUrl, artifactTree: tree,
      buyerJwt, capabilities, listener, buyerToken, conversationToken });
    await revalidateJourneyCapability(bindings.capability);
    assert.equal(providerFactoryAttempts + counts.forbiddenFetches + counts.forbiddenSockets, 0, "journey_bootstrap_must_be_zero_provider");
    return Object.freeze({ app, prisma, redis, apiOrigin, listener, buyerJwt, capabilities, buyerToken, conversationToken, conversation,
      capability: bindings.capability, merchantId, buyerId, runId, seed, internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN,
      evidence: () => ({ ...evidence(), ownedClients }), close,
      async enableApprovedLlm({ record, expectedConsumedCalls, approvalId = SANDBOX_LLM_APPROVAL.approvalId }) {
        assert.equal(closed, false); assert.equal(phase, "approved-llm", "journey_paid_phase_required");
        assert.equal(providerTransportBound, false, "journey_llm_binding_single_use"); providerTransportBound = true;
        assert.equal(typeof record, "function"); await revalidateJourneyCapability(bindings.capability);
        const authority = sandboxLlmApprovalForId(approvalId) ?? SANDBOX_LLM_APPROVAL;
        assert.equal(approvalId, authority.approvalId, "journey_explicit_original_approval_required");
        assert.ok(Number.isInteger(expectedConsumedCalls) && expectedConsumedCalls >= (authority.originalConsumedCalls ?? 12) && expectedConsumedCalls < authority.maximumCalls, "journey_expected_consumed_calls_required");
        const before = inspectOriginalJourneyBudget({ approvalId }); assert.equal(before.attemptedCalls, expectedConsumedCalls); assert.equal(before.remainingCalls, authority.maximumCalls - expectedConsumedCalls);
        assert.ok(globalThis.fetch === earlyFetch && net.Socket.prototype.connect === earlyConnect, "journey_early_fence_identity_required");
        // The early guard stays installed throughout asynchronous revalidation.
        // Only the approved egress wrapper receives the underlying transports;
        // previously captured early fetch functions still deny external calls.
        egress = await installStorefrontJourneyEgress({ capability: bindings.capability, previousFence: {
          fetch: earlyFetch, connect: earlyConnect, underlyingFetch: originalFetch, underlyingConnect: originalConnect,
        } }); initialFence = false;
        const budget = await createOriginalApprovedJourneyBudget({ allowRealDeepSeek: true, approvalId });
        const transport = egress.createTransport({ budget, record, approvalId });
        await providerModule.bindVerifiedTransport({ capability: bindings.capability, transport });
        bridge = await createJourneyHttpOperations({ capability: bindings.capability, transport, buyerJwt, capabilities, listener, artifactTree: tree, routePrefix: "/v1" });
        llm = Object.freeze({ bridge, transport, before, budgetStatus: () => inspectOriginalJourneyBudget({ approvalId }), egressEvidence: () => egress.evidence() });
        return llm;
      } });
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "journey_owned_app_setup_and_cleanup_failed"); }
    throw error;
  }
}
