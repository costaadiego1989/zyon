const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../src"), checkout = path.resolve(__dirname, "../../../packages/checkout-ui/src");
const notice = (code = "discount_limit_reached", message = "Aviso confirmado pelo servidor.") => ({ version: 1, code, message });
const plain = value => JSON.parse(JSON.stringify(value));
function runtime() {
  const cache = new Map(), slots = [], refs = []; let cursor = 0;
  const react = { ...require("react"), useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn(),
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef: initial => { const index = cursor++; return refs[index] ??= { current: initial }; },
  };
  const context = vm.createContext({ console, URL, Date, setTimeout: () => 0, clearTimeout: () => {},
    process: { env: { NEXT_PUBLIC_API_BASE_URL: "https://api.fixture.invalid" } },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: () => { throw new Error("unexpected_notice_test_network"); } });
  function load(relative) {
    const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = id => {
      if (id === "react") return react;
      if (id === "@zyon/checkout-ui") return load(path.join(checkout, "index.ts"));
      if (id === "@/lib/api/api-client") return { cartApi: {} };
      if (id === "@/lib/conversation-access") return { ConversationSessionExpiredError: class extends Error {} };
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
        const target = [base, base + ".ts", base + ".tsx"].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        if (!target) throw new Error("missing_notice_source_dependency:" + id); return load(target);
      }
      return require(id);
    };
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { load, render: fn => { cursor = 0; return fn(); } };
}
function nodes(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (typeof node.type === "function") return nodes(node.type(node.props), predicate, found);
  if (predicate(node)) found.push(node);
  for (const child of [node.props?.children].flat(Infinity)) nodes(child, predicate, found);
  return found;
}
function text(node) { if (node == null || typeof node === "boolean") return ""; if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node !== "object") return String(node); if (typeof node.type === "function") return text(node.type(node.props)); return text(node.props?.children); }
test("browser notice guard accepts only strict known version/code and clones the complete group", () => {
  const parse = runtime().load("lib/commercial-notices.ts").parseCommercialNotices, input = [notice()];
  const result = parse(input); assert.deepEqual(plain(result), input); input[0].message = "mutated"; assert.notEqual(result[0].message, "mutated");
  for (const invalid of [undefined, null, {}, [{ ...notice(), version: 2 }], [{ ...notice(), code: "invented" }], [{ ...notice(), privateCost: 1 }],
    [notice(), { ...notice(), message: " " }], Array.from({ length: 6 }, () => notice())]) assert.deepEqual(plain(parse(invalid)), []);
});
for (const code of ["discount_limit_reached","discount_limited","discount_unavailable","benefit_not_combinable","benefit_conditions_not_met"]) {
  test(`real notice component uses explicit ${code} even with adversarial message words`, () => {
    const f = runtime(), Component = f.load("components/blocks/CommercialNotices.tsx").default;
    const tree = f.render(() => Component({ notices: [notice(code, "Frete grátis aplicado! Cupom máximo 99%")] }));
    const status = nodes(tree, node => node.props?.role === "status")[0]; assert.ok(status); assert.equal(status.props["aria-live"], "polite");
    assert.equal(nodes(tree, node => node.props?.["data-commercial-notice-code"] === code).length, 1);
    assert.equal(text(tree).includes("BENEFÍCIO ATIVO"), false); assert.equal(nodes(tree, node => node.type === "button").length, 0);
    assert.equal(f.render(() => Component({ notices: [{ ...notice(), version: 2 }] })), null);
  });
}
test("real CartSummary renders additive notice without fabricating applied-rule status", () => {
  const f = runtime(), Component = f.load("components/blocks/CartSummaryBlock.tsx").default;
  const tree = f.render(() => Component({ block: { type: "cart_summary", data: { items: [], itemCount: 0, total: 0, commercialNotices: [notice()] } } }));
  assert.ok(text(tree).includes(notice().message)); assert.equal(nodes(tree, node => node.props?.["data-commercial-notice-code"] === "discount_limit_reached").length, 1);
});
test("real cart store carries detached notices and clears them on missing metadata clear and tenant switch", () => {
  const f = runtime(), Provider = f.load("lib/cart-store.tsx").CartProvider;
  const view = merchantId => f.render(() => Provider({ merchantId, children: null })).props.value;
  const input = [notice()], block = { type: "cart_summary", data: { cartId: "cart", items: [], itemCount: 0, total: 0, commercialNotices: input } };
  view("merchant-a").updateFromBlocks([block]); input[0].message = "mutated";
  assert.equal(view("merchant-a").cart.commercialNotices[0].message, notice().message);
  assert.equal(view("merchant-b").cart.commercialNotices?.length ?? 0, 0);
  view("merchant-a").updateFromBlocks([{ ...block, data: { ...block.data, commercialNotices: undefined } }]);
  assert.equal(view("merchant-a").cart.commercialNotices?.length ?? 0, 0);
  view("merchant-a").updateFromBlocks([{ ...block, data: { ...block.data, commercialNotices: [notice()] } }]); view("merchant-a").clearCart();
  assert.equal(view("merchant-a").cart.commercialNotices?.length ?? 0, 0);
});
test("real shared drawer shows validated notice and preserves checkout button handler and enabled state", () => {
  const f = runtime(), Sheet = f.load(path.join(checkout, "CartSheet.tsx")).CartSheet, events = [];
  const tree = f.render(() => Sheet({ open: true, cart: { cartId: "cart", items: [{ variantId: "v", productName: "Produto", quantity: 1, price: 100, subtotal: 100 }], itemCount: 1, subtotal: 100, discount: 0, total: 100, commercialNotices: [notice()] },
    onCheckout: () => events.push("checkout"), onClose: () => {}, onUpdateQty: () => {}, onRemoveItem: () => {} }));
  assert.ok(text(tree).includes(notice().message)); const checkoutButton = nodes(tree, node => node.type === "button" && text(node).includes("Finalizar pedido"))[0];
  assert.ok(checkoutButton); assert.equal(Boolean(checkoutButton.props.disabled), false); checkoutButton.props.onClick(); assert.deepEqual(events, ["checkout"]);
});
