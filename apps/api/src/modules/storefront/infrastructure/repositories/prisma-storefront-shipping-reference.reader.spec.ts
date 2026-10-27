import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaStorefrontShippingReferenceReader } from "./prisma-storefront-shipping-reference.reader.js";
import type { StorefrontLocalCartCommercialOutcomeV1 } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import type { OwnDeliveryConfig } from "../../../shipping/domain/ports/own-delivery-config.port.js";

function fixture() {
  const scope = { merchantId: "merchant", cartId: "conversation", conversationId: "conversation", buyerId: "buyer" };
  const cart = { id: "cart-row", merchantId: "merchant", sessionId: "conversation", items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Synthetic", quantity: 2, unitPriceCents: 1000 }],
    total: 2000, discount: 0, freeShipping: false, couponCode: null as string | null, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 3600000) };
  const config: OwnDeliveryConfig = { id: "config", merchantId: "merchant", enabled: true, mode: "neighborhood", flatPriceCents: null, freeAboveCents: null,
    neighborhoods: [{ name: "Saved district", priceCents: 900 }], radiusZones: null, estimatedValue: 1, estimatedUnit: "days" };
  const product = { id: "variant", sku: "SKU", isActive: true, weightGrams: 700, heightCm: 8, widthCm: 10, lengthCm: 12,
    product: { id: "product", merchantId: "merchant", type: "physical", isActive: true, deletedAt: null } };
  const address = { id: "address", globalUserId: "buyer", zip: "01310100", street: "Synthetic", number: "10", complement: null,
    neighborhood: "Saved district", city: "Synthetic", state: "SP" };
  const outcome: StorefrontLocalCartCommercialOutcomeV1 = { version: 1, discountCents: 0, freeShipping: false, quote: {
    currency: "BRL", originalSubtotalCents: 2000, promotionDiscountCents: 0, subtotalCents: 2000, merchandiseTotalCents: 2000,
    items: [{ variantId: "variant", productId: "product", quantity: 2, baseUnitPriceCents: 1000, unitPriceCents: 1000 }] } };
  const state = { bound: false, missing: false, carrierEnabled: false, writes: 0, commercial: 0, addresses: [address], queries: [] as unknown[] };
  const tx = { async $executeRaw(sql: TemplateStringsArray) { state.queries.push(sql.join("?")); return 0; }, async $queryRaw(sql: TemplateStringsArray) {
    const text = sql.join("?"); state.queries.push(text); if (text.includes("jsonb_agg")) return [{ isolation: "read committed", candidates: [] }];
    if (text.includes("clock_timestamp()")) return [{ now: new Date() }];
    if (text.includes("FROM merchants")) return [{ id: "merchant" }]; return [];
  }, storefrontCart: { async findUnique(input: unknown) { state.queries.push(input); return state.missing ? null : structuredClone(cart); }, async upsert() { state.writes++; throw new Error("no_write"); }, async update() { state.writes++; throw new Error("no_write"); } },
    productVariant: { async findMany() { return [structuredClone(product)]; } }, couponRedemption: { async findFirst() { return null; } },
    merchant: { async findUnique() { return { id: "merchant", melhorEnvioEnabled: state.carrierEnabled, storeSettings: { company: { address: { zip: "01001000", city: "Synthetic", state: "SP" } } } }; } },
    ownDeliveryConfig: { async findUnique() { return structuredClone(config); } }, merchantRule: { async findUnique() { return { merchantId: "merchant", originZip: "01001000" }; } },
    buyerAddress: { async findMany(input: unknown) { state.queries.push(input); return structuredClone(state.addresses); } },
  };
  const client = { async $transaction<T>(work: (value: typeof tx) => Promise<T>) { return work(tx); } } as unknown as PrismaClient;
  const reader = new PrismaStorefrontShippingReferenceReader(client, { async commercial(received, receivedScope) {
    assert.equal(received, tx); assert.deepEqual(receivedScope, { merchantId: "merchant", cartId: "conversation" });
    state.commercial++; return structuredClone(outcome);
  }, async bound() { return state.bound; } });
  return { scope, cart, config, product, address, state, reader, outcome };
}
test("reader uses existing owned cart and same-tx commercial authority, exact variant quantity/dimensions and saved same-CEP address", async () => {
  const f = fixture(), result = await f.reader.read(f.scope, { zipCode: "01310100" }); assert.equal(result.kind, "ready", JSON.stringify({ result, queries: f.state.queries, commercial: f.state.commercial }));
  if (result.kind !== "ready") return;
  assert.equal(result.cartTotalCents, 2000); assert.equal(result.destinationNeighborhood, "Saved district"); assert.equal(result.addressSource, "saved_buyer_address");
  assert.deepEqual(result.packages, [{ weightKg: 0.7, heightCm: 8, widthCm: 10, lengthCm: 12, quantity: 2 }]);
  assert.equal(f.state.writes, 0); assert.equal(f.state.commercial, 1);
  assert.ok(f.state.queries.some(query => JSON.stringify(query).includes('"globalUserId":"buyer"')));
});
for (const fault of ["missing", "expired", "empty", "foreign-cart", "foreign-product", "changed-product", "bound", "coupon", "free-shipping"] as const)
  test(`reader refuses ${fault} without creating/repricing/renewing the cart`, async () => {
    const f = fixture();
    if (fault === "missing") f.state.missing = true;
    if (fault === "expired") f.cart.expiresAt = new Date(0);
    if (fault === "empty") f.cart.items = [];
    if (fault === "foreign-cart") f.cart.merchantId = "foreign";
    if (fault === "foreign-product") f.product.product.merchantId = "foreign";
    if (fault === "changed-product") f.product.product.id = "foreign";
    if (fault === "bound") f.state.bound = true;
    if (fault === "coupon") f.cart.couponCode = "existing";
    if (fault === "free-shipping") f.cart.freeShipping = true;
    assert.equal((await f.reader.read(f.scope, { zipCode: "01310100" })).kind, "unavailable"); assert.equal(f.state.writes, 0);
  });
for (const fault of ["anonymous", "missing", "foreign", "another-cep", "ambiguous"] as const)
  test(`neighborhood requires unique canonical owned same-CEP address: ${fault}`, async () => {
    const f = fixture(), scope: typeof f.scope | Omit<typeof f.scope, "buyerId"> = { ...f.scope };
    if (fault === "anonymous") Reflect.deleteProperty(scope, "buyerId");
    if (fault === "missing") f.state.addresses = [];
    if (fault === "foreign") f.state.addresses[0]!.globalUserId = "foreign";
    if (fault === "another-cep") f.state.addresses[0]!.zip = "01001000";
    if (fault === "ambiguous") f.state.addresses.push({ ...f.address, id: "second" });
    const result = await f.reader.read(scope, { zipCode: "01310100" }); assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") assert.ok(["address_required", "address_ambiguous"].includes(result.reason));
  });
test("missing catalog dimensions never become a default box; flat manual tariff does not require a fabricated package", async () => {
  const f = fixture(); f.product.weightGrams = 0; f.config.mode = "flat"; f.config.flatPriceCents = 900;
  const manual = await f.reader.read(f.scope, { zipCode: "01310100" }); assert.equal(manual.kind, "ready");
  if (manual.kind === "ready") assert.equal(manual.packages, undefined);
  f.config.enabled = false; const carrier = await f.reader.read(f.scope, { zipCode: "01310100" });
  assert.deepEqual(carrier, { kind: "unavailable", reason: "dimensions_required" });
});
test("product-only request cannot fabricate a cart or choose the first variant", async () => {
  const f = fixture(); const result = await f.reader.read(f.scope, { productId: "product", zipCode: "01310100" });
  assert.deepEqual(result, { kind: "unavailable", reason: "product_selection_required" }); assert.equal(f.state.writes, 0);
});

test("hybrid reader retains canonical saved locality when available and permits carrier-only reference otherwise", async () => {
  const f = fixture(); f.state.carrierEnabled = true;
  const covered = await f.reader.read(f.scope, { zipCode: "01310100" });
  assert.equal(covered.kind, "ready");
  if (covered.kind === "ready") { assert.equal(covered.destinationNeighborhood, "Saved district"); assert.equal(covered.carrierEnabled, true); }
  f.state.addresses = [];
  const carrier = await f.reader.read(f.scope, { zipCode: "01310100" });
  assert.equal(carrier.kind, "ready");
  if (carrier.kind === "ready") { assert.equal(carrier.addressSource, "requested_cep"); assert.equal(carrier.destinationNeighborhood, undefined); assert.ok(carrier.packages?.length); }
  assert.equal(f.state.writes, 0);
});
