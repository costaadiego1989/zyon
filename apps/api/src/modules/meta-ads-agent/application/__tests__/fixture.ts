import { readOffer } from "../../domain/offer.js";
import type { CommerceContextPort, MetaAdsProviderPort, MetaDiscovery, MetaOAuthPort } from "../../domain/types.js";
import { CredentialCodec } from "../../infrastructure/credential-codec.js";
import { PrismaMetaAdsRepository } from "../../infrastructure/prisma-meta-ads.repository.js";
import { testDatabase } from "../../infrastructure/__tests__/database.js";

export async function applicationFixture() {
  const db = await testDatabase(); const repo = new PrismaMetaAdsRepository(db.prisma);
  let plan: "growth" | "scale" | "starter" = "growth"; let now = new Date("2026-11-14T12:00:00Z");
  await repo.mutate("store-a", [], state => {
    state.subscription = { id: "contract-a", offer: readOffer({}), status: "active", provider: "stripe", currentPeriodStart: "2026-11-01T00:00:00Z", currentPeriodEnd: "2026-12-01T00:00:00Z", cancelAtPeriodEnd: false, acceptedAt: "2026-11-01T00:00:00Z", checkoutId: "cs-a", providerSubscriptionId: "sub-a", providerCustomerId: "cus-a" };
    state.credits.monthlyAvailable = 30; state.credits.periodKey = "period-a"; state.credits.periodEndsAt = "2026-12-01T00:00:00Z";
    return { result: null };
  });
  const calls: string[] = [];
  const commerce: CommerceContextPort = { getPlan: async () => plan, getProfile: async () => ({ name: "Loja", email: "owner@example.test", storefrontUrl: "https://store.example.test/store/loja", stripeCustomerId: null }), products: async () => [], paidOrder: async () => null, paidOrders: async () => [] };
  const discovery: MetaDiscovery = { accounts: [{ id: "100", name: "Conta" }], pages: [{ id: "110", name: "Pagina", accountId: "100" }], catalogs: [{ id: "130", name: "Catalogo", accountId: "100" }], datasets: [{ id: "120", name: "Compras", accountId: "100" }], whatsappNumbers: [{ id: "5511999999999", name: "WhatsApp", accountId: "100", pageId: "110" }], capabilities: { prepare: true, publish: true, optimize: true, catalog: true, whatsapp: true }, errors: [] };
  const provider: MetaAdsProviderPort = {
    discover: async () => { calls.push("discover"); return structuredClone(discovery); }, existingCampaigns: async () => [],
    snapshot: async () => ({ campaignId: "200", status: "PAUSED", effectiveStatus: "PAUSED", budget: { daily_budget: "2000" }, targeting: {}, adSetId: "300", adIds: ["500"], creativeIds: ["400"] }),
    prepare: async () => { calls.push("prepare"); return { status: "remote_paused", objects: [{ type: "campaign", id: "200" }, { type: "ad_set", id: "300" }, { type: "ad", id: "500" }] }; },
    execute: async () => { calls.push("execute"); return { status: "remote_paused", objects: [{ type: "campaign", id: "200" }] }; },
    reconcile: async () => ({ status: "remote_paused", objects: [{ type: "campaign", id: "200" }] }),
    metrics: async (_access, campaign, since, until) => ({ campaignId: campaign.id, currency: "BRL", since, until, timezone: "America/Sao_Paulo", attributionWindow: "7d_click+1d_view", spendCents: 2000, attributedRevenueCents: 10000, attributedPurchases: 1, conversations: 0 }),
  };
  const redirect = "https://dashboard.example.test/meta-ads/callback";
  const oauth: MetaOAuthPort = { configured: () => true, authorizationUrl: state => `${redirect}?state=${state}`, exchange: async () => { calls.push("exchange"); return { accessToken: "scoped-test-token", scopes: ["ads_mcp_management", "ads_management", "catalog_management"], expiresAt: "2026-12-01T00:00:00Z" }; } };
  const codec = new CredentialCodec(Buffer.alloc(32, 9).toString("base64"));
  return { ...db, repo, commerce, provider, discovery, oauth, codec, redirect, calls, clock: () => now, setNow: (value: string) => { now = new Date(value); }, setPlan: (value: typeof plan) => { plan = value; } };
}
