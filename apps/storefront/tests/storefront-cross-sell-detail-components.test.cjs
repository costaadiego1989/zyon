const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.resolve(__dirname, "../src");
function runtime() {
  const cache = new Map(), slots = [], refs = [], effects = [], deps = [], events = []; let cursor = 0;
  const react = { ...require("react"), useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return refs[i] ??= { current: initial }; },
    useEffect(fn, next) { const i = cursor++; if (!deps[i] || !next || next.some((v, n) => v !== deps[i][n])) { deps[i] = next; effects.push(fn); } }, useMemo: fn => fn(), useCallback: fn => fn };
  function load(file) {
    file = path.isAbsolute(file) ? file : path.join(root, file); if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = id => {
      if (id === "react") return react;
      if (id === "@/lib/cart-store") return { useCart: () => ({ cart: { items: [] } }) };
      if (id.endsWith(".css")) return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : String(key) });
      if (id === "server-only") return {};
      if (id.startsWith("@/") || id.startsWith(".")) { const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id); const target = [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")].find(p => fs.existsSync(p) && fs.statSync(p).isFile()); if (!target) throw new Error(id); return load(target); }
      return require(id);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, URL, Date, Intl, structuredClone, process: { env: {} }, window: { dispatchEvent: e => events.push(e), setTimeout: () => 0, clearTimeout() {} }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, document: { getElementById: () => null } })(localRequire, module, module.exports); return module.exports;
  }
  return { load, events, render(fn) { cursor = 0; return fn(); }, flush() { for (const fn of effects.splice(0)) fn(); } };
}
function nodes(node, predicate, found = []) { if (!node || typeof node !== "object") return found; if (predicate(node)) found.push(node); for (const child of [node.props?.children].flat(Infinity)) nodes(child, predicate, found); return found; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function fixture() {
  const r = runtime(), api = r.load("lib/storefront-cross-sell-detail.ts"), source = { id: "blue", productId: "product", name: "Target", price: 100, priceFormatted: "R$100", inStock: true, promoId: "promo" };
  const context = api.createCrossSellDetailContext({ merchantId: "store", cartId: "cart", conversationId: "cart" }, source, "rich");
  const purchase = { productName: "Target", defaultVariantId: "red", images: [], optionGroups: [{ id: "extra", name: "Extras", required: true, selectionType: "single", items: [{ id: "extra-a", name: "A", priceModifierInCents: 1500 }] }],
    variants: ["red", "blue"].map(id => ({ id, attributes: { color: id }, available: true, priceReais: id === "red" ? 10 : 100, currency: "BRL", lowStock: false })) };
  const calls = [], offers = new Map(), acceptedResults = []; let current = true, result = true, refuse = false, acceptGate = null, finishAccept;
  const identity = p => JSON.stringify([p.id, [...(p.selectedOptionItemIds ?? [])].sort()]);
  const financial = { context, scopeKey: "revision1", isCurrent: () => current,
    async prepare(products) { calls.push(["quote", copy(products)]); if (refuse) return; for (const p of products) offers.set(identity(p), { ...p, price: 103.5, priceFormatted: "R$ 103,50", acceptanceStatus: "ready", expectedQuote: { proof: identity(p) } }); },
    present(products) { return products.flatMap(p => offers.has(identity(p)) ? [offers.get(identity(p))] : []); },
    async accept(p, guard) { calls.push(["accept", copy(p)]); if (acceptGate) await acceptGate; const accepted = guard() && result; acceptedResults.push(accepted); return accepted; } };
  const Renderer = r.load("components/blocks/RichProductContentRenderer.tsx").default;
  const render = () => r.render(() => Renderer({ blocks: [], faqs: [], testimonials: [], videos: [], purchase, immersive: true, productId: "product", financialPurchase: financial }));
  return { ...r, render, purchase, financial, calls, acceptedResults, setCurrent(v) { current = v; }, fail() { result = false; }, refuseQuotes() { refuse = true; },
    deferAcceptance() { acceptGate = new Promise(resolve => { finishAccept = resolve; }); }, finishAcceptance() { finishAccept(); } };
}
const cta = tree => nodes(tree, n => n.props?.["data-aacp-rich-product-add-to-cart"] !== undefined)[0];
test("existing detail seeds the recommended SKU, keeps required options empty and never exposes its raw base price", () => {
  const f = fixture(), tree = f.render(); f.flush();
  assert.equal(nodes(tree, n => n.type === "input" && n.props.value === "blue")[0].props.checked, true);
  assert.equal(nodes(tree, n => n.props?.["data-aacp-product-total"] !== undefined)[0].props.children, "Escolha as opções");
  assert.equal(cta(tree).props.disabled, true); assert.equal(f.calls.length, 0);
});
test("existing addition control obtains quote before enabling the unchanged CTA, then bypasses ordinary chat events", async () => {
  const f = fixture(); let tree = f.render(); f.flush();
  const options = nodes(tree, n => typeof n.type === "function" && n.props?.onToggle)[0]; options.props.onToggle(f.purchase.optionGroups[0], "extra-a");
  tree = f.render(); assert.equal(cta(tree).props.disabled, true); f.flush(); await Promise.resolve();
  tree = f.render(); assert.equal(cta(tree).props.disabled, false); assert.equal(nodes(tree, n => n.props?.["data-aacp-product-total"] !== undefined)[0].props.children, "R$ 103,50");
  cta(tree).props.onClick(); await Promise.resolve(); tree = f.render();
  assert.equal(cta(tree).props.disabled, true); assert.equal(f.calls[1][0], "accept"); assert.deepEqual(f.calls[1][1].selectedOptionItemIds, ["extra-a"]); assert.deepEqual(f.events, []);
});
test("changing variant invalidates the previous quote synchronously and requests exact new SKU rather than default", async () => {
  const f = fixture(); f.purchase.optionGroups = []; let tree = f.render(); f.flush(); await Promise.resolve(); tree = f.render();
  const oldClick = cta(tree).props.onClick;
  nodes(tree, n => n.type === "input" && n.props.value === "red")[0].props.onChange(); oldClick();
  tree = f.render(); assert.equal(cta(tree).props.disabled, true); assert.equal(f.calls.filter(c => c[0] === "accept").length, 0); f.flush(); await Promise.resolve();
  tree = f.render(); assert.equal(cta(tree).props.disabled, false); assert.equal(f.calls.at(-1)[1][0].id, "red");
});
test("failed/unknown financial accept locks existing controls without a timer retry or ordinary price fallback", async () => {
  const f = fixture(); f.purchase.optionGroups = []; f.fail(); let tree = f.render(); f.flush(); await Promise.resolve(); tree = f.render(); cta(tree).props.onClick(); await Promise.resolve();
  tree = f.render(); assert.equal(cta(tree).props.disabled, true); assert.ok(nodes(tree, n => n.props?.role === "alert").length); cta(tree).props.onClick();
  assert.equal(f.calls.filter(c => c[0] === "accept").length, 1); assert.deepEqual(f.events, []);
});
test("session/navigation invalidation disables a previously quoted detail before acceptance", async () => {
  const f = fixture(); f.purchase.optionGroups = []; f.render(); f.flush(); await Promise.resolve(); f.setCurrent(false);
  const tree = f.render(); assert.equal(cta(tree).props.disabled, true); cta(tree).props.onClick(); assert.equal(f.calls.filter(c => c[0] === "accept").length, 0);
});
test("completed quote refusal becomes an explicit unavailable price/disabled CTA, not indefinite loading or public base price", async () => {
  const f = fixture(); f.purchase.optionGroups = []; f.refuseQuotes(); f.render(); f.flush(); await new Promise(resolve => setImmediate(resolve));
  const tree = f.render(); assert.equal(cta(tree).props.disabled, true);
  assert.equal(nodes(tree, n => n.props?.["data-aacp-product-total"] !== undefined)[0].props.children, "Oferta indisponível");
  assert.deepEqual(f.events, []);
});
test("same-key context replacement during ACK cannot revive the old renderer guard through its latest props", async () => {
  const f = fixture(); f.purchase.optionGroups = []; f.deferAcceptance(); f.render(); f.flush(); await Promise.resolve();
  let tree = f.render(); cta(tree).props.onClick();
  const previous = f.financial.context; f.financial.context = { ...previous }; assert.equal(previous.key, f.financial.context.key);
  f.render(); f.finishAcceptance(); await new Promise(resolve => setImmediate(resolve)); tree = f.render();
  assert.deepEqual(f.acceptedResults, [false]); assert.equal(cta(tree).props.disabled, true); assert.deepEqual(f.events, []);
});

// Explicit hook/transport doubles: UI state contracts only, not browser,
// backend promotion eligibility, HTTP authentication or financial SQL evidence.
function checkoutFixture() {
  const r = runtime(), calls = [], quotes = [], closes = []; let current = true, result = { ok: true }, gate = null, release;
  const purchase = { productName: "Checkout target", defaultVariantId: "red", images: [],
    optionGroups: [{ id: "extra", name: "Extras", required: true, selectionType: "single", items: [{ id: "extra-a", name: "A", priceModifierInCents: 1500 }] }],
    variants: ["blue", "red"].map(id => ({ id, sku: id.toUpperCase(), attributes: { color: id }, available: true, priceReais: 100, currency: "BRL", lowStock: false })) };
  const request = { key: "checkout-key", merchantId: "merchant", sessionId: "checkout", suggestionId: "suggestion", productId: "product", initialVariantId: "blue", initialSku: "BLUE",
    isCurrent: () => current,
    async prepare(selection) { calls.push(["quote", copy(selection)]); if (gate) await gate;
      const quote = { pricing: { targets: [{ maximumUnitPriceCents: 5400 }] } }; quotes.push(quote); return quote; },
    async accept(quote, guard) { calls.push(["accept", quote]); return guard() ? result : { ok: false }; } };
  const checkout = { request, close: () => closes.push("close") }, Renderer = r.load("components/blocks/RichProductContentRenderer.tsx").default;
  const render = () => r.render(() => Renderer({ blocks: [], faqs: [], testimonials: [], videos: [], purchase, immersive: true, productId: "product", checkoutPurchase: checkout }));
  return { ...r, render, checkout, purchase, calls, quotes, closes, setCurrent(v) { current = v; }, review() { result = { ok: false, committedRequiresReview: true, error: "O complemento foi incluído. Confira o carrinho antes de pagar. Não adicione novamente." }; },
    deferQuote() { gate = new Promise(resolve => { release = resolve; }); }, releaseQuote() { release(); } };
}
async function checkoutChoice(f) {
  let tree = f.render(); f.flush(); nodes(tree, node => typeof node.type === "function" && node.props?.onToggle)[0].props.onToggle(f.purchase.optionGroups[0], "extra-a");
  tree = f.render(); f.flush(); await new Promise(resolve => setImmediate(resolve)); return f.render();
}
test("checkout detail reuses existing required options and selected recommendation, without ordinary price/default submission", () => {
  const f = checkoutFixture(), tree = f.render(); f.flush();
  assert.equal(nodes(tree, node => node.type === "input" && node.props.value === "blue")[0].props.checked, true);
  assert.equal(cta(tree).props.disabled, true); assert.equal(nodes(tree, node => node.props?.["data-aacp-product-total"] !== undefined)[0].props.children, "Escolha as opções");
  assert.deepEqual(f.calls, []); assert.deepEqual(f.events, []);
});
test("checkout detail prepares the exact selected identities and accepts the displayed quote through its existing CTA", async () => {
  const f = checkoutFixture(); let tree = await checkoutChoice(f);
  assert.equal(cta(tree).props.disabled, false); assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0], ["quote", { variantId: "blue", sku: "BLUE", quantity: 1, selectedOptionItemIds: ["extra-a"] }]);
  assert.match(nodes(tree, node => node.props?.["data-aacp-product-total"] !== undefined)[0].props.children, /54,00/);
  cta(tree).props.onClick(); await Promise.resolve(); tree = f.render();
  assert.equal(f.calls[1][0], "accept"); assert.equal(f.calls[1][1], f.quotes[0]); assert.equal(cta(tree).props.disabled, true); assert.deepEqual(f.events, []);
});
test("checkout variant changes invalidate old click synchronously and prepare the selected variant's own SKU", async () => {
  const f = checkoutFixture(); let tree = await checkoutChoice(f), oldClick = cta(tree).props.onClick;
  nodes(tree, node => node.type === "input" && node.props.value === "red")[0].props.onChange(); oldClick();
  tree = f.render(); assert.equal(cta(tree).props.disabled, true); assert.equal(f.calls.filter(call => call[0] === "accept").length, 0);
  f.flush(); await Promise.resolve(); tree = f.render(); assert.equal(cta(tree).props.disabled, false); assert.equal(f.calls.at(-1)[1].sku, "RED");
});
test("checkout committed review locks repeat acceptance, displays explicit notice and returns to the same checkout", async () => {
  const f = checkoutFixture(); f.review(); let tree = await checkoutChoice(f); cta(tree).props.onClick(); await Promise.resolve(); tree = f.render();
  assert.equal(cta(tree).props.disabled, true); assert.ok(nodes(tree, node => node.props?.role === "alert").length); cta(tree).props.onClick();
  assert.equal(f.calls.filter(call => call[0] === "accept").length, 1);
  nodes(tree, node => node.type === "button" && node.props.children === "Confira o carrinho")[0].props.onClick();
  assert.deepEqual(f.closes, ["close"]); assert.deepEqual(f.events, []);
});
test("checkout host invalidation prevents an old displayed quote becoming a normal cart event", async () => {
  const f = checkoutFixture(); await checkoutChoice(f); f.setCurrent(false); const tree = f.render();
  assert.equal(cta(tree).props.disabled, true); cta(tree).props.onClick(); assert.equal(f.calls.filter(call => call[0] === "accept").length, 0); assert.deepEqual(f.events, []);
});
test("late checkout quote from a replaced same-key request cannot enable the new selection", async () => {
  const f = checkoutFixture(); f.deferQuote(); let tree = f.render(); f.flush();
  nodes(tree, node => typeof node.type === "function" && node.props?.onToggle)[0].props.onToggle(f.purchase.optionGroups[0], "extra-a");
  f.render(); f.flush(); f.checkout.request = { ...f.checkout.request }; f.render(); f.releaseQuote(); await new Promise(resolve => setImmediate(resolve));
  tree = f.render(); assert.equal(cta(tree).props.disabled, true); assert.deepEqual(f.events, []);
});
