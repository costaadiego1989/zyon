import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { applicationFixture } from "../application/__tests__/fixture.js";
import { MetaAdsAgentService } from "../application/meta-ads-agent.service.js";
import { BillingService } from "../application/billing.service.js";
import { ConnectionService } from "../application/connection.service.js";
import { CampaignService } from "../application/campaign.service.js";
import { GenerationService } from "../application/generation.service.js";
import { ProposalService } from "../application/proposal.service.js";
import { ExecutionService } from "../application/execution.service.js";
import { readOffer } from "../domain/offer.js";
import { MetaAdsAgentController, MetaAdsHttpErrorFilter } from "./meta-ads-agent.controller.js";

async function fixture() {
  const f = await applicationFixture(); let sequence = 0; const id = () => `object-${++sequence}`;
  const connection = new ConnectionService(f.repo, f.commerce, f.oauth, f.codec, f.provider, f.redirect, f.clock);
  const billing = new BillingService(f.repo, f.commerce, { quote: async () => ({ amountCents: 14900, currency: "BRL", cadence: "monthly" }), createCheckout: async () => { throw new Error("disabled in HTTP test"); }, cancelRenewal: async () => undefined, verifiedEvent: async () => null }, () => readOffer({}), f.clock, id);
  f.commerce.products = async () => [{ productId: "product-a", variantId: "variant-a", name: "Produto", description: "", sku: "A", imageUrl: "https://media.example.test/a.png", priceCents: 10000, currency: "BRL", stockQuantity: 5, active: true, storefrontUrl: "https://store.example.test/a", commercialVersion: "v1" }];
  const campaigns = new CampaignService(f.repo, f.commerce, connection, f.provider, f.clock, id);
  const generations = new GenerationService(f.repo, f.commerce, { configured: () => false, generate: async () => { throw new Error("no paid call"); } }, f.clock, id);
  const proposals = new ProposalService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock, id);
  const executions = new ExecutionService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock, id);
  const service = new MetaAdsAgentService(f.repo, f.commerce, billing, connection, campaigns, generations, proposals, executions, f.provider, { META_ADS_DASHBOARD_URL: "https://dashboard.example.test" });
  const jwt = { authenticate: async (token: string) => { if (!["owner-a", "owner-b", "staff-a"].includes(token)) throw new Error("jwt_invalid_signature"); return { merchantId: token === "owner-b" ? "store-b" : "store-a", userId: token, email: "owner@example.test", role: token === "staff-a" ? "staff" : "owner" }; } } as unknown as JwtService;
  // The repo test loader omits metadata; restore the constructor metadata emitted by the production build.
  Reflect.defineMetadata("design:paramtypes", [JwtService, AuthCookieService], AuthGuard);
  @Module({ controllers: [MetaAdsAgentController], providers: [{ provide: MetaAdsAgentService, useValue: service }, { provide: JwtService, useValue: jwt }, { provide: AuthCookieService, useValue: new AuthCookieService("aacp_access_token", false) }, AuthGuard, MetaAdsHttpErrorFilter] }) class TestHttpModule {}
  const app = await NestFactory.create(TestHttpModule, { logger: false }); await app.listen(0, "127.0.0.1"); const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/meta-ads-agent`;
  const request = async (path = "", method = "GET", body?: unknown, token: string | null = "owner-a", headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ...f, request, connection, proposals, closeHttp: async () => { await app.close(); await f.close(); } };
}
test("MGA-10 authenticated owner and tenant checks reject anonymous, staff and cross-store mutations", async () => {
  const f = await fixture(); try { assert.equal((await f.request("", "GET", undefined, null)).status, 401); assert.equal((await f.request("", "GET", undefined, "staff-a")).status, 403); const own = await f.request("?merchant_id=store-b"); assert.equal(own.status, 200); assert.equal((await own.json()).wallet.monthlyAvailable, 30);
    const forged = await f.request("/connection/start", "POST", { merchant_id: "store-b" }); assert.equal(forged.status, 400); assert.equal((await f.repo.read("store-b")).pendingOAuth, null); const other = await f.request("/proposals/foreign/execute", "POST", {}, "owner-b"); assert.equal(other.status, 403); assert.equal(f.calls.includes("execute"), false);
    assert.equal((await f.request("/connection/start", "POST", {}, null, { Cookie: "aacp_access_token=owner-a", Origin: "https://evil.example.test" })).status, 403);
  } finally { await f.closeHttp(); }
});
test("MGA-11 authenticated overview reports monthly quota from server and contract history after expiry", async () => {
  const f = await fixture(); try { const response = await f.request(); const value = await response.json(); assert.equal(value.eligible, true); assert.equal(value.entitled, true); assert.equal(value.offer.monthlyImageCredits, 30); assert.equal(value.wallet.monthlyAvailable, 30); assert.equal(value.subscription.offer.monthlyImageCredits, 30); assert.equal(value.offer.monthlyPriceCents, 14900); f.setNow("2026-12-02T12:00:00Z"); const expired = await (await f.request()).json(); assert.equal(expired.entitled, false); assert.equal(expired.wallet.monthlyAvailable, 0); assert.equal(expired.subscription.id, "contract-a"); assert.equal((await f.request("/campaigns", "POST", {})).status, 403); } finally { await f.closeHttp(); }
});
test("MGA-15 OAuth browser only carries state and code while provider credentials stay server-side", async () => {
  const f = await fixture(); try { const start = await f.request("/connection/start", "POST", {}); assert.equal(start.status, 201); const url = new URL((await start.json()).authorizationUrl); const state = url.searchParams.get("state")!;
    assert.equal((await f.request("/connection/complete", "POST", { state, code: "test-code", accessToken: "browser-token" })).status, 400); assert.equal((await f.request("/connection/complete", "POST", { state, code: "test-code" })).status, 201);
    const overview = await (await f.request()).json(); const json = JSON.stringify(overview); for (const secret of ["scoped-test-token", "encryptedAccessToken", "clientConversationId", "providerSubscriptionId", "providerCustomerId", "pendingOAuth", "scopes"]) assert.equal(json.includes(secret), false); assert.equal(overview.connection.status, "connected"); assert.equal(overview.connection.accounts[0].id, "100"); assert.notEqual((await f.repo.read("store-a")).connection.encryptedAccessToken, "scoped-test-token");
  } finally { await f.closeHttp(); }
});
test("HTTP review, exact approval and execution preserve one actor-bound execution across replay", async () => {
  const f = await fixture(); try {
    const begin = await f.connection.begin("store-a", "owner-a"); await f.connection.complete("store-a", "owner-a", new URL(begin.authorizationUrl).searchParams.get("state")!, "code"); await f.connection.select("store-a", { accountId: "100", pageId: "110", datasetId: "120" });
    const created = await f.request("/campaigns", "POST", { draft: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], mediaIds: [], budget: { amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null }, country: "BR", headline: "Produto", primaryText: "Conheca" }, idempotencyKey: "create-http" }); assert.equal(created.status, 201); const campaign = await created.json();
    await f.repo.mutate("store-a", [], state => { Object.assign(state.campaigns[campaign.id], { remoteCampaignId: "200", remoteAccountId: "100", remoteAdSetId: "300", remoteAdIds: ["500"], status: "remote_paused" }); return { result: null }; });
    const proposalResponse = await f.request(`/campaigns/${campaign.id}/proposals`, "POST", { kind: "pause", after: {}, reasoning: "Pausar com revisao", idempotencyKey: "pause-http" }); assert.equal(proposalResponse.status, 201); const proposal = await proposalResponse.json(); assert.equal(proposal.status, "pending_review");
    assert.equal((await f.request(`/proposals/${proposal.id}/execute`, "POST", {})).status, 403); assert.equal((await f.request(`/proposals/${proposal.id}/approve`, "POST", { digest: "changed" })).status, 409); assert.equal((await f.request(`/proposals/${proposal.id}/approve`, "POST", { digest: proposal.digest })).status, 201);
    const execution = await (await f.request(`/proposals/${proposal.id}/execute`, "POST", {})).json(); const replay = await (await f.request(`/proposals/${proposal.id}/execute`, "POST", {})).json(); assert.equal(execution.status, "remote_paused"); assert.equal(replay.id, execution.id); assert.equal(f.calls.filter(call => call === "execute").length, 1);
    const audit = (await f.repo.getRecord<{ actorId: string; digest: string }>("store-a", `execution-result:${execution.id}:1`))!; assert.equal(audit.payload.actorId, "owner-a"); assert.equal(audit.payload.digest, proposal.digest); assert.equal((await f.request(`/proposals/${proposal.id}/execute`, "POST", {}, "owner-b")).status, 403);
  } finally { await f.closeHttp(); }
});
test("existing campaigns expose account-scoped analysis without granting agent ownership", async () => {
  const f = await fixture(); try { const begin = await f.connection.begin("store-a", "owner-a"); await f.connection.complete("store-a", "owner-a", new URL(begin.authorizationUrl).searchParams.get("state")!, "code"); await f.connection.select("store-a", { accountId: "100", pageId: "110", datasetId: "120" }); f.provider.existingCampaigns = async () => [{ id: "900", name: "Zyon manual", status: "ACTIVE" }];
    const response = await f.request("/existing/900/metrics?since=2026-11-01&until=2026-11-14"); assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.spendCents, 2000); assert.equal(result.source, "meta_reported"); assert.equal(result.confirmedRevenueCents, null); assert.ok(result.notes.includes("existing_campaign_read_only")); assert.equal((await f.request("/existing/999/metrics?since=2026-11-01&until=2026-11-14")).status, 403); assert.equal(Object.keys((await f.repo.read("store-a")).campaigns).length, 0); assert.equal(f.calls.includes("execute"), false);
  } finally { await f.closeHttp(); }
});
