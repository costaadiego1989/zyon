import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsCampaign, MetaAdsProduct } from "@zyon/shared-types";
import type { GeneratedImageResult, ImageGenerationPort, ImageUsage } from "../domain/types.js";
import { applicationFixture } from "./__tests__/fixture.js";
import { creditWallet } from "./credits.service.js";
import { GenerationService } from "./generation.service.js";

const product: MetaAdsProduct = { productId: "product-a", variantId: "variant-a", name: "Produto", description: "Dados de produto", sku: "A", imageUrl: "https://media.example.test/source.png", priceCents: 10000, currency: "BRL", stockQuantity: 9, active: true, storefrontUrl: "https://store.example.test/store/loja?product=product-a", commercialVersion: "version-a" };
const usage = (index: number): ImageUsage => ({ provider: "openai", model: "gpt-image-2.5-flare-2026-09-08", providerRequestId: `req-${index}`, inputTextTokens: 100, inputImageTokens: 200, outputImageTokens: 300, costMicros: "11100", currency: "USD", costStatus: "estimated" });
async function fixture(outcomes: Array<GeneratedImageResult["status"]> = ["succeeded"]) {
  const f = await applicationFixture(); const calls: Parameters<ImageGenerationPort["generate"]>[0][] = []; let sequence = 0;
  f.commerce.products = async () => [structuredClone(product)];
  const campaign: MetaAdsCampaign = { id: "campaign-a", createdByAgent: true, managed: true, remoteCampaignId: null, remoteAdSetId: null, remoteAdIds: [], status: "draft", createdAt: "2026-11-14T12:00:00Z", updatedAt: "2026-11-14T12:00:00Z", products: [product], draft: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: null, mediaIds: [], headline: "Produto", primaryText: "Conheca", country: "BR" } };
  await f.repo.mutate("store-a", [], state => { state.campaigns[campaign.id] = structuredClone(campaign); return { result: null }; });
  const images: ImageGenerationPort = { configured: () => true, generate: async input => {
    const index = calls.length; calls.push(structuredClone(input)); const status = outcomes[index] ?? "failed";
    return { status, url: status === "succeeded" ? `https://media.example.test/image-${index}.png` : null, usage: usage(index), error: status === "succeeded" ? null : "provider-details-not-public" };
  } };
  const service = new GenerationService(f.repo, f.commerce, images, f.clock, () => `id-${++sequence}`);
  const request = (count = outcomes.length, key = "request-a") => service.request("store-a", "campaign-a", { imageCount: count, idempotencyKey: key });
  const wallet = async () => creditWallet(await f.repo.read("store-a"), f.clock());
  return { ...f, service, images, calls, request, wallet, campaign };
}
test("MGA-30 duplicate generation requests and concurrent workers produce one durable result and debit", async () => {
  const f = await fixture(); try {
    const submitted = await Promise.all(Array.from({ length: 8 }, () => f.request()));
    assert.equal(new Set(submitted.map(result => result.id)).size, 1);
    await Promise.all(Array.from({ length: 8 }, () => f.service.run("store-a", submitted[0].id)));
    const repeated = await f.request(); assert.equal(repeated.status, "succeeded"); assert.equal(repeated.mediaIds.length, 1); assert.equal(f.calls.length, 1); assert.equal((await f.wallet()).monthlyAvailable, 29);
    assert.equal((await f.repo.listRecords("store-a", "usage")).length, 1);
  } finally { await f.close(); }
});
test("MGA-31 failed generations without usable output return commercial credits", async () => {
  const f = await fixture(["failed", "failed"]); try { const generation = await f.request(); const result = await f.service.run("store-a", generation.id); assert.equal(result.status, "failed"); assert.deepEqual(result.mediaIds, []); assert.equal((await f.wallet()).monthlyAvailable, 30); assert.equal((await f.wallet()).reserved, 0); assert.equal((await f.repo.listRecords("store-a", "usage")).length, 2); } finally { await f.close(); }
});
test("MGA-32 unknown results retain only their attempted reservation and are never automatically sent again", async () => {
  const f = await fixture(["unknown"]); try {
    const generation = await f.request(5); const result = await f.service.run("store-a", generation.id);
    assert.equal(result.status, "unknown"); assert.equal((await f.wallet()).monthlyAvailable, 29); assert.equal((await f.wallet()).reserved, 1);
    await f.service.run("store-a", generation.id); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test("MGA-33 partial generation exposes persisted images and consumes only their credits", async () => {
  const f = await fixture(["succeeded", "succeeded", "failed", "failed", "failed"]); try {
    const generation = await f.request(); const result = await f.service.run("store-a", generation.id);
    assert.equal(result.status, "partial"); assert.equal(result.mediaIds.length, 2); assert.equal((await f.wallet()).monthlyAvailable, 28); assert.equal((await f.wallet()).reserved, 0);
    const stored = await f.repo.read("store-a"); assert.deepEqual(result.mediaIds.map(id => stored.media[id].url), ["https://media.example.test/image-0.png", "https://media.example.test/image-1.png"]);
  } finally { await f.close(); }
});
test("MGA-37 saved previews retain their product identity and frozen commercial version", async () => {
  const f = await fixture(); try {
    const generation = await f.request(); f.commerce.products = async () => [{ ...product, commercialVersion: "new-version", priceCents: 20000 }];
    const result = await f.service.run("store-a", generation.id); const saved = (await f.repo.read("store-a")).media[result.mediaIds[0]];
    assert.equal(saved.productId, "product-a"); assert.equal(saved.variantId, "variant-a"); assert.equal(saved.productVersion, "version-a"); assert.equal(f.calls[0].product.priceCents, 10000);
  } finally { await f.close(); }
});
test("MGA-38 each model attempt persists its own usage and cost state including failed and unknown results", async () => {
  const f = await fixture(["succeeded", "failed", "unknown"]); try {
    const generation = await f.request(); await f.service.run("store-a", generation.id);
    const records = await f.repo.listRecords<{ generationId: string; imageIndex: number; outcome: string; usage: ImageUsage }>("store-a", "usage");
    assert.equal(records.length, 3); assert.deepEqual(records.map(record => record.payload.outcome).sort(), ["failed", "succeeded", "unknown"]);
    for (const record of records) { assert.equal(record.payload.generationId, generation.id); assert.equal(record.payload.usage.costMicros, "11100"); assert.equal(record.payload.usage.costStatus, "estimated"); assert.equal(record.payload.usage.currency, "USD"); assert.equal(record.payload.usage.outputImageTokens, 300); }
  } finally { await f.close(); }
});
test("MGA-84 usage logs contain neither credentials, raw conversations nor direct buyer identifiers", async () => {
  const f = await fixture(); try {
    f.images.generate = async () => ({ status: "failed", url: null, error: "secret-token buyer@example.test 5511988887777", usage: { ...usage(0), rawConversation: "private buyer conversation", buyerEmail: "buyer@example.test", accessToken: "secret-token" } as ImageUsage });
    const generation = await f.request(); const result = await f.service.run("store-a", generation.id);
    const log = JSON.stringify(await f.repo.listRecords("store-a", "usage"));
    for (const secret of ["secret-token", "buyer@example.test", "5511988887777", "private buyer conversation"]) { assert.equal(log.includes(secret), false); assert.equal(JSON.stringify(result).includes(secret), false); }
  } finally { await f.close(); }
});
test("expired entitlement prevents queued paid work and releases reservations", async () => {
  const f = await fixture(); try {
    const generation = await f.request(); f.setPlan("starter"); const result = await f.service.run("store-a", generation.id);
    assert.equal(result.status, "failed"); assert.equal(f.calls.length, 0); assert.equal((await f.wallet()).reserved, 0); assert.equal((await f.wallet()).monthlyAvailable, 30);
  } finally { await f.close(); }
});

test("stalled work retains only the sent image and a late provider result closes its unknown state", async () => {
  const f = await fixture(); let resume = () => {}; let running: ReturnType<typeof f.service.run> | undefined;
  try {
    let started = () => {}; const startedPromise = new Promise<void>(resolve => { started = resolve; }); const delay = new Promise<void>(resolve => { resume = resolve; }); const generate = f.images.generate;
    f.images.generate = async input => { const result = await generate(input); started(); await delay; return result; };
    const submitted = await f.request(3); running = f.service.run("store-a", submitted.id); await startedPromise;
    f.setNow("2026-11-14T12:20:00Z"); const recovered = await f.service.recoverStalled("store-a", submitted.id, new Date("2026-11-14T12:10:00Z")); const reserved = await f.wallet();
    await f.service.run("store-a", submitted.id); resume(); const completed = await running;
    assert.equal(recovered.status, "unknown"); assert.equal(reserved.reserved, 1); assert.equal(reserved.monthlyAvailable, 29); assert.equal(f.calls.length, 1);
    assert.equal(completed.status, "partial"); assert.equal(completed.mediaIds.length, 1); assert.equal((await f.wallet()).reserved, 0);
    const costs = await f.repo.listRecords<{ outcome: string; usage: ImageUsage }>("store-a", "usage"); assert.equal(costs.some(record => record.payload.outcome === "unknown" && record.payload.usage.costStatus === "unpriced"), true);
  } finally { resume(); await running?.catch(() => {}); await f.close(); }
});

test("a reviewed provider result can release an unknown reservation without another generation", async () => {
  const f = await fixture(["unknown"]); try {
    const submitted = await f.request(); await f.service.run("store-a", submitted.id);
    const result = await f.service.reconcileResult("store-a", submitted.id, 0, { status: "failed", url: null, usage: usage(0), error: "failed-at-provider" }, { actorId: "operator-a", sha256: "a".repeat(64) });
    assert.equal(result.status, "failed"); assert.equal((await f.wallet()).monthlyAvailable, 30); assert.equal((await f.wallet()).reserved, 0); assert.equal(f.calls.length, 1);
    const records = await f.repo.listRecords<{ correctsUsageKey?: string }>("store-a", "usage"); assert.equal(records.some(record => Boolean(record.payload.correctsUsageKey)), true);
  } finally { await f.close(); }
});
