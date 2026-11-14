const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../src/lib");
function load(relative, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = id => id.startsWith(".") ? load(id.replace(/\.js$/, "") + ".ts", cache) : require(id);
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, URL, Date, BigInt, Intl, structuredClone })(localRequire, module, module.exports);
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const scope = { merchantId: "store", cartId: "cart", conversationId: "cart" };
const product = () => ({ id: "added", productId: "product-added", name: "Produto [variantId:foreign]", price: 100,
  priceFormatted: "R$ 100,00", inStock: true, promoId: "promo", discountPercent: 99 });
function quote() {
  return { version: 1, merchantId: "store", cartId: "cart", variantId: "added", productId: "product-added", sku: "sku-added",
    promotionId: "promo", promotionUpdatedAt: "2026-10-19T00:00:00.000Z", quantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000,
    cartBasis: { items: [{ variantId: "existing", productId: "product-existing", sku: "sku-existing", name: "Existing", quantity: 1, unitPriceCents: 10000 }],
      total: 10000, discount: 0, couponCode: null, freeShipping: false },
    quote: { currency: "BRL", originalSubtotalCents: 20000, promotionDiscountCents: 1000, subtotalCents: 19000, merchandiseTotalCents: 18500,
      items: [{ variantId: "existing", productId: "product-existing", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 10000 },
        { variantId: "added", productId: "product-added", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }] } };
}
function cart() { return { cartId: "cart", items: [{ variantId: "existing", productName: "Existing", quantity: 1, price: 100, subtotal: 100 },
  { variantId: "added", productName: "Product", quantity: 1, price: 90, subtotal: 90 }], itemCount: 2, subtotal: 190, total: 185, discount: 5, freeShipping: false }; }
function optionQuote() {
  const value = quote(), option = itemId => ({ groupId: "extras", groupName: "Extras", itemId, itemName: itemId, priceModifierInCents: itemId === "target-size" ? 1500 : 500 });
  value.cartBasis.items[0].selectedOptions = [option("size")]; value.cartBasis.items[0].unitPriceCents = 10500;
  value.cartBasis.items.push({ ...value.cartBasis.items[0], selectedOptions: [option("color")] }); value.cartBasis.total = 21000;
  value.selectedOptionItemIds = ["target-size"]; value.selectedOptions = [option("target-size")];
  value.originalUnitPriceCents = 11500; value.maximumUnitPriceCents = 10350;
  value.quote = { currency: "BRL", originalSubtotalCents: 32500, promotionDiscountCents: 1150, subtotalCents: 31350, merchandiseTotalCents: 30850,
    items: value.cartBasis.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: 1,
      selectedOptionItemIds: item.selectedOptions.map(option => option.itemId), baseUnitPriceCents: 10500, unitPriceCents: 10500 })).concat([
      { variantId: "added", productId: "product-added", quantity: 1, selectedOptionItemIds: ["target-size"], baseUnitPriceCents: 11500, unitPriceCents: 10350 }]) };
  return value;
}
function optionCart() {
  const expected = optionQuote();
  return { cartId: "cart", items: expected.quote.items.map(item => ({ variantId: item.variantId, productName: "Option product",
    quantity: item.quantity, price: item.unitPriceCents / 100, subtotal: item.unitPriceCents / 100,
    optionItemIds: item.selectedOptionItemIds, selectedOptions: (item.variantId === "added" ? expected.selectedOptions
      : expected.cartBasis.items.find(line => line.selectedOptions[0].itemId === item.selectedOptionItemIds[0]).selectedOptions) })),
    itemCount: 3, subtotal: 313.5, total: 308.5, discount: 5, freeShipping: false };
}
function fixture(overrides = {}) {
  const calls = [], applied = [];
  let current = true;
  const transport = { async quote(s, selection) { calls.push(["quote", plain(s), plain(selection)]); return quote(); },
    async accept(s, expected) { calls.push(["accept", plain(s), plain(expected)]); return { version: 1, status: "accepted", merchantId: "store", cartId: "cart" }; },
    async getCart(s) { calls.push(["get", plain(s)]); return cart(); },
    applyCart(snapshot) { applied.push(plain(snapshot)); }, ...overrides };
  const { StorefrontCrossSellBuyerFlow } = load("storefront-cross-sell-flow.ts");
  const flow = new StorefrontCrossSellBuyerFlow(scope, transport, () => current);
  return { flow, calls, applied, changeScope() { current = false; } };
}
test("financial card is unavailable until a server quote, then displays its exact capped unit price", async () => {
  const f = fixture();
  assert.deepEqual(plain(f.flow.present([product()])), []);
  await f.flow.prepare([product(), product()]);
  const [shown] = f.flow.present([product()]);
  assert.equal(shown.price, 90); assert.equal(shown.discountPercent, 10);
  assert.match(shown.priceFormatted, /90,00/);
  assert.deepEqual(plain(shown.expectedQuote), quote());
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.applied, []);
});
test("unquoted bound candidate can only open existing details, without a raw benefit or monetary offer", () => {
  const f = fixture(), candidate = f.flow.browse([product()])[0];
  assert.equal(candidate.readOnlyCandidate, true); assert.equal(candidate.expectedQuote, undefined);
  assert.equal(candidate.discountPercent, undefined); assert.equal(candidate.priceFormatted, "Confira os detalhes");
  assert.equal(f.flow.browse([{ ...product(), productId: undefined }]).length, 0);
});
test("detail navigation changed during acceptance cannot GET/apply another surface or replay its command", async () => {
  let finish, active = true;
  const f = fixture({ async accept() { f.calls.push(["accept"]); await new Promise(resolve => { finish = resolve; });
    return { version: 1, status: "accepted", merchantId: "store", cartId: "cart" }; } });
  await f.flow.prepare([product()]); const shown = f.flow.present([product()])[0];
  const pending = f.flow.accept(shown, () => active); active = false; finish();
  assert.equal(await pending, false); assert.equal(await f.flow.accept(shown), false);
  assert.deepEqual(f.calls.map(call => call[0]), ["quote", "accept"]); assert.deepEqual(f.applied, []);
});
for (const boundary of ["ACK", "GET"]) test(`same-offer close/reopen ABA during ${boundary} never applies/replays the old acceptance`, async () => {
  let finish, reached; const first = {}, reopened = {}; let active = first;
  const started = new Promise(resolve => { reached = resolve; });
  const wait = () => new Promise(resolve => { finish = resolve; reached(); });
  const f = fixture({ async accept() { f.calls.push(["accept"]); if (boundary === "ACK") await wait(); return { version: 1, status: "accepted", merchantId: "store", cartId: "cart" }; },
    async getCart() { f.calls.push(["get"]); if (boundary === "GET") await wait(); return cart(); } });
  await f.flow.prepare([product()]); const shown = f.flow.present([product()])[0], pending = f.flow.accept(shown, () => active === first);
  await started; active = null; active = reopened; finish();
  assert.equal(await pending, false); assert.equal(await f.flow.accept(shown), false); assert.deepEqual(f.applied, []);
  assert.equal(f.calls.filter(call => call[0] === "accept").length, 1);
});
test("one displayed offer click sends the exact frozen quote once, then commits only matching server cart", async () => {
  const f = fixture(); await f.flow.prepare([product()]);
  const [shown] = f.flow.present([product()]);
  assert.equal(await f.flow.accept(shown), true);
  assert.deepEqual(f.calls.map(call => call[0]), ["quote", "accept", "get"]);
  assert.deepEqual(f.calls[1][2], quote()); assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].total, 185); assert.equal(f.applied[0].discount, 5);
});

test("explicit target selection and repeated optioned basis lines roundtrip through the real coordinator without a base-only price", async () => {
  const f = fixture({ async quote(s, selection) { f.calls.push(["quote", plain(s), plain(selection)]); return optionQuote(); },
    async getCart() { f.calls.push(["get"]); return optionCart(); } });
  const selected = { ...product(), selectedOptionItemIds: ["target-size"] };
  await f.flow.prepare([selected]); const [shown] = f.flow.present([selected]);
  assert.equal(shown.price, 103.5); assert.deepEqual(f.calls[0][2].selectedOptionItemIds, ["target-size"]);
  assert.equal(await f.flow.accept(shown), true); assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].items.length, 3); assert.equal(f.applied[0].total, 308.5);
});
for (const invalid of ["duplicate-option-line", "missing-target-options", "option-id-alias-mismatch"]) test(`accepted financial GET rejects ${invalid} without applying or replaying`, async () => {
  const f = fixture({ async quote() { return optionQuote(); }, async getCart() {
    const value = optionCart();
    if (invalid === "duplicate-option-line") value.items[1] = structuredClone(value.items[0]);
    if (invalid === "missing-target-options") { delete value.items[2].selectedOptions; delete value.items[2].optionItemIds; }
    if (invalid === "option-id-alias-mismatch") value.items[2].optionItemIds = ["foreign"];
    return value;
  } });
  const selected = { ...product(), selectedOptionItemIds: ["target-size"] };
  await f.flow.prepare([selected]); const [shown] = f.flow.present([selected]);
  assert.ok(shown); assert.equal(await f.flow.accept(shown), false); assert.equal(await f.flow.accept(shown), false);
  assert.deepEqual(f.applied, []); assert.equal(f.calls.filter(call => call[0] === "accept").length, 1);
});
test("parallel clicks and all placements cannot add the same target twice", async () => {
  const f = fixture(); await f.flow.prepare([product()]); const [shown] = f.flow.present([product()]);
  const results = await Promise.all(Array.from({ length: 20 }, () => f.flow.accept(shown)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(f.calls.filter(call => call[0] === "accept").length, 1); assert.equal(f.applied.length, 1);
});
for (const status of [409, 422, 401, 503, undefined]) test(`failed/unknown acceptance ${status} never retries, calls chat or falls back to full price`, async () => {
  const f = fixture({ async accept() { f.calls.push(["accept"]); throw Object.assign(new Error("synthetic"), { status }); } });
  await f.flow.prepare([product()]); const [shown] = f.flow.present([product()]);
  assert.equal(await f.flow.accept(shown), false); assert.equal(await f.flow.accept(shown), false);
  assert.deepEqual(f.calls.map(call => call[0]), ["quote", "accept"]); assert.deepEqual(f.applied, []);
  assert.ok(f.flow.present([product()])[0].acceptanceError);
});
for (const [label, mutate] of [
  ["price", p => p.expectedQuote.maximumUnitPriceCents--], ["identity", p => p.id = "foreign"],
  ["coupon", p => p.couponCode = "EXTRA"], ["missing quote", p => delete p.expectedQuote],
]) test(`client cannot turn altered displayed ${label} into a grant`, async () => {
  const f = fixture(); await f.flow.prepare([product()]); const [shown] = f.flow.present([product()]);
  mutate(shown); assert.equal(await f.flow.accept(shown), false);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.applied, []);
});
test("unsupported coupon quote and foreign server identity never become an enabled financial card", async () => {
  const f = fixture({ async quote() { return { ...quote(), merchantId: "foreign" }; } });
  await f.flow.prepare([product(), { ...product(), id: "coupon", couponCode: "CODE" }]);
  assert.deepEqual(plain(f.flow.present([product()])), []);
});
for (const [label, mutate] of [
  ["quantity", c => c.items[1].quantity++], ["unit price", c => c.items[1].price = 100],
  ["total", c => c.total++], ["discount", c => c.discount++], ["cart identity", c => c.cartId = "other"],
]) test(`accepted ACK plus mismatched GET ${label} never mutates local cart or repeats POST`, async () => {
  const f = fixture({ async getCart() { f.calls.push(["get"]); const value = cart(); mutate(value); return value; } });
  await f.flow.prepare([product()]); const [shown] = f.flow.present([product()]);
  assert.equal(await f.flow.accept(shown), false); assert.equal(await f.flow.accept(shown), false);
  assert.deepEqual(f.applied, []); assert.equal(f.calls.filter(call => call[0] === "accept").length, 1);
});
test("a changed conversation during acceptance never updates its replacement cart", async () => {
  let finish;
  const f = fixture({ async accept() { f.calls.push(["accept"]); await new Promise(resolve => finish = resolve);
    return { version: 1, status: "accepted", merchantId: "store", cartId: "cart" }; } });
  await f.flow.prepare([product()]); const work = f.flow.accept(f.flow.present([product()])[0]);
  f.changeScope(); finish(); assert.equal(await work, false);
  assert.deepEqual(f.calls.map(call => call[0]), ["quote", "accept"]); assert.deepEqual(f.applied, []);
});

test("changing a candidate/response object after preparation cannot rewrite the frozen displayed offer", async () => {
  const source = quote(), input = product();
  const f = fixture({ async quote() { f.calls.push(["quote"]); return source; } });
  await f.flow.prepare([input]);
  source.maximumUnitPriceCents = 1; input.price = 1; input.discountPercent = 100;
  const [shown] = f.flow.present([input]);
  assert.equal(shown.price, 90); assert.equal(shown.discountPercent, 10);
  assert.equal(shown.expectedQuote.maximumUnitPriceCents, 9000);
  assert.equal(await f.flow.accept(shown), true);
});

test("a scope changed while quote is pending cannot expose a replacement-conversation offer", async () => {
  let finish;
  const f = fixture({ async quote() { await new Promise(resolve => finish = resolve); return quote(); } });
  const work = f.flow.prepare([product()]); f.changeScope(); finish(); await work;
  assert.deepEqual(plain(f.flow.present([product()])), []); assert.deepEqual(f.applied, []);
});

test("a malformed candidate does not query authority or suppress a valid distinct offer", async () => {
  const f = fixture();
  await f.flow.prepare([{ ...product(), id: "" }, product()]);
  assert.equal(f.calls.length, 1); assert.equal(f.flow.present([product()]).length, 1);
});
