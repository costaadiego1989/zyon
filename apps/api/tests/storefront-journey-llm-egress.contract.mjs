import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { installStorefrontJourneyEgress } from "./storefront-journey-egress.mjs";

async function fixture(work) {
  const manifest = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: randomUUID(),
    apiOrigin: "http://127.0.0.1:19987", postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const principal = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId };
  const resources = { ...principal, apiOrigin: manifest.apiOrigin, postgresRunId: manifest.postgresRunId,
    redisRunId: manifest.redisRunId, postgresPort: manifest.postgresPort, redisPort: manifest.redisPort };
  let verify = async () => resources;
  const capability = await verifyJourneyPreflight({ manifest, principalToken: "contract-only", verifyPrincipal: async () => principal, verifyResources: () => verify() });
  const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect;
  const earlyFetch = async () => { throw Error("contract_early_fetch_denied"); }, earlyConnect = function () { throw Error("contract_early_socket_denied"); };
  const previousFence = { fetch: earlyFetch, connect: earlyConnect, underlyingFetch: async () => new Response("{}"), underlyingConnect: originalConnect };
  globalThis.fetch = earlyFetch; net.Socket.prototype.connect = earlyConnect;
  try { await work({ capability, previousFence, resources, setVerify: fn => { verify = fn; } }); }
  finally { globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; }
}
test("previous fence remains installed throughout async revalidation and is restored on disposal", async () => fixture(async ({ capability, previousFence, resources, setVerify }) => {
  setVerify(async () => {
    assert.equal(globalThis.fetch, previousFence.fetch); assert.equal(net.Socket.prototype.connect, previousFence.connect);
    await Promise.resolve(); await assert.rejects(globalThis.fetch("https://foreign.invalid"), /contract_early_fetch_denied/);
    return resources;
  });
  const egress = await installStorefrontJourneyEgress({ capability, previousFence });
  try {
    await assert.rejects(previousFence.fetch("https://api.deepseek.com/v1/chat/completions"), /contract_early_fetch_denied/);
    await assert.rejects(globalThis.fetch("https://api.deepseek.com/v1/chat/completions"), /journey_unaccounted_fetch_forbidden/);
  } finally { egress.dispose(); }
  assert.equal(globalThis.fetch, previousFence.fetch); assert.equal(net.Socket.prototype.connect, previousFence.connect);
}));
test("changed globals before installation never mint the approved transport", async () => fixture(async ({ capability, previousFence }) => {
  globalThis.fetch = async () => new Response("{}");
  await assert.rejects(installStorefrontJourneyEgress({ capability, previousFence }), /journey_previous_fence_identity_required/);
}));
test("changed globals during revalidation never get overwritten", async () => fixture(async ({ capability, previousFence, resources, setVerify }) => {
  const replacement = async () => new Response("{}");
  setVerify(async () => { globalThis.fetch = replacement; return resources; });
  await assert.rejects(installStorefrontJourneyEgress({ capability, previousFence }), /journey_egress_installation_globals_changed/);
  assert.equal(globalThis.fetch, replacement);
}));
test("failed live resource verification leaves the early fence intact", async () => fixture(async ({ capability, previousFence, setVerify }) => {
  setVerify(async () => { throw Error("contract_marker_unavailable"); });
  await assert.rejects(installStorefrontJourneyEgress({ capability, previousFence }));
  assert.equal(globalThis.fetch, previousFence.fetch); assert.equal(net.Socket.prototype.connect, previousFence.connect);
}));
