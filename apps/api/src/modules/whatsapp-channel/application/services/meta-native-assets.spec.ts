import test from "node:test";
import assert from "node:assert/strict";
import { MetaNativeAssetsService } from "./meta-native-assets.service.js";

test("catalog sync refreshes stock, photos, price and catalog identity using only the dedicated catalog credential", async t => {
  const rows = new Map<string, any>(), writes: any[] = [];
  let catalogId = "78901";
  const variant: any = { id: "variant", product: { name: "Mouse", description: "Mouse sem fio", metadata: { brand: "Logitech" } },
    price: { currency: "BRL", basePriceInCents: 6990 }, stock: [{ quantity: 3, reserved: 1 }], media: [{ url: "https://cdn.example/mouse.jpg" }] };
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).includes("/products")) {
      assert.equal(init.headers.Authorization, "Bearer catalog-only");
      writes.push({ catalogId, payload: JSON.parse(init.body) });
      return Response.json({ id: "provider-product" });
    }
    assert.equal(init.headers.Authorization, String(url).includes("/product_catalogs?") ? "Bearer catalog-only" : "Bearer whatsapp-only");
    return Response.json({ data: String(url).includes("/flows?") ? [
      { id: "10000", name: "zyon_registration_v1", status: "PUBLISHED" }, { id: "20000", name: "zyon_address_v1", status: "PUBLISHED" },
    ] : [{ id: catalogId }] });
  });
  const delegate = {
    upsert: async (input: any) => { const key = `${input.create.kind}:${input.create.name}`; if (!rows.has(key)) rows.set(key, { id: key, ...input.create }); return rows.get(key); },
    update: async (input: any) => { const row = rows.get(input.where.id); Object.assign(row, input.data); return row; },
  };
  const prisma: any = { whatsAppNativeAsset: delegate, merchant: { findUnique: async () => ({ name: "Athom", storeSlug: "athom" }) },
    productVariant: { findMany: async (input: any) => { assert.equal(input.where.product.merchantId, "merchant"); return [variant]; } },
    $transaction: (fn: any) => fn({ $queryRaw: async () => [{ locked: true }] }) };
  const config = { id: "config", merchantId: "merchant", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    credentials: { accessToken: "whatsapp-only", catalogAccessToken: "catalog-only", wabaId: "12345", phoneNumberId: "45678" } };
  const service = new MetaNativeAssetsService(prisma, { findById: async () => config } as any);
  await service.ensure("merchant", "config");
  assert.equal(writes.length, 1); assert.equal(writes[0].payload.inventory, 2);
  assert.equal(writes[0].payload.retailer_id, "variant"); assert.equal(writes[0].payload.price, 6990);
  assert.equal(writes[0].payload.brand, "Logitech");
  const firstHash = rows.get("catalog_product:variant").sourceHash;
  assert.match(firstHash, /^price:6990;catalog:78901;v2:[a-f0-9]{64}$/);
  await service.ensure("merchant", "config"); assert.equal(writes.length, 1, "unchanged catalog products need no repeat upsert");
  variant.stock = [{ quantity: 1, reserved: 1 }];
  await service.ensure("merchant", "config"); assert.equal(writes.length, 2);
  assert.equal(writes[1].payload.availability, "out of stock"); assert.equal(writes[1].payload.inventory, 0);
  variant.media[0].url = "https://cdn.example/new.jpg";
  await service.ensure("merchant", "config"); assert.equal(writes.length, 3);
  assert.equal(writes[2].payload.image_url, variant.media[0].url);
  variant.price.basePriceInCents = 7990;
  await service.ensure("merchant", "config"); assert.equal(writes.length, 4); assert.equal(writes[3].payload.price, 7990);
  catalogId = "89012";
  await service.ensure("merchant", "config"); assert.equal(writes.length, 5);
  assert.match(rows.get("catalog_product:variant").sourceHash, /^price:7990;catalog:89012;/);
  assert.equal(rows.get("catalog:storefront").providerId, catalogId);
  await service.ensure("foreign", "config"); assert.equal(writes.length, 5);
});

test("an unknown Flow creation is durable and is never blindly recreated", async t => {
  let creates = 0; const rows = new Map<string, any>();
  t.mock.method(globalThis, "fetch", async (url: any, init?: any) => {
    if (init?.method === "POST") { creates++; return Response.json({ error: { code: 1 } }, { status: 503 }); }
    return Response.json({ data: [] });
  });
  const delegate = {
    upsert: async (input: any) => { const key = input.create.name; if (!rows.has(key)) rows.set(key, { id: key, ...input.create }); return rows.get(key); },
    update: async (input: any) => { const row = rows.get(input.where.id); Object.assign(row, input.data); return row; },
  };
  const prisma: any = { whatsAppNativeAsset: delegate, $transaction: (fn: any) => fn({ $queryRaw: async () => [{ locked: true }] }) };
  const config = { id: "config", merchantId: "merchant", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    credentials: { accessToken: "test-only", wabaId: "12345", phoneNumberId: "45678", registrationStatus: "REGISTERED", subscriptionStatus: "SUBSCRIBED" } };
  const service = new MetaNativeAssetsService(prisma, { findById: async () => config } as any);
  await service.ensure("merchant", "config");
  assert.equal(creates, 2); assert.equal(rows.get("zyon_registration_v1").status, "create_unknown");
  for (const row of rows.values()) row.retryAfter = new Date(0);
  await service.ensure("merchant", "config");
  assert.equal(creates, 2); assert.equal(rows.get("storefront").lastError, "catalog_not_linked");
  await service.ensure("foreign-merchant", "config"); assert.equal(creates, 2);
});

test("a schema upgrade repairs existing failed drafts without creating duplicate provider resources", async t => {
  const rows = new Map<string, any>(["zyon_registration_v1", "zyon_address_v1"].map((name, index) => [name,
    { id: name, configId: "config", merchantId: "merchant", kind: "flow", name, providerId: String(index + 100), sourceHash: "retired-schema",
      status: "unavailable", lastError: "meta_native_flow_validation_failed", retryAfter: new Date(Date.now() + 3600_000) }]));
  let uploads = 0, creates = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init?: any) => {
    if (init?.method === "POST" && String(url).endsWith("/assets")) {
      const json = JSON.parse(await init.body.get("file").text()); assert.equal(json.version, "7.3"); uploads++;
      return Response.json({ success: true, validation_errors: [] });
    }
    if (init?.method === "POST" && String(url).endsWith("/publish")) return Response.json({ success: true });
    if (init?.method === "POST") { creates++; assert.fail("known provider IDs must be reused"); }
    return Response.json({ data: String(url).includes("/flows?") ? [...rows.values()].map(row => ({ id: row.providerId, name: row.name, status: "DRAFT" })) : [] });
  });
  const delegate = {
    upsert: async (input: any) => { const key = input.create.name; if (!rows.has(key)) rows.set(key, { id: key, ...input.create }); return rows.get(key); },
    update: async (input: any) => { const row = rows.get(input.where.id); Object.assign(row, input.data); return row; },
  };
  const prisma: any = { whatsAppNativeAsset: delegate, $transaction: (fn: any) => fn({ $queryRaw: async () => [{ locked: true }] }) };
  const config = { id: "config", merchantId: "merchant", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    credentials: { accessToken: "test-only", wabaId: "12345", phoneNumberId: "45678", registrationStatus: "REGISTERED", subscriptionStatus: "SUBSCRIBED" } };
  await new MetaNativeAssetsService(prisma, { findById: async () => config } as any).ensure("merchant", "config");
  assert.equal(uploads, 2); assert.equal(creates, 0);
  for (const name of ["zyon_registration_v1", "zyon_address_v1"]) assert.equal(rows.get(name).status, "published");
});
