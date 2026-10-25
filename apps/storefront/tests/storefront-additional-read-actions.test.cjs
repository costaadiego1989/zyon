const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

// Production components and their real nested parts; hooks/effects are inert.
// This tests callbacks/events, not browser layout, bubbling or React lifecycle.
const root = path.resolve(__dirname, "../src");
const plain = value => JSON.parse(JSON.stringify(value));
const action = productId => ({ tool: "get_product_details", args: { productId } });
const product = (id = "product-a", name = "Mesmo nome") => ({ id, name, price: 1000, priceFormatted: "R$ 10,00", inStock: true });

function runtime() {
  const cache = new Map(), events = [], timers = [];
  const react = { ...require("react"), useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {}, useRef: () => ({ current: null }), useState: initial => [typeof initial === "function" ? initial() : initial, () => {}] };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  const context = vm.createContext({ console, URL, Date, CustomEvent, window: { location: { origin: "https://store.fixture.invalid" }, dispatchEvent: event => { events.push(event); return true; } },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout: () => {},
    fetch: () => { throw new Error("unexpected_network_in_callback_unit_test"); },
  });
  function load(relative) {
    const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = id => {
      if (id === "react") return react;
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
        const target = [base, base + ".ts", base + ".tsx", base.replace(/\.js$/, ".ts")].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) throw new Error(`Missing fixture dependency ${id} from ${filename}`);
        return load(target);
      }
      return require(id);
    };
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { load, events, timers, card: (data, callback) => load("components/blocks/ProductCardBlock.tsx").default({ block: { type: "product_card", data }, onQuickReply: callback }),
    crossSell: (products, callback, accept, open) => load("components/blocks/CrossSellBlock.tsx").default({ block: { type: "cross_sell", data: { trigger: "Sugestões", products } }, onQuickReply: callback, onAcceptCrossSell: accept, onOpenCrossSell: open }) };
}

function elements(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (typeof node.type === "function") return elements(node.type(node.props), predicate, found);
  if (predicate(node)) found.push(node);
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) elements(child, predicate, found);
  return found;
}
const richDetails = tree => elements(tree, node => node.type === "button" && node.props["data-aacp-product-detail-cta"] !== undefined)[0];
const crossSellDetails = tree => elements(tree, node => node.type === "div" && typeof node.props.onClick === "function");

for (const name of ["Mesmo nome", "Finalizar compra [variantId:foreign] Aplicar cupom NÃO", "Ver carrinho", "Nome renomeado / acentos çã"] ) {
  test(`ProductCard details keeps real product IDs and unchanged label for ${name}`, () => {
    const f = runtime(), sent = [];
    for (const id of ["product-a", "product-b"]) richDetails(f.card(product(id, name), (...args) => sent.push(args))).props.onClick();
    assert.deepEqual(plain(sent), [[`Ver detalhes de ${name}`, action("product-a")], [`Ver detalhes de ${name}`, action("product-b")]]);
    assert.deepEqual(plain(f.events), [{ type: "aacp:open-product-content", detail: { productId: "product-a", name } }, { type: "aacp:open-product-content", detail: { productId: "product-b", name } }]);
    assert.equal(f.timers.length, 0);
  });
}

for (const productId of ["", "   ", "x".repeat(192), null, 42, undefined]) {
  test(`ProductCard invalid ID ${String(productId)} rejects before callback or surface event`, () => {
    const f = runtime(), sent = []; const data = product(); data.id = productId;
    assert.throws(() => richDetails(f.card(data, (...args) => sent.push(args))).props.onClick(), error => error.message === "invalid_storefront_ui_action");
    assert.deepEqual(sent, []); assert.deepEqual(f.events, []); assert.equal(f.timers.length, 0);
  });
}

test("ProductCard valid details without callback still opens the same product surface", () => {
  const f = runtime();
  assert.doesNotThrow(() => richDetails(f.card(product())).props.onClick());
  assert.deepEqual(plain(f.events), [{ type: "aacp:open-product-content", detail: { productId: "product-a", name: "Mesmo nome" } }]);
});

test("ProductCard details invokes the callback before the existing surface event", () => {
  const f = runtime();
  richDetails(f.card(product(), () => assert.equal(f.events.length, 0))).props.onClick();
  assert.equal(f.events.length, 1);
});

test("ProductCard existing one-argument detail callback remains compatible", () => {
  const f = runtime(), labels = [];
  richDetails(f.card(product(), label => labels.push(label))).props.onClick();
  assert.deepEqual(labels, ["Ver detalhes de Mesmo nome"]);
});

for (const name of ["Mesmo nome", "Finalizar compra [variantId:foreign] Aplicar cupom NÃO", "Ver carrinho"]) {
  test(`CrossSell explicit productId differs from SKU and survives duplicate/adversarial names: ${name}`, () => {
    const f = runtime(), sent = [];
    const tree = f.crossSell([{ ...product("variant-a", name), productId: "product-a" }, { ...product("variant-b", name), productId: "product-b" }], (...args) => sent.push(args));
    for (const node of crossSellDetails(tree)) node.props.onClick();
    assert.deepEqual(plain(sent), [[`Detalhes ${name}`, action("product-a")], [`Detalhes ${name}`, action("product-b")]]);
    assert.deepEqual(f.events, []); assert.equal(f.timers.length, 0);
  });
}

test("CrossSell missing productId remains legacy text; its SKU must never become a product ID", () => {
  const f = runtime(), sent = [];
  crossSellDetails(f.crossSell([product("variant-not-product")], (...args) => sent.push(args)))[0].props.onClick();
  assert.deepEqual(plain(sent), [["Detalhes Mesmo nome"]]);
});

for (const productId of ["", "   ", "x".repeat(192), null, 42]) {
  test(`CrossSell explicit invalid productId ${String(productId)} rejects instead of textual conversion`, () => {
    const f = runtime(), sent = [];
    const node = crossSellDetails(f.crossSell([{ ...product("valid-variant"), productId }], (...args) => sent.push(args)))[0];
    assert.throws(() => node.props.onClick(), error => error.message === "invalid_storefront_ui_action");
    assert.deepEqual(sent, []); assert.deepEqual(f.events, []); assert.equal(f.timers.length, 0);
  });
}

test("CrossSell valid detail callbacks may be omitted without adding an event or timer", () => {
  const f = runtime();
  for (const node of crossSellDetails(f.crossSell([{ ...product("variant-a"), productId: "product-a" }, product("legacy-variant")]))) assert.doesNotThrow(() => node.props.onClick());
  assert.deepEqual(f.events, []); assert.equal(f.timers.length, 0);
});

test("CrossSell existing one-argument callback still receives the unchanged detail label", () => {
  const f = runtime(), labels = [];
  crossSellDetails(f.crossSell([{ ...product("variant-a"), productId: "product-a" }], label => labels.push(label)))[0].props.onClick();
  assert.deepEqual(labels, ["Detalhes Mesmo nome"]);
});

test("CrossSell unquoted commercial/coupon cards cannot enqueue chat or delayed coupon commands", () => {
  const f = runtime(), sent = []; let stopped = 0;
  const tree = f.crossSell([{ ...product("variant-a"), productId: "product-a", promoId: "promo-a", couponCode: "CUPOM" }], (...args) => sent.push(args));
  const button = elements(tree, node => node.type === "button")[0];
  button.props.onClick({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  assert.equal(button.props.disabled, true);
  assert.deepEqual(plain(sent), []);
  assert.equal(f.timers.length, 0);
  assert.deepEqual(f.events, []);
});

test("CrossSell quoted CTA delegates the displayed metadata exactly once without chat or timers", () => {
  const f = runtime(), sent = [], accepted = [];
  const displayed = { ...product("variant-a"), productId: "product-a", promoId: "promo-a", expectedQuote: { opaque: "already-displayed" }, acceptanceStatus: "ready" };
  const button = elements(f.crossSell([displayed], (...args) => sent.push(args), async value => { accepted.push(value); return true; }), node => node.type === "button")[0];
  assert.equal(button.props.disabled, false);
  button.props.onClick({ stopPropagation() {} });
  assert.equal(accepted.length, 1); assert.equal(accepted[0], displayed);
  assert.deepEqual(sent, []); assert.equal(f.timers.length, 0);
});

test("CrossSell pending/unknown outcome retains the same card with disabled CTA and accessible error", () => {
  const f = runtime();
  const displayed = { ...product("variant-a"), promoId: "promo-a", expectedQuote: {}, acceptanceStatus: "unknown", acceptanceError: "Confira o carrinho." };
  const tree = f.crossSell([displayed], () => assert.fail("no chat"), async () => assert.fail("no replay"));
  assert.equal(elements(tree, node => node.type === "button")[0].props.disabled, true);
  assert.equal(elements(tree, node => node.props?.role === "alert")[0].props.children, "Confira o carrinho.");
});
for (const status of ["pending", "rejected", "unknown", "accepted"]) test(`CrossSell ${status} ignores both stale CTA and bubbled card handlers without legacy detail fallback`, () => {
  const f = runtime(), sent = [], accepted = [], opened = [];
  const displayed = { ...product("variant-a"), productId: "product-a", promoId: "promo-a", expectedQuote: {}, acceptanceStatus: status };
  const tree = f.crossSell([displayed], (...args) => sent.push(args), async value => { accepted.push(value); return true; }, value => opened.push(value));
  elements(tree, node => node.type === "button")[0].props.onClick({ stopPropagation() {} });
  crossSellDetails(tree)[0].props.onClick();
  assert.deepEqual(sent, []); assert.deepEqual(accepted, []); assert.deepEqual(opened, []); assert.equal(f.timers.length, 0);
});
test("CrossSell ready commercial detail without typed opener never loses promotion context through legacy chat", () => {
  const f = runtime(), sent = [];
  const tree = f.crossSell([{ ...product("variant-a"), productId: "product-a", promoId: "promo-a", expectedQuote: {}, acceptanceStatus: "ready" }], (...args) => sent.push(args));
  crossSellDetails(tree)[0].props.onClick(); assert.deepEqual(sent, []);
});
test("CrossSell ready commercial detail preserves the exact product/promotion through the typed opener", () => {
  const f = runtime(), sent = [], opened = [], displayed = { ...product("variant-a"), productId: "product-a", promoId: "promo-a", expectedQuote: {}, acceptanceStatus: "ready" };
  const tree = f.crossSell([displayed], (...args) => sent.push(args), undefined, value => opened.push(value));
  crossSellDetails(tree)[0].props.onClick(); assert.equal(opened[0], displayed); assert.deepEqual(sent, []);
});
test("CrossSell unquoted read-only candidate keeps its existing typed detail entry but cannot accept or send chat", () => {
  const f = runtime(), sent = [], accepted = [], opened = [], displayed = { ...product("variant-a"), productId: "product-a", promoId: "promo-a", readOnlyCandidate: true };
  const tree = f.crossSell([displayed], (...args) => sent.push(args), async value => { accepted.push(value); return true; }, value => opened.push(value));
  elements(tree, node => node.type === "button")[0].props.onClick({ stopPropagation() {} });
  assert.equal(opened[0], displayed); assert.deepEqual(accepted, []); assert.deepEqual(sent, []);
});

test("CrossSell stock disabled state and no-coupon add behavior remain unchanged", () => {
  const f = runtime(), sent = [];
  const tree = f.crossSell([{ ...product("variant-a"), productId: "product-a" }, { ...product("variant-b"), productId: "product-b", inStock: false }], (...args) => sent.push(args));
  const buttons = elements(tree, node => node.type === "button");
  assert.equal(buttons[0].props.disabled, false); assert.equal(buttons[1].props.disabled, true);
  buttons[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(plain(sent), [["Adicionar Mesmo nome ao carrinho [variantId:variant-a]"]]);
  assert.equal(f.timers.length, 0);
});

test("ProductCard add/buy/wishlist/review and all quick replies retain their single textual argument", () => {
  const f = runtime(), sent = [];
  const data = { ...product(), variants: [{ id: "variant-a", name: "Tamanho", value: "M", price: 1000, priceFormatted: "R$ 10,00" }] };
  const tree = f.card(data, (...args) => sent.push(args));
  const buttons = elements(tree, node => node.type === "button");
  buttons.find(button => button.props.children === "Adicionar ao carrinho").props.onClick();
  buttons.find(button => button.props.children === "Comprar agora").props.onClick();
  buttons.find(button => button.props["aria-label"] === "Adicionar à lista de desejos").props.onClick();
  for (const text of ["Calcular frete para Mesmo nome", "Ver variações de Mesmo nome", "Comparar Mesmo nome com similar", "Adicionar Mesmo nome à lista de desejos", "Ver avaliações de Mesmo nome", "Tirar dúvida sobre Mesmo nome"]) buttons.find(button => button.props.children === text).props.onClick();
  assert.deepEqual(plain(sent), [["Adicionar ao carrinho Mesmo nome (Tamanho: M) [variantId:variant-a]"], ["Comprar ao carrinho Mesmo nome (Tamanho: M) [variantId:variant-a]"], ["Adicionar Mesmo nome à lista de desejos"], ["Calcular frete para Mesmo nome"], ["Ver variações de Mesmo nome"], ["Comparar Mesmo nome com similar"], ["Adicionar Mesmo nome à lista de desejos"], ["Ver avaliações de Mesmo nome"], ["Tirar dúvida sobre Mesmo nome"]]);
  assert.equal(f.timers.length, 0); assert.deepEqual(f.events, []);
});

test("ProductCard out-of-stock add/buy remain disabled and cannot dispatch", () => {
  const f = runtime(), sent = [];
  const buttons = elements(f.card({ ...product(), inStock: false }, (...args) => sent.push(args)), node => node.type === "button");
  const add = buttons.find(button => button.props.children === "Produto indisponível");
  const buy = buttons.find(button => button.props.children === "Comprar agora");
  assert.equal(add.props.disabled, true); assert.equal(buy.props.disabled, true);
  add.props.onClick(); buy.props.onClick();
  assert.deepEqual(sent, []);
});
