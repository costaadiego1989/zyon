import test from "node:test";
import assert from "node:assert/strict";
import { MetaNativeAssetsService } from "./meta-native-assets.service.js";

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
