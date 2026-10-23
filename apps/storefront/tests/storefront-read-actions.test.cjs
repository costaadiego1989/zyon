const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

// Exercise production modules in isolated browser-tab-like realms. All IO is an
// explicit synthetic fetch; hooks are inert only for callback-level unit tests.
const root = path.resolve(__dirname, "../src");
const capability = { version: 1, tools: ["search_products", "get_product_details"] };
const category = { tool: "search_products", args: { query: "*", categoryId: "category-a" } };
const product = { tool: "get_product_details", args: { productId: "product-a" } };
const plain = value => JSON.parse(JSON.stringify(value));
const token = expired => `${Buffer.from(JSON.stringify({ origin: "https://store.fixture.invalid", expiresAt: Date.now() / 1000 + (expired ? -1 : 3600) })).toString("base64url")}.synthetic`;
const response = (value, status = 200) => Response.json(value, { status });
class BrowserCustomEvent extends Event {
  constructor(type, init = {}) { super(type, init); this.detail = init.detail; }
}

function runtime(options = {}) {
  const cache = new Map(), calls = [], storage = new Map();
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const react = { ...require("react"), useCallback: fn => fn, useEffect: () => {}, useId: () => "track", useRef: () => ({ current: null }), useState: initial => [typeof initial === "function" ? initial() : initial, () => {}] };
  const context = vm.createContext({ console, URL, URLSearchParams, Headers, Request, Response, AbortSignal, Date, atob, setTimeout, clearTimeout, Event, CustomEvent: BrowserCustomEvent,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: "https://api.fixture.invalid" } },
    window: { location: { origin: "https://store.fixture.invalid" }, dispatchEvent: event => options.onEvent?.(event) }, sessionStorage, localStorage: sessionStorage,
    fetch: async (url, init = {}) => { const call = { url: String(url), ...init }; calls.push(call); if (options.fetch) return options.fetch(call, calls); if (call.url === "/api/storefront-conversations") return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: options.capability === undefined ? capability : options.capability }); if (call.url.endsWith("/access")) return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }); return response({ message: "Resultado", blocks: [] }); },
  });
  function load(relative) {
    const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = id => {
      if (id === "react") return react;
      if (id === "react-icons/fi") return new Proxy({}, { get: () => () => null });
      if (id.endsWith(".module.css")) return new Proxy({}, { get: (_, name) => name });
      if (id.endsWith("ImageSlideshow") || id.endsWith("RuleNotices")) return { __esModule: true, default: () => null };
      if (id === "@/lib/services/conversation.service") return { narrateStorefrontBlock: () => "Atualizado", trackFunnelEvent: () => {} };
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
        const target = [base, base + ".ts", base + ".tsx", base.replace(/\.js$/, ".ts"), path.join(base, "index.ts")].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) throw new Error(`Missing fixture dependency ${id} from ${filename}`);
        return load(target);
      }
      return require(id);
    };
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { load, calls, storage, access: () => load("lib/conversation-access.ts"), client: () => load("lib/api/api-client.ts").checkoutApi };
}

function messageCalls(f) { return f.calls.filter(call => call.url.endsWith("/messages")); }
test("Meus Dados opens the buyer hub without a model response or cart operation", () => {
  const events = [];
  const f = runtime({ onEvent: event => events.push(event.type) });
  const unexpected = () => assert.fail("profile navigation must not change commerce state or send chat");
  f.load("lib/handlers/conversation.handlers.ts").handleQuickReply({ option: " Meus Dados ", cartItemCount: 1,
    merchantId: "merchant-a", conversationId: "conversation-a", sendMessage: unexpected,
    setCartDrawerForceOpen: unexpected, setCheckoutIntent: unexpected, setShowBuyerAuth: unexpected });
  assert.deepEqual(events, ["aacp:open-buyer-hub"]); assert.equal(f.calls.length, 0);
});
async function start(f) { await f.client().create({ merchantId: "merchant-a" }); }
for (const [label, type, detail] of [
  ["Reportar Problema", "zyon:open-support", { view: "report" }],
  ["Falar com Humano", "zyon:open-support", { view: "human" }],
  ["FAQ", "zyon:open-support", { view: "faq" }],
  ["Suporte", "zyon:open-support", { view: "welcome" }],
  ["Status do Pedido", "aacp:open-buyer-hub", { tab: "orders" }],
  ["Rastrear Pedido", "aacp:open-buyer-hub", { tab: "tracking" }],
]) test(`${label} opens its native destination without ticket, chat, or cart writes`, () => {
  const events = [], f = runtime({ onEvent: event => events.push({ type: event.type, detail: plain(event.detail) }) });
  const unexpected = () => assert.fail("navigation must not send messages or change commerce state");
  f.load("lib/handlers/conversation.handlers.ts").handleQuickReply({ option: label, cartItemCount: 1,
    merchantId: "merchant-a", conversationId: "conversation-a", sendMessage: unexpected,
    setCartDrawerForceOpen: unexpected, setCheckoutIntent: unexpected, setShowBuyerAuth: unexpected });
  assert.deepEqual(events, [{ type, detail }]); assert.equal(f.calls.length, 0);
});
function handlerParams(uiAction) {
  const effects = { messages: [], history: [], cartClears: 0, conversationChanges: [] };
  const params = { trimmed: "Detalhes duplicados", uiAction, conversationId: "conversation-a", merchantId: "merchant-a", history: [], cartId: "conversation-a", variantId: undefined,
    setConversationId: id => effects.conversationChanges.push(id), clearCart: () => effects.cartClears++,
    setMessages: fn => { effects.messages = fn(effects.messages); }, setHistory: value => { effects.history = typeof value === "function" ? value(effects.history) : value; },
    setIsLoading: () => {}, setInput: () => {}, setCrossSellPending: () => {}, setProductCrossSell: () => {}, updateFromBlocks: () => {}, noteActivity: () => {}, onCheckoutPrepared: () => {},
    isCurrent: () => true,
    applyCartProjection: blocks => { params.updateFromBlocks(blocks); return true; },
  };
  return { params, effects };
}

test("voice handoff forwards signed permit only to HTTP, never history or stored conversation", async () => {
  const f = runtime(); await start(f); const h = handlerParams(undefined);
  h.params.voiceTurnToken = "synthetic-signed-voice-permit";
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  const calls = messageCalls(f); assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.voice_turn_token, "synthetic-signed-voice-permit");
  assert.ok(!JSON.stringify(body.history).includes("voice-permit"));
  assert.ok(!JSON.stringify(h.effects).includes("voice-permit"));
  assert.ok(!JSON.stringify([...f.storage]).includes("voice-permit"));
});

for (const action of [category, product, { ...category, args: { ...category.args, cursor: "cursor-a" } }]) {
  test(`advertised read action ${action.tool} forwards exact IDs independently of display text`, async () => {
    const f = runtime(); await start(f);
    await f.client().sendMessage("conversation-a", "Nome repetido ou renomeado", { merchantId: "merchant-a", uiAction: action });
    const body = JSON.parse(messageCalls(f)[0].body);
    assert.deepEqual(body.ui_action, action); assert.equal(body.ui_action_version, 1);
    assert.equal(body.user_message, "Nome repetido ou renomeado"); assert.equal(body.cart_id, "conversation-a");
  });
}

for (const advertisement of [null, { version: 2, tools: capability.tools }, { version: "1", tools: capability.tools }, { version: 1, tools: ["clear_cart"] }, { version: 1, tools: ["get_product_details", "get_product_details"] }, { version: 1, tools: capability.tools, merchant_id: "foreign" }]) {
  test(`unsupported capability ${JSON.stringify(advertisement)} chooses legacy text before transport`, async () => {
    const f = runtime({ capability: advertisement }); await start(f);
    await f.client().sendMessage("conversation-a", "Detalhes legado", { merchantId: "merchant-a", uiAction: product });
    const body = JSON.parse(messageCalls(f)[0].body);
    assert.equal(body.user_message, "Detalhes legado"); assert.equal("ui_action" in body, false); assert.equal("ui_action_version" in body, false);
    assert.equal(messageCalls(f).length, 1);
  });
}

test("capability is not reused for another conversation or merchant", async () => {
  const f = runtime(); await start(f);
  f.access().rememberConversationAccess("conversation-b", token());
  for (const [conversationId, merchantId] of [["conversation-b", "merchant-a"], ["conversation-a", "merchant-b"]]) {
    await f.client().sendMessage(conversationId, "Detalhes", { merchantId, uiAction: product });
    assert.equal("ui_action" in JSON.parse(messageCalls(f).at(-1).body), false);
  }
});

for (const action of [null, {}, { tool: "clear_cart", args: {} }, { tool: "get_product_details", args: { productId: "" } }, { tool: "get_product_details", args: { productId: "   " } }, { tool: "get_product_details", args: { productId: "x".repeat(192) } }, { tool: "get_product_details", args: { productId: "p", merchantId: "foreign" } }, { tool: "get_product_details", args: { productId: "p" }, cartId: "foreign" }, { tool: "search_products", args: { query: "anything", categoryId: "c" } }, { tool: "search_products", args: { query: "*", categoryId: "c", cursor: 123 } }, { tool: "search_products", args: { query: "*", categoryId: "c", cursor: "x".repeat(2049) } }]) {
  test(`invalid read action is rejected without fetch or textual conversion: ${JSON.stringify(action)}`, async () => {
    const f = runtime();
    await assert.rejects(f.client().sendMessage("conversation-a", "Do not execute as text", { merchantId: "merchant-a", uiAction: action }), error => error.message === "invalid_storefront_ui_action");
    assert.equal(f.calls.length, 0);
  });
}

for (const status of [400, 401, 403, 500]) {
  test(`typed HTTP ${status} never causes renewal replay or text fallback`, async () => {
    const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations" ? response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }) : response({ message: "synthetic-rejection" }, status) });
    await start(f);
    await assert.rejects(f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product }));
    assert.equal(messageCalls(f).length, 1); assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 0);
    assert.deepEqual(JSON.parse(messageCalls(f)[0].body).ui_action, product);
  });
}

test("uncertain network failure never retries typed commands", async () => {
  const f = runtime({ fetch: async call => { if (call.url === "/api/storefront-conversations") return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }); throw new Error("synthetic-network-failure"); } });
  await start(f);
  await assert.rejects(f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product }));
  assert.equal(messageCalls(f).length, 1);
});

test("successful renewal learns capability for a restored conversation before its first command", async () => {
  const f = runtime(); f.access().rememberConversationAccess("conversation-a", token(true));
  await f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product });
  assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 1);
  assert.deepEqual(JSON.parse(messageCalls(f)[0].body).ui_action, product);
});

test("renewal without matching metadata clears the previous capability hint", async () => {
  for (const renewal of [undefined, { merchant_id: "merchant-a" }, { merchant_id: "foreign", ui_action_capability: capability }, { merchant_id: "merchant-a", ui_action_capability: { version: 9, tools: capability.tools } }]) {
    const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations" ? response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }) : call.url.endsWith("/access") ? response({ conversation_id: "conversation-a", conversation_token: token(), ...renewal }) : response({ message: "Resultado", blocks: [] }) });
    await start(f); f.access().rememberConversationAccess("conversation-a", token(true));
    await f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product });
    assert.equal("ui_action" in JSON.parse(messageCalls(f)[0].body), false);
  }
});

test("forgetting signed access also forgets protocol support", async () => {
  const f = runtime(); await start(f); f.access().forgetConversationAccess("conversation-a"); f.access().rememberConversationAccess("conversation-a", token());
  await f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product });
  assert.equal("ui_action" in JSON.parse(messageCalls(f)[0].body), false);
});

test("typed handler expiry does not create a new conversation or clear the existing cart", async () => {
  const f = runtime(); const h = handlerParams(product);
  f.access().rememberConversationAccess("conversation-a", token(true));
  const client = f.client(); client.sendMessage = async () => { throw new (f.access().ConversationSessionExpiredError)(); };
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  assert.equal(f.calls.filter(call => call.url.endsWith('/access')).length, 1);
  assert.equal(messageCalls(f).length, 0);assert.equal(f.calls.filter(call=>call.url==='/api/storefront-conversations').length,0);
  assert.equal(h.effects.cartClears, 0); assert.deepEqual(h.effects.conversationChanges, []);
});

test("legacy handler expiry never creates a new session, clears the cart or resends text", async () => {
  const f = runtime(); const h = handlerParams(undefined); let attempts = 0;
  f.access().rememberConversationAccess('conversation-a', token());
  f.client().sendMessage = async () => { if (++attempts === 1) throw new (f.access().ConversationSessionExpiredError)(); return { message: "Recovered", blocks: [] }; };
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  assert.equal(attempts, 1); assert.equal(h.effects.cartClears, 0); assert.equal(h.effects.conversationChanges.length, 0);
  assert.equal(f.calls.length, 0);
});

test("typed quick replies bypass text-only local cart/login routing", async () => {
  const f = runtime(); const sent = [], local = [];
  const base = { option: "Finalizar compra", uiAction: product, cartItemCount: 1, merchantId: "merchant-a", conversationId: "conversation-a", sendMessage: async (...args) => { sent.push(args); return null; }, setCartDrawerForceOpen: value => local.push(value), setCheckoutIntent: value => local.push(value), setShowBuyerAuth: value => local.push(value) };
  f.load("lib/handlers/conversation.handlers.ts").handleQuickReply(base);
  await new Promise(setImmediate);
  assert.deepEqual(plain(sent), [["Finalizar compra", null, product]]); assert.deepEqual(local, []);
});

function elements(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) elements(child, predicate, found);
  return found;
}

test("category callbacks preserve distinct IDs for duplicate names without changing labels", () => {
  const f = runtime(); const events = [];
  const component = f.load("components/blocks/CategoryCarouselBlock.tsx").default;
  const tree = component({ block: { type: "category_carousel", data: { categories: [{ id: "category-a", name: "Mesmo nome", slug: "a" }, { id: "category-b", name: "Mesmo nome", slug: "b" }] } }, onQuickReply: (...args) => events.push(args) });
  for (const button of elements(tree, node => node.type === "button")) button.props.onClick();
  assert.deepEqual(plain(events), [["Ver produtos de Mesmo nome", category], ["Ver produtos de Mesmo nome", { tool: "search_products", args: { query: "*", categoryId: "category-b" } }]]);
});

test("product details callbacks preserve IDs while cart/wishlist callbacks remain text-only", () => {
  const f = runtime(); const events = [];
  const component = f.load("components/blocks/ProductCarouselBlock.tsx").default;
  const item = id => ({ id, name: "Mesmo nome", price: 10, priceFormatted: "R$ 10,00", inStock: true });
  const tree = component({ block: { type: "product_carousel", data: { products: [item("product-a"), item("product-b")] } }, onQuickReply: (...args) => events.push(args) });
  const articles = elements(tree, node => node.type === "article");
  for (const article of articles) {
    elements(article, node => node.type === "button" && node.props.children === "Saber mais")[0].props.onClick();
    elements(article, node => node.type === "button" && node.props.children === "Adicionar ao carrinho")[0].props.onClick();
    elements(article, node => node.type === "button" && node.props["aria-label"]?.includes("lista de desejos"))[0].props.onClick({ stopPropagation() {} });
  }
  assert.deepEqual(plain(events), [["Detalhes Mesmo nome", product], ["Adicionar Mesmo nome ao carrinho"], ["Adicionar Mesmo nome à lista de desejos"], ["Detalhes Mesmo nome", { tool: "get_product_details", args: { productId: "product-b" } }], ["Adicionar Mesmo nome ao carrinho"], ["Adicionar Mesmo nome à lista de desejos"]]);
});

test("legacy transport does not renew or retry rejected text even without typed action fields", async () => {
  let messages = 0;
  const f = runtime({ fetch: async call => {
    if (call.url === "/api/storefront-conversations" || call.url.endsWith("/access")) return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
    return ++messages === 1 ? response({}, 401) : response({ message: "Resultado", blocks: [] });
  } });
  await start(f);
  await assert.rejects(f.client().sendMessage("conversation-a", "Ver produtos", { merchantId: "merchant-a" }), error => error instanceof f.access().ConversationSessionExpiredError);
  assert.equal(messageCalls(f).length, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 0);
  for (const call of messageCalls(f)) assert.equal("ui_action" in JSON.parse(call.body), false);
});

for (const status of [401, 403]) {
  test(`regression: legacy mutating text is posted only once after HTTP ${status}`, async () => {
    let messages = 0;
    const f = runtime({ fetch: async call => {
      if (call.url === "/api/storefront-conversations" || call.url.endsWith("/access")) return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
      return ++messages === 1 ? response({}, status) : response({ message: "Resultado", blocks: [] });
    } });
    await start(f);
    await assert.rejects(f.client().sendMessage("conversation-a", "Adicionar Produto ao carrinho", { merchantId: "merchant-a" }), error => error instanceof f.access().ConversationSessionExpiredError);
    assert.equal(messageCalls(f).length, 1);
    const bodies = messageCalls(f).map(call => JSON.parse(call.body));
    assert.equal(bodies[0].user_message, "Adicionar Produto ao carrinho");
    assert.equal("message_id" in bodies[0], false);
    assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 0);
  });
}

test("regression: expired legacy mutation stays bound to its original conversation without replay", async () => {
  const f = runtime({ fetch: async call => {
    assert.equal(call.url, "/api/storefront-conversations");
    return response({ merchant_id: "merchant-a", conversation_id: "conversation-b", conversation_token: token(), ui_action_capability: capability });
  } });
  const h = handlerParams(undefined); const deliveries = [];
  f.access().rememberConversationAccess('conversation-a', token());
  h.params.trimmed = "Adicionar Produto ao carrinho";
  f.client().sendMessage = async (conversationId, label) => {
    deliveries.push({ conversationId, label });
    if (deliveries.length === 1) throw new (f.access().ConversationSessionExpiredError)();
    return { message: "Resultado", blocks: [] };
  };
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  assert.deepEqual(deliveries, [
    { conversationId: "conversation-a", label: h.params.trimmed },
  ]);
  assert.equal(h.effects.cartClears, 0);
  assert.deepEqual(h.effects.conversationChanges, []);
  assert.equal(f.calls.length, 0);
});

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) for (const status of [401, 403]) {
  test(`unsafe ${method} HTTP ${status} cannot replay even when an old caller explicitly asks`, async () => {
    let attempts = 0;
    const f = runtime({ fetch: async call => {
      if (call.url === "/api/storefront-conversations" || call.url.endsWith("/access")) return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
      return ++attempts === 1 ? response({}, status) : response({ ok: true });
    } });
    await start(f);
    await assert.rejects(f.access().conversationFetch("conversation-a", "https://api.fixture.invalid/storefront/unsafe", { method, body: "synthetic" }, { replayAuthorizationFailure: true }), error => error instanceof f.access().ConversationSessionExpiredError);
    assert.equal(attempts, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 0);
  });
}

for (const method of ["GET", "HEAD"]) test(`safe ${method} keeps bounded authorization renewal compatibility`, async () => {
  let attempts = 0;
  const f = runtime({ fetch: async call => {
    if (call.url === "/api/storefront-conversations" || call.url.endsWith("/access")) return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
    return ++attempts === 1 ? response({}, 401) : response({ ok: true });
  } });
  await start(f);
  assert.equal((await f.access().conversationFetch("conversation-a", "https://api.fixture.invalid/storefront/read-only", { method })).status, 200);
  assert.equal(attempts, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 1);
});

for (const failure of ["http500", "lost-response"]) test(`uncertain legacy ${failure} never recreates a conversation or clears the cart`, async () => {
  const f = runtime({ fetch: async call => {
    if (call.url === "/api/storefront-conversations") return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
    if (failure === "lost-response") throw new Error("synthetic_response_lost_after_send");
    return response({}, 500);
  } });
  await start(f); const h = handlerParams(undefined); h.params.trimmed = "Adicionar Produto ao carrinho";
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  assert.equal(messageCalls(f).length, 1);
  assert.equal(f.calls.filter(call => call.url === "/api/storefront-conversations").length, 1);
  assert.equal(h.effects.cartClears, 0); assert.deepEqual(h.effects.conversationChanges, []);
  assert.ok(!h.effects.messages.at(-1).text.includes("Tente novamente"));
});

test("legacy message fields and buyer identity are snapshotted before asynchronous access renewal", async () => {
  let begun, release;
  const started = new Promise(resolve => { begun = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = runtime({ fetch: async call => {
    if (call.url === "/api/storefront-conversations") return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
    if (call.url.endsWith("/access")) { begun(); await gate; return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }); }
    return response({ message: "Resultado", blocks: [] });
  } });
  await start(f); f.access().rememberConversationAccess("conversation-a", token(true));
  const options = { merchantId: "merchant-a", variantId: "original-variant", token: "synthetic-original-buyer", history: [{ role: "user", content: "original selection" }], attachment: { kind: "image", url: "https://fixture.invalid/original", name: "original" } };
  const pending = f.client().sendMessage("conversation-a", "Adicionar este produto", options);
  try {
    await started;
    options.variantId = "changed-variant"; options.token = "synthetic-changed-buyer";
    options.history[0].content = "changed selection"; options.attachment.name = "changed";
  } finally { release(); }
  await pending;
  const [sent] = messageCalls(f), body = JSON.parse(sent.body);
  assert.equal(body.variant_id, "original-variant"); assert.equal(body.history[0].content, "original selection"); assert.equal(body.attachment.name, "original");
  assert.equal(new Headers(sent.headers).get("X-Buyer-Authorization"), "Bearer synthetic-original-buyer");
  assert.equal(messageCalls(f).length, 1);
});

for (const invalid of [null, false]) test(`invalid legacy response ${invalid} must not encourage blind resubmission`, async () => {
  const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations"
    ? response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }) : response(invalid) });
  await start(f); const h = handlerParams(undefined);
  await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params);
  assert.equal(messageCalls(f).length, 1); assert.equal(h.effects.cartClears, 0); assert.deepEqual(h.effects.conversationChanges, []);
  assert.ok(!h.effects.messages.at(-1).text.includes("Tente novamente"));
});

test("safe method snapshot cannot turn an authorization retry into a different unsafe operation", async () => {
  const options = { method: "GET" };
  let attempts = 0;
  const f = runtime({ fetch: async call => {
    if (call.url === "/api/storefront-conversations" || call.url.endsWith("/access")) return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
    if (++attempts === 1) { options.method = "POST"; return response({}, 401); }
    return response({ ok: true });
  } });
  await start(f);
  await f.access().conversationFetch("conversation-a", "https://api.fixture.invalid/storefront/method-snapshot", options);
  assert.deepEqual(f.calls.filter(call => call.url.endsWith("/method-snapshot")).map(call => call.method), ["GET", "GET"]);
});

test("handler forwards the typed action unchanged through the actual client and preserves history label", async () => {
  const f = runtime(); await start(f); const h = handlerParams(product);
  assert.ok(await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params));
  assert.equal(messageCalls(f).length, 1);
  const body = JSON.parse(messageCalls(f)[0].body);
  assert.deepEqual(body.ui_action, product); assert.equal(body.ui_action_version, 1);
  assert.deepEqual(body.history, [{ role: "user", content: "Detalhes duplicados" }]);
  assert.equal(h.effects.cartClears, 0);
});

test("invalid typed quick reply never becomes local checkout or a textual message", () => {
  const f = runtime(); const called = [];
  assert.throws(() => f.load("lib/handlers/conversation.handlers.ts").handleQuickReply({ option: "Finalizar compra", uiAction: { tool: "clear_cart", args: {} }, cartItemCount: 1, merchantId: "merchant-a", conversationId: "conversation-a", sendMessage: async () => called.push("message"), setCartDrawerForceOpen: () => called.push("cart"), setCheckoutIntent: () => called.push("checkout"), setShowBuyerAuth: () => called.push("auth") }), error => error.message === "invalid_storefront_ui_action");
  assert.deepEqual(called, []);
});

test("invalid typed handler input is rejected before conversation creation or UI mutation", async () => {
  const f = runtime(); const h = handlerParams({ tool: "clear_cart", args: {} }); h.params.conversationId = null;
  await assert.rejects(f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params), error => error.message === "invalid_storefront_ui_action");
  assert.equal(f.calls.length, 0); assert.deepEqual(h.effects.messages, []); assert.deepEqual(h.effects.history, []);
});

test("failed typed preflight renewal neither posts nor recreates the expired conversation", async () => {
  const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations" ? response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }) : response({}, 401) });
  await start(f); f.access().rememberConversationAccess("conversation-a", token(true));
  const h = handlerParams(product);
  assert.equal(await f.load("lib/handlers/conversation.handlers.ts").handleSendMessage(h.params), null);
  assert.equal(messageCalls(f).length, 0); assert.equal(f.calls.filter(call => call.url === "/api/storefront-conversations").length, 1);
  assert.equal(h.effects.cartClears, 0); assert.deepEqual(h.effects.conversationChanges, []);
});

test("unknown-capability compatibility selection is not retried after a failed legacy-format POST", async () => {
  const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations" ? response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token() }) : response({}, 401) });
  await start(f);
  await assert.rejects(f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product }));
  assert.equal(messageCalls(f).length, 1); assert.equal("ui_action" in JSON.parse(messageCalls(f)[0].body), false);
  assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 0);
});

test("start without a matching authoritative merchant never enables typed support", async () => {
  for (const merchant_id of [undefined, "merchant-b"]) {
    const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations" ? response({ merchant_id, conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }) : response({ message: "Resultado", blocks: [] }) });
    if (merchant_id !== undefined) {
      await assert.rejects(start(f), /conversation_start_merchant_mismatch/);
      assert.deepEqual(plain(f.access().conversationAccessHeaders("conversation-a")), {});
      assert.equal(f.storage.size, 0);
      assert.equal(messageCalls(f).length, 0);
      continue;
    }
    await start(f);
    await f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product });
    assert.equal("ui_action" in JSON.parse(messageCalls(f)[0].body), false);
  }
});

test("failed forced renewal invalidates stale protocol support even if old access remains locally", async () => {
  const f = runtime({ fetch: async call => call.url === "/api/storefront-conversations" ? response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability }) : call.url.endsWith("/access") ? response({}, 503) : response({ message: "Resultado", blocks: [] }) });
  await start(f);
  await assert.rejects(f.access().ensureConversationAccess("conversation-a", true));
  await f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product });
  assert.equal("ui_action" in JSON.parse(messageCalls(f)[0].body), false);
});

test("cursor boundaries match the server and identifiers are preserved rather than normalized", async () => {
  for (const cursor of ["", "x".repeat(2048)]) {
    const f = runtime(); await start(f);
    const action = { tool: "search_products", args: { query: "*", categoryId: " category-a ", cursor } };
    await f.client().sendMessage("conversation-a", "Categoria", { merchantId: "merchant-a", uiAction: action });
    assert.deepEqual(JSON.parse(messageCalls(f)[0].body).ui_action, action);
  }
});

test("capability tool subsets cannot accidentally enable a different read tool", async () => {
  const f = runtime({ capability: { version: 1, tools: ["get_product_details"] } }); await start(f);
  await f.client().sendMessage("conversation-a", "Categoria", { merchantId: "merchant-a", uiAction: category });
  await f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product });
  assert.equal("ui_action" in JSON.parse(messageCalls(f)[0].body), false);
  assert.deepEqual(JSON.parse(messageCalls(f)[1].body).ui_action, product);
});

test("invalid block IDs are rejected instead of silently dispatching ambiguous category text", () => {
  const f = runtime(); const events = [];
  const component = f.load("components/blocks/CategoryCarouselBlock.tsx").default;
  const tree = component({ block: { type: "category_carousel", data: { categories: [{ id: "", name: "Nome", slug: "n" }] } }, onQuickReply: (...args) => events.push(args) });
  assert.throws(() => elements(tree, node => node.type === "button")[0].props.onClick(), error => error.message === "invalid_storefront_ui_action");
  assert.deepEqual(events, []);
});

test("existing one-argument category callbacks remain compatible", () => {
  const f = runtime(); const labels = [];
  const component = f.load("components/blocks/CategoryCarouselBlock.tsx").default;
  const tree = component({ block: { type: "category_carousel", data: { categories: [{ id: "category-a", name: "Nome", slug: "n" }] } }, onQuickReply: label => labels.push(label) });
  elements(tree, node => node.type === "button")[0].props.onClick();
  assert.deepEqual(labels, ["Ver produtos de Nome"]);
});

test("typed payload selection follows exactly one successful real access preflight", async () => {
  const shortToken = `${Buffer.from(JSON.stringify({ origin: "https://store.fixture.invalid", expiresAt: Date.now() / 1000 + 30 })).toString("base64url")}.synthetic`;
  const f = runtime({ fetch: async call => call.url.endsWith("/access") ? response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: shortToken, ui_action_capability: capability }) : response({ message: "Resultado", blocks: [] }) });
  f.access().rememberConversationAccess("conversation-a", token(true));
  await f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product });
  assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 1);
  assert.equal(messageCalls(f).length, 1);
  assert.deepEqual(JSON.parse(messageCalls(f)[0].body).ui_action, product);
  assert.equal(new Headers(messageCalls(f)[0].headers).get("Authorization"), `Bearer ${shortToken}`);
});

test("two explicit concurrent commands share one renewal but each has only its own POST", async () => {
  const f = runtime(); f.access().rememberConversationAccess("conversation-a", token(true));
  await Promise.all([f.client().sendMessage("conversation-a", "Categoria", { merchantId: "merchant-a", uiAction: category }), f.client().sendMessage("conversation-a", "Detalhes", { merchantId: "merchant-a", uiAction: product })]);
  assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 1);
  assert.equal(messageCalls(f).length, 2);
  assert.deepEqual(messageCalls(f).map(call => JSON.parse(call.body).ui_action), [category, product]);
});

for (const scenario of ["product mutation", "category cursor mutation", "action and merchant replacement"]) {
  test(`typed click snapshot survives deferred renewal: ${scenario}`, async () => {
    let started, release;
    const renewalStarted = new Promise(resolve => { started = resolve; });
    const renewalBarrier = new Promise(resolve => { release = resolve; });
    const f = runtime({ fetch: async call => {
      if (call.url.endsWith("/access")) {
        started(); await renewalBarrier;
        return response({ merchant_id: "merchant-a", conversation_id: "conversation-a", conversation_token: token(), ui_action_capability: capability });
      }
      return response({ message: "Resultado", blocks: [] });
    } });
    f.access().rememberConversationAccess("conversation-a", token(true));
    const original = scenario === "category cursor mutation"
      ? { tool: "search_products", args: { query: "*", categoryId: "category-original", cursor: "cursor-original" } }
      : { tool: "get_product_details", args: { productId: "product-original" } };
    const expected = plain(original);
    const options = { merchantId: "merchant-a", uiAction: original };
    const send = f.client().sendMessage("conversation-a", "Original click label", options);
    await renewalStarted;
    if (scenario === "product mutation") original.args.productId = "product-changed";
    else if (scenario === "category cursor mutation") { original.args.categoryId = "category-changed"; original.args.cursor = "cursor-changed"; }
    else { options.uiAction = { tool: "search_products", args: { query: "*", categoryId: "replacement" } }; options.merchantId = "merchant-foreign"; }
    release(); await send;
    assert.equal(f.calls.filter(call => call.url.endsWith("/access")).length, 1);
    assert.equal(messageCalls(f).length, 1);
    const body = JSON.parse(messageCalls(f)[0].body);
    assert.deepEqual(body.ui_action, expected);
    assert.equal(body.ui_action_version, 1);
    assert.equal(body.merchant_id, "merchant-a");
    assert.equal(body.user_message, "Original click label");
  });
}

test("RequestInit preparation preserves existing cart and one-click methods, bodies and authorization", async () => {
  const f = runtime(); await start(f);
  const { cartApi, checkoutApi } = f.load("lib/api/api-client.ts");
  await cartApi.get("conversation-a", "merchant-a");
  await cartApi.updateItem("conversation-a", "variant-a", 2, "merchant-a");
  await cartApi.clear("conversation-a", "merchant-a");
  await checkoutApi.configureOneBuyClick("conversation-a", true, "synthetic-buyer");
  const calls = f.calls.slice(1);
  assert.deepEqual(calls.map(call => call.method ?? "GET"), ["GET", "PATCH", "POST", "PATCH"]);
  assert.deepEqual(calls.map(call => call.body ? JSON.parse(call.body) : null), [null, { quantity: 2 }, null, { enabled: true }]);
  for (const call of calls) {
    assert.match(new Headers(call.headers).get("Authorization"), /^Bearer /);
    assert.equal(new Headers(call.headers).get("Content-Type"), "application/json");
    assert.ok(!call.body?.includes("ui_action"));
  }
  assert.equal(new Headers(calls[3].headers).get("X-Buyer-Authorization"), "Bearer synthetic-buyer");
  for (const call of calls.slice(0, 3)) assert.ok(call.url.includes("merchantId=merchant-a"));
});

test("public product reads retain plain-fetch transport with no conversation or action headers", async () => {
  const f = runtime(); const { productsApi } = f.load("lib/api/api-client.ts");
  await productsApi.list("merchant-a", { categoryId: "category-a", cursor: "cursor-a", limit: 10 });
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.includes("/catalog/merchant-a/products?categoryId=category-a&limit=10&cursor=cursor-a"));
  assert.equal(new Headers(f.calls[0].headers).has("Authorization"), false);
  assert.equal(f.calls[0].body, undefined);
});
