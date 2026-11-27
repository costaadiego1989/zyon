import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { MetaAdsCampaign, MetaAdsProduct } from "@zyon/shared-types";
import { CreativeReviewAdapter } from "./creative-review.adapter.js";
import { ImageGenerationAdapter } from "./image-generation.adapter.js";
import { applicationFixture } from "../application/__tests__/fixture.js";
import { GenerationService } from "../application/generation.service.js";
import { ConnectionService } from "../application/connection.service.js";
import { CampaignService } from "../application/campaign.service.js";
import { creditWallet } from "../application/credits.service.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6sAAAAASUVORK5CYII=";
const product: MetaAdsProduct = { productId: "product-a", variantId: "variant-a", name: "Produto", description: "Dados", sku: "A", imageUrl: "https://media.example.test/source.png", priceCents: 10000, currency: "BRL", stockQuantity: 5, active: true, storefrontUrl: "https://store.example.test/product-a", commercialVersion: "version-a" };
const env = { META_ADS_IMAGE_API_KEY: "test-key", META_ADS_IMAGE_SOURCE_HOSTS: "media.example.test" };
const compatible = { product_matches: true, observed_prices_cents: [10000], currency: "BRL", unverified_claims: false, uncertain: false };
function fixture(verdict: unknown = compatible, overrides: Record<string, unknown> = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = []; const saved: Buffer[] = [];
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/images/edits")) return new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 300 } }), { headers: { "x-request-id": "req-image" } });
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(verdict) }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 100 }, ...overrides }), { headers: { "x-request-id": "req-review" } });
  };
  const review = new CreativeReviewAdapter(env, request);
  const storage = { isConfigured: () => true, upload: async (buffer: Buffer) => { saved.push(buffer); return { url: "https://media.example.test/result.png", key: "result.png", bucket: "test" }; } };
  return { review, request, requests, saved, images: new ImageGenerationAdapter(env, storage, request, review) };
}
test("visual review binds compatible claims to the exact PNG and product version with separate model usage", async () => {
  const f = fixture(); const result = await f.review.review({ product, image: Buffer.from(png, "base64") });
  assert.equal(result.status, "verified"); assert.equal(result.productVersion, "version-a"); assert.equal(result.imageSha256, createHash("sha256").update(Buffer.from(png, "base64")).digest("hex"));
  assert.deepEqual(result.usage, { provider: "openai", model: "gpt-6.1-sol", providerRequestId: "req-review", inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, costMicros: "3000", currency: "USD", costStatus: "estimated" });
  const body = JSON.parse(String(f.requests[0].init?.body)); assert.equal(f.requests[0].url, "https://api.openai.com/v1/responses"); assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true);
  const images = body.input[1].content.filter((part: Record<string, unknown>) => part.type === "input_image"); assert.equal(images[0].image_url, product.imageUrl); assert.equal(images[1].image_url, `data:image/png;base64,${png}`);
});
test("visual review rejects conflicting prices, unauthorized claims and product mismatch; uncertainty stays unavailable", async () => {
  for (const [verdict, status] of [[{ ...compatible, observed_prices_cents: [1990] }, "rejected"], [{ ...compatible, unverified_claims: true }, "rejected"], [{ ...compatible, product_matches: false }, "rejected"], [{ ...compatible, uncertain: true }, "unavailable"]] as const) {
    const f = fixture(verdict); const result = await f.review.review({ product, image: Buffer.from(png, "base64") }); assert.equal(result.status, status); assert.equal(f.requests.length, 1);
  }
});
test("visual review fails closed on malformed, refused or incomplete output and missing usage stays unpriced", async () => {
  for (const [verdict, override] of [[{ ...compatible, product_matches: "true" }, {}], [compatible, { status: "incomplete" }], [compatible, { output: [{ type: "message", content: [{ type: "refusal", refusal: "private-provider-message" }] }] }]] as const) {
    const f = fixture(verdict, override); const result = await f.review.review({ product, image: Buffer.from(png, "base64") }); assert.equal(result.status, "unavailable"); assert.equal(JSON.stringify(result).includes("private-provider-message"), false); assert.equal(f.requests.length, 1);
  }
  const missing = await fixture(compatible, { usage: null }).review.review({ product, image: Buffer.from(png, "base64") }); assert.equal(missing.usage.costMicros, null); assert.equal(missing.usage.inputTokens, null); assert.equal(missing.usage.costStatus, "unpriced");
});
test("image pipeline never stores an output with incompatible visual commercial claims", async () => {
  const f = fixture({ ...compatible, observed_prices_cents: [1990] });
  const result = await f.images.generate({ merchantId: "store-a", generationId: "generation-a", imageIndex: 0, product, brief: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: null, mediaIds: [], headline: "Produto", primaryText: "Conheca", country: "BR" } });
  assert.equal(result.status, "failed"); assert.equal(result.error, "creative_terms_mismatch"); assert.equal(result.url, null); assert.equal(f.saved.length, 0); assert.equal(result.reviewUsage!.length, 1); assert.equal(result.reviewUsage![0].costMicros, "3000"); assert.equal(f.requests.length, 2);
});
test("generation credits refund rejected visual output while both paid model attempts remain recorded", async () => {
  const db = await applicationFixture(); try {
    db.commerce.products = async () => [product]; const f = fixture({ ...compatible, unverified_claims: true });
    const campaign: MetaAdsCampaign = { id: "campaign-a", createdByAgent: true, managed: true, remoteCampaignId: null, remoteAdSetId: null, remoteAdIds: [], status: "draft", products: [product], createdAt: "2026-11-14T12:00:00Z", updatedAt: "2026-11-14T12:00:00Z", draft: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: null, mediaIds: [], headline: "Produto", primaryText: "Conheca", country: "BR" } };
    await db.repo.mutate("store-a", [], state => { state.campaigns[campaign.id] = campaign; return { result: null }; });
    const service = new GenerationService(db.repo, db.commerce, f.images, db.clock, () => "generation-a"); const submitted = await service.request("store-a", campaign.id, { imageCount: 1, idempotencyKey: "visual-a" }); const result = await service.run("store-a", submitted.id);
    assert.equal(result.status, "failed"); assert.equal(creditWallet(await db.repo.read("store-a"), db.clock()).monthlyAvailable, 30); assert.deepEqual(result.mediaIds, []);
    const records = await db.repo.listRecords<{ component: string; usage: { costMicros: string | null } }>("store-a", "usage"); assert.equal(records.length, 2); assert.deepEqual(records.map(record => record.payload.component).sort(), ["creative_review", "image_generation"]); assert.equal(records.every(record => record.payload.usage.costMicros !== null), true);
  } finally { await db.close(); }
});

test("MGA-87 campaign preparation accepts a reviewed image and rejects a mismatched visual certificate", async () => {
  const db = await applicationFixture(); try {
    let sequence = 0; db.commerce.products = async () => [product]; const f = fixture();
    const connection = new ConnectionService(db.repo, db.commerce, db.oauth, db.codec, db.provider, db.redirect, db.clock);
    const authorization = await connection.begin("store-a", "owner-a"); await connection.complete("store-a", "owner-a", new URL(authorization.authorizationUrl).searchParams.get("state")!, "code");
    await connection.select("store-a", { accountId: "100", pageId: "110", datasetId: "120" });
    const campaigns = new CampaignService(db.repo, db.commerce, connection, db.provider, db.clock, () => `campaign-${++sequence}`);
    const campaign = await campaigns.create("store-a", { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: { amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null }, mediaIds: [], headline: "Produto", primaryText: "Conheca", country: "BR" }, "create-a");
    const generation = new GenerationService(db.repo, db.commerce, f.images, db.clock, () => `image-${++sequence}`);
    const submitted = await generation.request("store-a", campaign.id, { imageCount: 1, idempotencyKey: "generate-a" }); const generated = await generation.run("store-a", submitted.id);
    await campaigns.save("store-a", campaign.id, { ...campaign.draft, mediaIds: generated.mediaIds });
    assert.equal((await campaigns.assertReady("store-a", campaign.id)).ready, true);
    const saved = (await db.repo.read("store-a")).media[generated.mediaIds[0]];
    assert.equal(saved.commercialReview!.imageSha256, createHash("sha256").update(Buffer.from(png, "base64")).digest("hex"));
    assert.equal(saved.commercialReview!.productVersion, "version-a");
    await db.repo.mutate("store-a", [], state => { state.media[saved.id].commercialReview!.status = "rejected"; return { result: null }; });
    await assert.rejects(campaigns.assertReady("store-a", campaign.id), { code: "creative_terms_mismatch" });
    assert.equal(db.calls.includes("prepare"), false);
  } finally { await db.close(); }
});
