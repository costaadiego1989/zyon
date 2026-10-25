import assert from "node:assert/strict";
import { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseJourneyManifest, verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";
import { assertLegacySyntheticIdentity } from "./legacy-prisma-disposable-guards.mjs";
import { assertSyntheticRedisIdentity } from "./local-disposable-redis.mjs";

const bindingSchema = z.strictObject({ runId: z.uuidv4(), merchantId: z.uuidv4(), buyerId: z.uuidv4(), sessionId: z.string(),
  apiOrigin: z.string(), postgresRunId: z.uuidv4(), redisRunId: z.uuidv4() });
const bindingFor = manifest => bindingSchema.parse(Object.fromEntries(Object.keys(bindingSchema.shape).map(key => [key, manifest[key]])));

/** Pure refusal contract only. This never mints a capability; the factory below
 * must collect these observations through its OWN actual native clients. */
export function assertCanonicalJourneyEvidence(rawManifest, observations) {
  const manifest = parseJourneyManifest(rawManifest), expected = bindingFor(manifest);
  assert.ok(Array.isArray(observations.bindingRows) && observations.bindingRows.length === 1, "journey_single_sql_binding_required");
  assert.deepEqual(bindingSchema.parse(observations.bindingRows[0]), expected, "journey_sql_binding_mismatch");
  assert.ok(typeof observations.redisJourneyMarker === "string" && observations.redisJourneyMarker.length <= 4096, "journey_redis_binding_required");
  assert.deepEqual(bindingSchema.parse(JSON.parse(observations.redisJourneyMarker)), expected, "journey_redis_binding_mismatch");
  assert.equal(observations.redisRunMarker, manifest.redisRunId, "journey_redis_run_mismatch");
  assert.deepEqual(observations.merchant, { id: manifest.merchantId, storeSlug: `journey-${manifest.runId}` }, "journey_synthetic_merchant_required");
  assert.deepEqual(observations.buyer, { globalUserId: manifest.buyerId, email: `journey.${manifest.runId}@example.invalid` }, "journey_synthetic_buyer_required");
  if (observations.cart !== null) assert.deepEqual(observations.cart, { merchantId: manifest.merchantId, sessionId: manifest.sessionId }, "journey_cart_scope_mismatch");
  assert.ok(observations.listener && observations.listener.address === "127.0.0.1"
    && observations.listener.port === Number(new URL(manifest.apiOrigin).port), "journey_exact_owned_listener_required");
}

/** Only call with outputs of the actual canonical signature/expiry verifiers.
 * No boolean trusted/verified flag is accepted as an authorization substitute. */
export function assertCanonicalJourneyClaims(rawManifest, buyer, conversation) {
  const manifest = parseJourneyManifest(rawManifest);
  assert.ok(buyer && buyer.globalUserId === manifest.buyerId && buyer.merchantId === manifest.merchantId
    && buyer.role === "buyer" && buyer.aud === "buyer", "journey_buyer_claims_mismatch");
  assert.ok(conversation && conversation.purpose === "storefront-conversation" && conversation.merchantId === manifest.merchantId
    && conversation.resourceId === manifest.sessionId && conversation.origin === manifest.apiOrigin
    && conversation.aiUserId === `buyer:${manifest.buyerId}`, "journey_conversation_claims_mismatch");
}

async function bounded(work, code) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), 5000); })]); }
  finally { clearTimeout(timer); }
}
export function journeyArtifactModuleUrl(tree, relative) {
  assert.ok(tree === "dist" || tree === "dist-test", "journey_compiled_artifact_tree_required");
  const modules = new Set(["modules/buyer-account/domain/services/buyer-jwt.service", "shared/auth/realtime-capability",
    "modules/storefront/infrastructure/adapters/storefront-conversation.adapter"]);
  assert.ok(modules.has(relative), "journey_canonical_module_required");
  return new URL(`../${tree}/${relative}.js`, import.meta.url);
}

/** No I/O on import. Invocation connects ONLY to validated run-owned URLs.
 * Auth services must be actual instances retrieved from this real app/artifact;
 * no caller callback/repository/auth override or synthetic true flag exists.
 * This is a prerequisite, not an app bootstrap/seed or completed journey. */
export async function createCanonicalStorefrontJourneyBindings(input) {
  const expectedKeys = ["manifest", "databaseUrl", "redisUrl", "artifactTree", "buyerJwt", "capabilities", "listener", "buyerToken", "conversationToken"];
  assert.deepEqual(Object.keys(input).sort(), expectedKeys.sort(), "journey_exact_binding_dependencies_required");
  const { databaseUrl, redisUrl, artifactTree, buyerJwt, capabilities, listener, buyerToken, conversationToken } = input;
  const manifest = parseJourneyManifest(input.manifest), database = assertNativePrismaUrl(databaseUrl);
  assert.equal(Number(database.port), manifest.postgresPort);
  assertSyntheticRedisIdentity(redisUrl, manifest.redisRunId, manifest.redisRunId); // URL shape only; actual GET below.
  assert.equal(Number(new URL(redisUrl).port), manifest.redisPort);
  assert.ok(listener instanceof Server && listener.listening, "journey_actual_http_listener_required");
  assert.ok(typeof buyerToken === "string" && buyerToken.length <= 8192 && buyerToken.length > 0, "journey_buyer_token_required");
  assert.ok(typeof conversationToken === "string" && conversationToken.length <= 4096 && conversationToken.length > 0, "journey_conversation_token_required");
  const [{ BuyerJwtService }, { RealtimeCapabilityService }] = await Promise.all([
    import(journeyArtifactModuleUrl(artifactTree, "modules/buyer-account/domain/services/buyer-jwt.service")),
    import(journeyArtifactModuleUrl(artifactTree, "shared/auth/realtime-capability")),
  ]);
  assert.ok(buyerJwt instanceof BuyerJwtService && capabilities instanceof RealtimeCapabilityService, "journey_canonical_auth_instances_required");
  const verifyBuyer = BuyerJwtService.prototype.verify.bind(buyerJwt);
  const verifyConversation = RealtimeCapabilityService.prototype.verify.bind(capabilities);
  inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url))); // generated client cannot load env files
  const [{ PrismaClient }, { Redis }] = await Promise.all([import("@prisma/client"), import("ioredis")]);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null,
    connectTimeout: 5000, commandTimeout: 5000 });
  let disposed = false;
  const active = () => assert.equal(disposed, false, "journey_canonical_bindings_closed");
  const dispose = async () => {
    if (disposed) return; disposed = true;
    const outcomes = await Promise.allSettled([bounded(db.$disconnect(), "journey_verifier_sql_cleanup_timeout"),
      redis.status === "ready" ? bounded(redis.quit(), "journey_verifier_redis_cleanup_timeout") : Promise.resolve()]);
    redis.disconnect();
    const errors = outcomes.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "journey_verifier_cleanup_failed");
  };
  try {
    await redis.connect();
    const capability = await verifyJourneyPreflight({ manifest, principalToken: buyerToken,
      verifyPrincipal: async token => {
        active();
        const buyer = verifyBuyer(token);
        const conversation = verifyConversation(conversationToken, "storefront-conversation", manifest.apiOrigin);
        assertCanonicalJourneyClaims(manifest, buyer, conversation);
        return { runId: manifest.runId, merchantId: buyer.merchantId, buyerId: buyer.globalUserId, sessionId: conversation.resourceId };
      },
      verifyResources: async () => {
        active();
        assert.ok(listener.listening, "journey_owned_listener_closed");
        assertLegacySyntheticIdentity(databaseUrl, manifest.postgresRunId,
          await db.$queryRaw`SELECT current_database() AS database, run_id FROM synthetic_native_marker`);
        const bindingRows = await db.$queryRaw`SELECT run_id AS "runId", merchant_id AS "merchantId", buyer_id AS "buyerId",
          session_id AS "sessionId", api_origin AS "apiOrigin", postgres_run_id AS "postgresRunId", redis_run_id AS "redisRunId"
          FROM synthetic_storefront_journey_binding WHERE run_id=${manifest.runId}`;
        const [merchant, buyer, cart, redisRunMarker, redisJourneyMarker] = await Promise.all([
          db.merchant.findUnique({ where: { id: manifest.merchantId }, select: { id: true, storeSlug: true } }),
          db.buyerAccount.findUnique({ where: { globalUserId: manifest.buyerId }, select: { globalUserId: true, email: true } }),
          db.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: manifest.merchantId, sessionId: manifest.sessionId } },
            select: { merchantId: true, sessionId: true } }),
          redis.get("aacp:synthetic:run"), redis.get(`aacp:synthetic:journey:${manifest.runId}`),
        ]);
        assertCanonicalJourneyEvidence(manifest, { bindingRows, redisRunMarker, redisJourneyMarker, merchant, buyer, cart, listener: listener.address() });
        return { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId,
          apiOrigin: manifest.apiOrigin, postgresRunId: manifest.postgresRunId, redisRunId: manifest.redisRunId,
          postgresPort: manifest.postgresPort, redisPort: manifest.redisPort };
      } });
    return Object.freeze({ capability, dispose });
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "journey_binding_startup_cleanup_failed"); }
    throw error;
  }
}
