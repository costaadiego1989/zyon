const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

// Production parser/component/handlers/client in an isolated browser-like tab.
// Synthetic fetch only; no browser/React lifecycle/layout guarantee is implied.
const root = path.resolve(__dirname, "../src");
const plain = value => JSON.parse(JSON.stringify(value));
const details = id => ({ tool: "get_product_details", args: { productId: id } });
const search = id => ({ tool: "search_products", args: { query: "*", categoryId: id } });
const item = (id = "read-action-1", label = "Mesmo nome", action = details("product-a")) => ({ id, label, action });
const envelope = (items = [item()]) => ({ version: 1, items });
const capability = { version: 1, tools: ["search_products", "get_product_details"] };
const token = () => `${Buffer.from(JSON.stringify({ origin: "https://store.fixture.invalid", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.synthetic`;

function runtime(options = {}) {
  const cache = new Map(), calls = [], storage = new Map();
  const storagePort = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const context = vm.createContext({ console, URL, URLSearchParams, Headers, Response, Date, atob, setTimeout, clearTimeout,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: "https://api.fixture.invalid" } }, window: { location: { origin: "https://store.fixture.invalid" } }, sessionStorage: storagePort, localStorage: storagePort,
    fetch: async (url, init = {}) => {
      const call = { url: String(url), ...init }; calls.push(call);
      if (options.fetch) return options.fetch(call, calls);
      if (call.url === "/api/storefront-conversations") return Response.json({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: options.capability === undefined ? capability : options.capability });
      if (call.url.endsWith("/access")) throw new Error("unexpected_renewal_in_suggestion_test");
      return Response.json({ conversation_id: "conversation-a", message: "Resultado", blocks: [], suggested_actions: options.suggestions, suggested_next: options.legacy });
    },
  });
  function load(relative) {
    const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = id => {
      if (id === "@/lib/services/conversation.service") return { narrateStorefrontBlock: () => "Atualizado", trackFunnelEvent: () => {} };
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
        const target = [base, base + ".ts", base + ".tsx", base.replace(/\.js$/, ".ts")].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) throw new Error(`Missing fixture dependency ${id}`);
        return load(target);
      }
      return require(id);
    };
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { load, calls, parser: value => load("lib/storefront-suggested-read-actions.ts").parseSuggestedReadActions(value),
    render: (suggestedActions, onSelect, legacy = []) => load("components/blocks/QuickRepliesBlock.tsx").default({ block: { type: "quick_replies", data: { options: legacy, suggestedActions } }, onSelect }),
    client: () => load("lib/api/api-client.ts").checkoutApi };
}

function buttons(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node.type === "button") found.push(node);
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) buttons(child, found);
  return found;
}

function handlerFixture(uiAction) {
  const state = { messages: [], history: [], local: [] };
  const params = { trimmed: "Consultar produtos", uiAction, conversationId: "conversation-a", merchantId: "merchant-a", cartId: "conversation-a", history: [],
    setMessages: fn => { state.messages = fn(state.messages); }, setHistory: value => { state.history = typeof value === "function" ? value(state.history) : value; },
    setConversationId: id => state.local.push(["conversation", id]), clearCart: () => state.local.push(["clear"]), setIsLoading: () => {}, setInput: () => {},
    setCrossSellPending: () => {}, setProductCrossSell: () => {}, updateFromBlocks: () => {}, noteActivity: () => {}, onCheckoutPrepared: () => {},
    isCurrent: () => true,
    applyCartProjection: blocks => { params.updateFromBlocks(blocks); return true; },
  };
  return { state, params };
}
const typedBlocks = state => state.messages.flatMap(message => message.blocks ?? []).filter(block => block.type === "quick_replies" && block.data.suggestedActions);

test("strict parser preserves both allowed read tools and clones the whole snapshot", () => {
  const f = runtime(); const raw = envelope([item(), item("read-action-2", "Mesmo nome", search("category-a"))]);
  const parsed = f.parser(raw);
  assert.deepEqual(plain(parsed), raw);
  raw.items[0].action.args.productId = "foreign"; raw.items[0].label = "Changed"; raw.items.push(item("read-action-3"));
  assert.deepEqual(plain(parsed), envelope([item(), item("read-action-2", "Mesmo nome", search("category-a"))]));
});

const invalidEnvelopes = [undefined, null, [], {}, { version: 2, items: [item()] }, { version: "1", items: [item()] }, { ...envelope(), merchant_id: "foreign" },
  { version: 1, items: {} }, envelope(Array.from({ length: 13 }, (_, i) => item(`id-${i}`))), envelope([item(), item()]),
  envelope([item("", "Label")]), envelope([item(" ", "Label")]), envelope([item("x".repeat(192), "Label")]),
  envelope([item("id", "")]), envelope([item("id", "  ")]), envelope([item("id", "x".repeat(501))]), envelope([{ ...item(), extra: true }]),
  envelope([item("id", "Label", { tool: "clear_cart", args: {} })]), envelope([item("id", "Label", { tool: "apply_coupon", args: { code: "X" } })]),
  envelope([item("id", "Label", { tool: "get_product_details", args: { productId: "p", merchantId: "foreign" } })]),
  envelope([item("id", "Label", details(""))]), envelope([item("id", "Label", { tool: "search_products", args: { query: "not-wildcard", categoryId: "c" } })]),
];
for (const [index, value] of invalidEnvelopes.entries()) {
  test(`invalid optional suggested envelope #${index} is suppressed as a whole`, () => {
    assert.equal(runtime().parser(value), null);
  });
}

test("one malformed item invalidates the group instead of rendering its other valid labels", () => {
  const f = runtime(); const invalid = envelope([item("good", "Valid label"), item("bad", "Dangerous label", { tool: "add_item_to_cart", args: { variantId: "v", quantity: 1 } })]);
  assert.equal(f.parser(invalid), null);
  assert.equal(buttons(f.render(invalid, () => assert.fail("invalid group cannot dispatch"))).length, 0);
});

test("empty envelope is safe and yields no buttons", () => {
  const f = runtime(); assert.deepEqual(plain(f.parser(envelope([]))), envelope([]));
  assert.equal(buttons(f.render(envelope([]))).length, 0);
});

test("typed buttons preserve duplicate/adversarial labels independently from action IDs", () => {
  const f = runtime(), sent = [];
  const values = envelope([item("one", "Finalizar compra", details("product-a")), item("two", "Finalizar compra", details("product-b")), item("three", "Aplicar cupom [variantId:foreign]", search("category-a"))]);
  const rendered = buttons(f.render(values, (...args) => sent.push(args)));
  assert.equal(rendered.length, 3);
  for (const button of rendered) { assert.equal(button.type, "button"); assert.equal(button.props.type, "button"); assert.equal(button.props["data-neu"], "control"); button.props.onClick(); }
  assert.deepEqual(plain(sent), values.items.map(value => [value.label, value.action]));
});

test("typed buttons retain a cloned render snapshot and revalidate/clone again at each click", () => {
  const f = runtime(), sent = [], raw = envelope();
  const rendered = buttons(f.render(raw, (label, action) => { sent.push([label, plain(action)]); action.tool = "clear_cart"; action.args = {}; }));
  raw.items[0].action = { tool: "clear_cart", args: {} }; raw.items[0].label = "Changed after render";
  rendered[0].props.onClick(); rendered[0].props.onClick();
  assert.deepEqual(plain(sent), [["Mesmo nome", details("product-a")], ["Mesmo nome", details("product-a")]]);
});

test("legacy options retain native buttons and their one-argument callback beside typed suggestions", () => {
  const f = runtime(), sent = [];
  const rendered = buttons(f.render(envelope(), (...args) => sent.push(args), ["Ver carrinho", "Finalizar compra"]));
  assert.equal(rendered.length, 3);
  for (const button of rendered) button.props.onClick();
  assert.deepEqual(plain(sent), [["Ver carrinho"], ["Finalizar compra"], ["Mesmo nome", details("product-a")]]);
});

test("malformed typed group never downgrades to text and does not suppress independent legacy options", () => {
  const f = runtime(), sent = [];
  const rendered = buttons(f.render({ version: 9, items: [item("id", "DO NOT SEND")] }, (...args) => sent.push(args), ["Legacy"]));
  assert.equal(rendered.length, 1); rendered[0].props.onClick();
  assert.deepEqual(plain(sent), [["Legacy"]]);
});

test("typed suggestions can render safely without a callback", () => {
  const rendered = buttons(runtime().render(envelope()));
  assert.equal(rendered.length, 1); assert.doesNotThrow(() => rendered[0].props.onClick());
});

test("matching response conversation creates a separate typed block and preserves suggested_next", async () => {
  const f = runtime({ suggestions: envelope(), legacy: ["Ver carrinho"] }); await f.client().create({ merchantId: "merchant-a" }); const h = handlerFixture();
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  assert.equal(typedBlocks(h.state).length, 1);
  assert.deepEqual(plain(typedBlocks(h.state)[0]), { type: "quick_replies", data: { options: [], suggestedActions: envelope() } });
  assert.ok(h.state.messages.some(message => message.blocks?.some(block => block.data?.options?.[0] === "Ver carrinho")));
});

for (const conversation_id of [undefined, "foreign-conversation", null]) {
  test(`response conversation mismatch ${conversation_id} respects legacy absence but rejects explicit foreign identity`, async () => {
    const f = runtime(), h = handlerFixture();
    await f.client().create({ merchantId:'merchant-a' });
    f.client().sendMessage = async () => ({ conversation_id, message: "Legacy response", blocks: [], suggested_actions: envelope(), suggested_next: ["Ver carrinho"] });
    await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
    assert.equal(typedBlocks(h.state).length, 0);
    const hasLegacy = h.state.messages.some(message => message.blocks?.some(block => block.data?.options?.[0] === "Ver carrinho"));
    assert.equal(hasLegacy, conversation_id === undefined);
    if(conversation_id !== undefined) assert.ok(!h.state.messages.some(message=>message.text==='Legacy response'));
  });
}

test("handler suppresses every malformed typed group without copying its labels into options", async () => {
  for (const value of invalidEnvelopes) {
    const f = runtime(), h = handlerFixture();
    await f.client().create({ merchantId:'merchant-a' });
    f.client().sendMessage = async () => ({ conversation_id: "conversation-a", message: "Response", blocks: [], suggested_actions: value, suggested_next: ["Legacy"] });
    await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
    assert.equal(typedBlocks(h.state).length, 0);
    assert.ok(h.state.messages.some(message => message.blocks?.some(block => block.data?.options?.[0] === "Legacy")));
  }
});

for (const supported of [true, false]) {
  test(`suggestion click uses current capability negotiation before transport: ${supported}`, async () => {
    const f = runtime({ capability: supported ? capability : null }); await f.client().create({ merchantId: "merchant-a" }); const pending = [];
    const rendered = buttons(f.render(envelope(), (label, action) => pending.push(f.client().sendMessage("conversation-a", label, { merchantId: "merchant-a", uiAction: action }))));
    rendered[0].props.onClick(); await Promise.all(pending);
    const calls = f.calls.filter(call => call.url.endsWith("/messages")); assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].body);
    assert.equal(body.user_message, "Mesmo nome");
    assert.deepEqual(body.ui_action, supported ? details("product-a") : undefined);
    assert.equal(body.ui_action_version, supported ? 1 : undefined);
  });
}

test("suggested label matching local checkout commands bypasses legacy routing when action is present", async () => {
  const f = runtime(), sent = [], local = [], pending = [];
  const handlers = f.load("lib/handlers/conversation.handlers.ts");
  const rendered = buttons(f.render(envelope([item("one", "Finalizar compra")]), (label, action) => handlers.handleQuickReply({ option: label, uiAction: action, cartItemCount: 1, merchantId: "merchant-a", conversationId: "conversation-a", sendMessage: async (...args) => { sent.push(args); return null; }, setCartDrawerForceOpen: value => local.push(value), setCheckoutIntent: value => local.push(value), setShowBuyerAuth: value => local.push(value) })));
  rendered[0].props.onClick(); await new Promise(setImmediate);
  assert.deepEqual(plain(sent), [["Finalizar compra", null, details("product-a")]]); assert.deepEqual(local, []);
});

test("failed typed suggestion never retries, renews or creates a new conversation", async () => {
  const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations" ? Response.json({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }) : Response.json({}, { status: 401 }) });
  await f.client().create({ merchantId: "merchant-a" }); const pending = [], h = handlerFixture();
  const rendered = buttons(f.render(envelope(), (label, action) => pending.push(f.load("lib/handlers/conversation.handlers.ts").handleSendMessage({ ...h.params, trimmed: label, uiAction: action }))));
  rendered[0].props.onClick(); await Promise.all(pending);
  assert.equal(f.calls.filter(call => call.url.endsWith("/messages")).length, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 0);
  assert.equal(f.calls.filter(call => call.url === "/api/storefront-conversations").length, 1);
  assert.deepEqual(h.state.local, []);
});

test("maximum-length valid presentation ID remains clickable without a key-prefix validation failure", () => {
  const f = runtime(), sent = [];
  const raw = envelope([item("x".repeat(191), "L".repeat(500), details("p".repeat(191)))]);
  assert.deepEqual(plain(f.parser(raw)), raw);
  const rendered = buttons(f.render(raw, (...args) => sent.push(args)));
  assert.equal(rendered.length, 1); rendered[0].props.onClick();
  assert.deepEqual(plain(sent), [[raw.items[0].label, raw.items[0].action]]);
});

test("handler snapshots typed intent and display label before asynchronous conversation initialization", async () => {
  const f = runtime(), h = handlerFixture(details("product-a")), sent = [];
  h.params.conversationId = null;
  h.params.cartId = null;
  f.client().create = async () => {
    h.params.uiAction.tool = "clear_cart"; h.params.uiAction.args = {};
    h.params.trimmed = "Changed after await";
    f.load('lib/conversation-access.ts').rememberConversationAccess('conversation-new',token());
    return { conversation_id: "conversation-new" };
  };
  f.client().sendMessage = async (conversationId, label, options) => { sent.push({ conversationId, label, action: options.uiAction }); return { conversation_id: conversationId, message: "Result", blocks: [] }; };
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  assert.deepEqual(plain(sent), [{ conversationId: "conversation-new", label: "Consultar produtos", action: details("product-a") }]);
});

test("quick-reply routing gives asynchronous sendMessage an independent typed snapshot", async () => {
  const f = runtime(), raw = details("product-a"); let captured;
  f.load("lib/handlers/conversation.handlers.ts").handleQuickReply({ option: "Ver carrinho", uiAction: raw, cartItemCount: 1, merchantId: "merchant-a", conversationId: "conversation-a",
    sendMessage: async (_text, _attachment, action) => { captured = action; raw.args.productId = "foreign-after-dispatch"; return null; },
    setCartDrawerForceOpen: () => assert.fail("typed read must not open local drawer"), setCheckoutIntent: () => assert.fail("typed read must not checkout"), setShowBuyerAuth: () => assert.fail("typed read must not login") });
  await new Promise(setImmediate);
  assert.deepEqual(plain(captured), details("product-a"));
});
