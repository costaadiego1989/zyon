import test from "node:test";
import assert from "node:assert/strict";
import { MetaUiCapabilitiesAdapter } from "./meta-ui-capabilities.adapter.js";

test("catalog credentials stay tenant-scoped and cached discovery never retains stale publication proof", async t => {
  const config: any = { id: "config", merchantId: "merchant", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    credentials: { accessToken: "whatsapp-only", catalogAccessToken: "catalog-only", wabaId: "12345", phoneNumberId: "45678" } };
  let reads = 0, proofReads = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    reads++;
    const products = String(url).includes("/products?");
    assert.equal(init.headers.Authorization, products ? "Bearer catalog-only" : "Bearer whatsapp-only");
    return Response.json({ data: products ? [{ retailer_id: "variant" }] : String(url).includes("/product_catalogs?") ? [{ id: "78901" }] : [] });
  });
  const prisma: any = { whatsAppNativeAsset: { findMany: async (input: any) => {
    assert.equal(input.where.merchantId, "merchant"); assert.equal(input.where.configId, "config");
    assert.equal(input.where.status, "published"); assert.ok(input.where.retryAfter.gt instanceof Date);
    proofReads++;
    return proofReads === 1 ? [
      { name: "variant", sourceHash: `price:1000;catalog:78901;v2:${"a".repeat(64)}` },
      { name: "foreign-catalog", sourceHash: `price:50;catalog:99999;v2:${"a".repeat(64)}` },
      { name: "legacy-unbound", sourceHash: "price:1" },
    ] : [];
  } } };
  const adapter = new MetaUiCapabilitiesAdapter({ findById: async () => config } as any, undefined, prisma);
  const first = await adapter.get("merchant", "META_CLOUD:config");
  assert.deepEqual(first.catalogRetailerIds, { variant: "variant" });
  assert.deepEqual(first.catalogPrices, { variant: 1000 });
  const count = reads;
  const second = await adapter.get("merchant", "META_CLOUD:config");
  assert.equal(reads, count); assert.equal(proofReads, 2);
  assert.deepEqual(second.catalogPrices, {});
  assert.deepEqual(first.catalogPrices, { variant: 1000 }, "an earlier response must not be mutated");
  assert.deepEqual((await adapter.get("foreign", "META_CLOUD:config")).catalogRetailerIds, {});
  assert.equal(reads, count); assert.equal(proofReads, 2);
});

test("a separate catalog credential never authorizes a disconnected WhatsApp connection", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("disconnected channel cannot call Meta"));
  const adapter = new MetaUiCapabilitiesAdapter({ findById: async () => ({ merchantId: "merchant", enabled: false,
    status: "DISCONNECTED", provider: "META_CLOUD", credentials: { accessToken: "old", catalogAccessToken: "catalog", wabaId: "12345", phoneNumberId: "45678" } }) } as any);
  assert.deepEqual((await adapter.get("merchant", "META_CLOUD:config")).catalogRetailerIds, {});
});
