const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.resolve(__dirname, "../src/lib");
function load(relative, cache = new Map()) {
  const filename = path.resolve(root, relative); if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = id => id.startsWith(".") ? load(id.replace(/\.js$/, "") + ".ts", cache) : require(id);
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, URL, URLSearchParams, Date, BigInt, Intl, structuredClone })(localRequire, module, module.exports);
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const scope = { merchantId: "store", cartId: "cart", conversationId: "cart" };
const source = { id: "recommended-blue", productId: "product", name: "Target", price: 100, priceFormatted: "R$ 100,00", promoId: "promo", inStock: true };
const purchase = () => ({ productName: "Canonical target", defaultVariantId: "default-red", priceReais: 10,
  variants: [{ id: "default-red", attributes: { color: "Red" }, available: true, priceReais: 10, currency: "BRL", lowStock: false },
    { id: "recommended-blue", attributes: { color: "Blue", size: "G" }, available: true, priceReais: 100, currency: "BRL", lowStock: false }],
  images: [], optionGroups: [{ id: "extras", name: "Extras", required: true, selectionType: "single", items: [{ id: "size", name: "Large", priceModifierInCents: 1500 }] }] });
test("detail seed preserves exact recommended variant and scoped product/promotion without inventing a default", () => {
  const api = load("storefront-cross-sell-detail.ts"), context = api.createCrossSellDetailContext(scope, source, "inline");
  assert.equal(context.initialVariantId, "recommended-blue"); assert.equal(context.productId, "product");
  assert.equal(context.scope.cartId, "cart"); assert.equal(source.id, "recommended-blue");
  assert.throws(() => api.createCrossSellDetailContext(scope, { ...source, productId: undefined }, "inline"));
});
test("required additions are never inferred; exact recommended SKU plus explicit IDs becomes a fresh candidate", () => {
  const api = load("storefront-cross-sell-detail.ts"), context = api.createCrossSellDetailContext(scope, source, "inline");
  assert.equal(api.selectCrossSellDetailCandidate(context, purchase(), "recommended-blue", []).kind, "incomplete");
  const chosen = api.selectCrossSellDetailCandidate(context, purchase(), "recommended-blue", ["size"]);
  assert.equal(chosen.kind, "selected"); assert.equal(chosen.product.id, "recommended-blue");
  assert.deepEqual(plain(chosen.product.selectedOptionItemIds), ["size"]); assert.match(chosen.product.name, /Blue/);
});
test("no-option explicit SKU remains a valid direct candidate without adding an options step", () => {
  const api = load("storefront-cross-sell-detail.ts"), context = api.createCrossSellDetailContext(scope, source, "rich");
  const content = purchase(); content.optionGroups = [];
  const chosen = api.selectCrossSellDetailCandidate(context, content, context.initialVariantId, []);
  assert.equal(chosen.kind, "selected"); assert.equal(chosen.product.id, "recommended-blue");
});
test("close/reopen same offer has equal routing key but never revives the old navigation authority", () => {
  const api = load("storefront-cross-sell-detail.ts"), first = api.createCrossSellDetailContext(scope, source, "inline"), reopened = api.createCrossSellDetailContext(scope, source, "inline");
  const state = { ...scope, context: first, productId: source.productId, blocked: false };
  assert.equal(api.isCrossSellDetailCurrent(first, state), true); state.productId = null;
  assert.equal(api.isCrossSellDetailCurrent(first, state), false);
  state.context = reopened; state.productId = reopened.productId; assert.equal(first.key, reopened.key);
  assert.equal(api.isCrossSellDetailCurrent(first, state), false); assert.equal(api.isCrossSellDetailCurrent(reopened, state), true);
  for (const change of [{ merchantId: "other" }, { cartId: "other" }, { conversationId: "other" }, { blocked: true }]) assert.equal(api.isCrossSellDetailCurrent(reopened, { ...state, ...change }), false);
});
test("reload/Forward before marker readiness cannot render an ordinary purchase; unrelated explicit visit remains ordinary", () => {
  const api = load("storefront-cross-sell-detail.ts");
  assert.equal(api.crossSellDetailRequiresRecovery(false, null, "product"), true);
  assert.equal(api.crossSellDetailRequiresRecovery(true, "product", "product"), true);
  assert.equal(api.crossSellDetailRequiresRecovery(true, "other-product", "product"), false);
  assert.equal(api.crossSellDetailRequiresRecovery(true, null, "product"), false);
});
test("navigation preserves Next history fields, clears inherited marker only on the NEW entry and retains marked Back/Forward entry", () => {
  const api = load("storefront-navigation.ts");
  const first = { __NA: true, tree: { privateNext: true }, aacpCrossSellDetailProduct: "product", aacpView: true };
  let current = first, url = "https://fixture.invalid/?show=content&product=product"; const entries = [first], events = [];
  const window = { history: { get state() { return current; }, pushState(state, _, next) { entries.push(state); current = state; url = new URL(next, url).href; } },
    location: { get href() { return url; }, get pathname() { return new URL(url).pathname; }, get search() { return new URL(url).search; }, get hash() { return new URL(url).hash; } }, dispatchEvent: e => events.push(e) };
  const file = path.resolve(__dirname, "../src/lib/hooks/useStorefrontNavigation.ts"), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { window, Event: class { constructor(type) { this.type = type; } } })(id => id === "react" ? { useCallback: fn => fn, useEffect: () => {}, useState: fn => [fn(), () => {}] } : api, module, module.exports);
  module.exports.useStorefrontNavigation("?show=content&product=product").setProduct({ productId: "other-product" });
  assert.equal(current.aacpCrossSellDetailProduct, undefined); assert.equal(current.__NA, true); assert.equal(current.tree, first.tree);
  assert.equal(entries[0].aacpCrossSellDetailProduct, "product"); current = entries[0]; assert.equal(current.aacpCrossSellDetailProduct, "product");
  current = entries[1]; assert.equal(current.aacpCrossSellDetailProduct, undefined); assert.equal(events.length, 1);
});
for (const mode of ["missing-recommended", "unknown-variant", "unknown-option", "duplicate-option", "not-available"]) test(`detail refuses ${mode} rather than replacing by default/base purchase`, () => {
  const api = load("storefront-cross-sell-detail.ts"), context = api.createCrossSellDetailContext(scope, source, "interstitial"), content = purchase();
  let variantId = "recommended-blue", ids = ["size"];
  if (mode === "missing-recommended") content.variants.pop();
  if (mode === "unknown-variant") variantId = "foreign";
  if (mode === "unknown-option") ids = ["foreign"];
  if (mode === "duplicate-option") ids = ["size", "size"];
  if (mode === "not-available") content.variants[1].available = false;
  assert.equal(api.selectCrossSellDetailCandidate(context, content, variantId, ids).kind, "unavailable");
});
