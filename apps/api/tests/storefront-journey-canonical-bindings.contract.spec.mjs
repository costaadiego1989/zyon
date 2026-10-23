import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { verifyJourneyPreflight, readJourneyCapability } from "./storefront-journey-guards.mjs";
import { assertCanonicalJourneyEvidence, assertCanonicalJourneyClaims, journeyArtifactModuleUrl } from "./storefront-journey-canonical-bindings.mjs";

// Pure proof/refusal contracts with explicitly synthetic observations. These
// doubles do NOT establish SQL/Redis authentication or a completed HTTP journey.
function fixture() {
  const manifest = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: `conv_${randomUUID()}`,
    apiOrigin: "http://127.0.0.1:19987", postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const binding = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId,
    apiOrigin: manifest.apiOrigin, postgresRunId: manifest.postgresRunId, redisRunId: manifest.redisRunId };
  const observations = { bindingRows: [binding], redisJourneyMarker: JSON.stringify(binding), redisRunMarker: manifest.redisRunId,
    merchant: { id: manifest.merchantId, storeSlug: `journey-${manifest.runId}` },
    buyer: { globalUserId: manifest.buyerId, email: `journey.${manifest.runId}@example.invalid` }, cart: null,
    listener: { address: "127.0.0.1", port: 19987, family: "IPv4" } };
  const buyer = { globalUserId: manifest.buyerId, merchantId: manifest.merchantId, role: "buyer", aud: "buyer" };
  const conversation = { purpose: "storefront-conversation", merchantId: manifest.merchantId, resourceId: manifest.sessionId,
    origin: manifest.apiOrigin, aiUserId: `buyer:${manifest.buyerId}` };
  return { manifest, binding, observations, buyer, conversation };
}
test("canonical conv_UUID and legacy UUID both survive exact principal/resource checks", async () => {
  for (const sessionId of [randomUUID(), `conv_${randomUUID()}`]) {
    const { manifest } = fixture(); manifest.sessionId = sessionId;
    const principal = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId };
    const capability = await verifyJourneyPreflight({ manifest, principalToken: "unit-double-only", verifyPrincipal: async () => principal,
      verifyResources: async () => ({ ...principal, apiOrigin: manifest.apiOrigin, postgresRunId: manifest.postgresRunId,
        redisRunId: manifest.redisRunId, postgresPort: manifest.postgresPort, redisPort: manifest.redisPort }) });
    assert.equal(readJourneyCapability(capability).sessionId, sessionId);
  }
});
for (const sessionId of ["conv_", "conv_arbitrary", `conv_conv_${randomUUID()}`, `prefix_${randomUUID()}`, `conv_${randomUUID()}/other`, "../session"]) {
  test(`malformed canonical resource refused: ${sessionId}`, async () => {
    const { manifest } = fixture();
    await assert.rejects(verifyJourneyPreflight({ manifest: { ...manifest, sessionId }, principalToken: "unit-only",
      verifyPrincipal: async () => assert.fail("must not verify malformed manifest"), verifyResources: async () => assert.fail("must not read") }), /journey_manifest_invalid/);
  });
}
test("pure canonical observations require exact markers and existing synthetic rows", () => {
  const { manifest, observations } = fixture();
  assert.doesNotThrow(() => assertCanonicalJourneyEvidence(manifest, observations));
  assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, bindingRows: [] }));
  assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, bindingRows: [observations.bindingRows[0], observations.bindingRows[0]] }));
  assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, merchant: null }));
  assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, buyer: { ...observations.buyer, email: "actual@example.com" } }));
});
for (const key of ["merchantId", "buyerId", "sessionId", "postgresRunId", "redisRunId", "apiOrigin", "runId"]) {
  test(`SQL/Redis binding mismatch fails closed: ${key}`, () => {
    const { manifest, observations, binding } = fixture();
    assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, bindingRows: [{ ...binding, [key]: "foreign" }] }));
    assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, redisJourneyMarker: JSON.stringify({ ...binding, [key]: "foreign" }) }));
  });
}
test("listener and optional stored cart must remain exact owned loopback scope", () => {
  const { manifest, observations } = fixture();
  assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, listener: { ...observations.listener, address: "0.0.0.0" } }));
  assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, listener: { ...observations.listener, port: 19988 } }));
  assert.throws(() => assertCanonicalJourneyEvidence(manifest, { ...observations, cart: { merchantId: "foreign", sessionId: manifest.sessionId } }));
});
test("canonical claims bind BOTH buyer and conversation scope/origin/identity", () => {
  const { manifest, buyer, conversation } = fixture();
  assert.doesNotThrow(() => assertCanonicalJourneyClaims(manifest, buyer, conversation));
  for (const changed of [{ merchantId: "foreign" }, { aud: "merchant" }, { role: "admin" }, { globalUserId: "foreign" }, { merchantId: undefined }])
    assert.throws(() => assertCanonicalJourneyClaims(manifest, { ...buyer, ...changed }, conversation));
  for (const changed of [{ merchantId: "foreign" }, { resourceId: `conv_${randomUUID()}` }, { origin: undefined },
    { origin: "https://production.invalid" }, { aiUserId: "visitor:foreign" }, { purpose: "support-ticket" }])
    assert.throws(() => assertCanonicalJourneyClaims(manifest, buyer, { ...conversation, ...changed }));
});

test("actual compiled canonical JWT/capability signatures bind matching run identities", async () => {
  const [{ BuyerJwtService }, { RealtimeCapabilityService }] = await Promise.all([
    import(journeyArtifactModuleUrl("dist-test", "modules/buyer-account/domain/services/buyer-jwt.service")),
    import(journeyArtifactModuleUrl("dist-test", "shared/auth/realtime-capability")),
  ]);
  const { manifest } = fixture();
  const buyerJwt = new BuyerJwtService(randomBytes(48).toString("base64url"), 600);
  const capabilities = new RealtimeCapabilityService(randomBytes(48).toString("base64url"));
  const buyerToken = buyerJwt.sign({ globalUserId: manifest.buyerId, merchantId: manifest.merchantId,
    email: `journey.${manifest.runId}@example.invalid` });
  const access = capabilities.issue({ purpose: "storefront-conversation", merchantId: manifest.merchantId,
    resourceId: manifest.sessionId, origin: manifest.apiOrigin, aiUserId: `buyer:${manifest.buyerId}` });
  assertCanonicalJourneyClaims(manifest, buyerJwt.verify(buyerToken), capabilities.verify(access.token, "storefront-conversation", manifest.apiOrigin));
  assert.throws(() => buyerJwt.verify(buyerToken.slice(0, -6) + "broken"));
  assert.throws(() => capabilities.verify(access.token, "storefront-conversation", "https://foreign.invalid"));
  assert.throws(() => capabilities.verify(access.token.slice(0, -6) + "broken", "storefront-conversation", manifest.apiOrigin));
  // Signature verification is real; no app/listener/SQL/Redis journey is asserted.
});
