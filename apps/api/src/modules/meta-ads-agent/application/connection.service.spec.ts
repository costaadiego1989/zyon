import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationFixture } from "./__tests__/fixture.js";
import { ConnectionService } from "./connection.service.js";

async function fixture() {
  const f = await applicationFixture(); const service = new ConnectionService(f.repo, f.commerce, f.oauth, f.codec, f.provider, f.redirect, f.clock);
  const connect = async () => {
    const result = await service.begin("store-a", "owner-a"); const state = new URL(result.authorizationUrl).searchParams.get("state")!;
    return service.complete("store-a", "owner-a", state, "server-code");
  };
  const select = () => service.select("store-a", { accountId: "100", pageId: "110", datasetId: "120", catalogId: "130", whatsappId: "5511999999999" });
  return { ...f, service, connect, select };
}
test("MGA-13 connection exposes only the effectively authorized asset discovery", async () => {
  const f = await fixture(); try { const connection = await f.connect(); assert.deepEqual(connection.accounts, [{ id: "100", name: "Conta" }]); assert.deepEqual(connection.pages, f.discovery.pages); await f.select(); const view = await f.service.view("store-a"); assert.equal(view.account!.id, "100"); assert.equal(view.dataset!.id, "120"); } finally { await f.close(); }
});
test("MGA-14 credentials stay encrypted in storage and never enter public connection responses", async () => {
  const f = await fixture(); try { const response = await f.connect(); const stored = (await f.repo.read("store-a")).connection; assert.notEqual(stored.encryptedAccessToken, "scoped-test-token"); assert.equal(f.codec.decrypt("store-a", stored.encryptedAccessToken!), "scoped-test-token"); assert.equal(JSON.stringify(response).includes("scoped-test-token"), false); assert.equal("encryptedAccessToken" in response, false); assert.equal("clientConversationId" in response, false); assert.equal("scopes" in response, false); } finally { await f.close(); }
});
test("MGA-16 limited permissions remain unavailable without invoking a substitute write", async () => {
  const f = await fixture(); try { f.discovery.capabilities.prepare = false; f.discovery.errors.push("prepare_unavailable"); const connection = await f.connect(); assert.equal(connection.status, "limited"); assert.equal(connection.capabilities.prepare, false); await f.select(); await assert.rejects(f.service.access("store-a", { operation: "prepare" }), { code: "meta_capability_unavailable" }); assert.equal(f.calls.includes("prepare"), false); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); }
});
test("MGA-17 catalog denial remains an access error instead of a successful empty catalog", async () => {
  const f = await fixture(); try { f.discovery.catalogs = []; f.discovery.capabilities.catalog = false; f.discovery.errors.push("catalog_access_denied"); const response = await f.connect(); assert.equal(response.capabilities.catalog, false); assert.equal(response.lastError, "catalog_access_denied"); assert.equal(response.status, "limited"); } finally { await f.close(); }
});
test("MGA-18 WhatsApp requires the authorized number to belong to the selected page and account", async () => {
  const f = await fixture(); try { await f.connect(); await f.select(); assert.equal((await f.service.access("store-a", { destination: "whatsapp" })).whatsappId, "5511999999999"); f.discovery.whatsappNumbers[0].pageId = "other-page"; await assert.rejects(f.select(), { code: "meta_whatsapp_not_linked", status: 403 }); } finally { await f.close(); }
});
test("MGA-19 disconnect clears credentials and invalidates pending approvals without pausing ads", async () => {
  const f = await fixture(); try {
    await f.connect(); await f.select(); const before = (await f.service.view("store-a")).epoch;
    await f.repo.mutate("store-a", [], state => { state.proposals["pending"] = { id: "pending", campaignId: "campaign-a", kind: "pause", status: "approved", before: {}, after: {}, digest: "digest", connectionEpoch: before, reasoning: "Revisado", createdAt: "2026-11-14T12:00:00Z", approvedAt: "2026-11-14T12:00:00Z", approvedBy: "owner-a", executionId: null, remoteBefore: null, productVersions: {} }; return { result: null }; });
    await f.service.disconnect("store-a"); const state = await f.repo.read("store-a"); assert.equal(state.connection.encryptedAccessToken, null); assert.equal(state.connection.status, "disconnected"); assert.equal(state.connection.epoch, before + 1); assert.equal(state.proposals.pending.status, "stale"); await assert.rejects(f.service.access("store-a"), { code: "meta_connection_required" }); assert.equal(f.calls.includes("execute"), false);
  } finally { await f.close(); }
});
test("OAuth state is actor/store bound, expires and is consumed once before exchanging the code", async () => {
  const f = await fixture(); try {
    const begin = await f.service.begin("store-a", "owner-a"); const state = new URL(begin.authorizationUrl).searchParams.get("state")!;
    await assert.rejects(f.service.complete("store-a", "owner-b", state, "code"), { code: "meta_oauth_state_invalid" });
    await assert.rejects(f.service.complete("store-b", "owner-a", state, "code")); assert.equal(f.calls.includes("exchange"), false);
    await f.service.complete("store-a", "owner-a", state, "code"); await assert.rejects(f.service.complete("store-a", "owner-a", state, "code"), { code: "meta_oauth_state_invalid" }); assert.equal(f.calls.filter(c => c === "exchange").length, 1);
    const another = await f.service.begin("store-a", "owner-a"); f.setNow("2026-11-14T12:11:00Z"); await assert.rejects(f.service.complete("store-a", "owner-a", new URL(another.authorizationUrl).searchParams.get("state")!, "code"), { code: "meta_oauth_state_expired" });
  } finally { await f.close(); }
});
test("asset selection rejects unknown ids before Meta reads and a concurrent disconnect prevents stale credential installation", async () => {
  const f = await fixture(); try {
    await f.connect(); const before = f.calls.length;
    await assert.rejects(f.service.select("store-a", { accountId: "foreign", pageId: "110" }), { code: "meta_asset_forbidden", status: 403 }); assert.equal(f.calls.length, before);
    f.oauth.exchange = async () => { await f.service.disconnect("store-a"); return { accessToken: "stale-token", scopes: ["ads_mcp_management", "ads_management"], expiresAt: null }; };
    const begin = await f.service.begin("store-a", "owner-a"); await assert.rejects(f.service.complete("store-a", "owner-a", new URL(begin.authorizationUrl).searchParams.get("state")!, "code"), { code: "meta_connection_changed" });
    assert.equal((await f.repo.read("store-a")).connection.encryptedAccessToken, null);
  } finally { await f.close(); }
});

test("a newer OAuth authorization supersedes an older code exchange without losing the new state", async () => {
  const f = await fixture(); try {
    const first = await f.service.begin("store-a", "owner-a"); let secondState = "";
    const exchange = f.oauth.exchange;
    f.oauth.exchange = async () => {
      const second = await f.service.begin("store-a", "owner-a"); secondState = new URL(second.authorizationUrl).searchParams.get("state")!;
      return { accessToken: "old-authorization-token", scopes: ["ads_mcp_management", "ads_management"], expiresAt: null };
    };
    await assert.rejects(f.service.complete("store-a", "owner-a", new URL(first.authorizationUrl).searchParams.get("state")!, "code"), { code: "meta_connection_changed" });
    assert.equal((await f.repo.read("store-a")).connection.encryptedAccessToken, null);
    f.oauth.exchange = exchange;
    assert.equal((await f.service.complete("store-a", "owner-a", secondState, "new-code")).accounts[0].id, "100");
  } finally { await f.close(); }
});
