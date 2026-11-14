const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, stubs = {}) {
  const module = { exports: {} };
  const localRequire = name => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.startsWith('.')) {
      const target = path.resolve(path.dirname(file), name);
      for (const suffix of ['', '.ts', '.tsx']) if (fs.existsSync(target + suffix) && fs.statSync(target + suffix).isFile()) return load(target + suffix, stubs);
    }
    return require(name);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  } }).outputText, { module, exports: module.exports, require: localRequire, console, React: stubs.react,
    process: { env: {} }, setTimeout, clearTimeout, ...stubs.__globals });
  return module.exports;
}
const file = path.join(__dirname, '../src/lib/cart-line-selection.ts');
const plain = value => JSON.parse(JSON.stringify(value));
test('front preserves explicit empty selection and rejects contradictory option identities', () => {
  const { readCartLineSelection } = load(file);
  assert.deepEqual(plain(readCartLineSelection({ optionItemIds: [] })), { optionItemIds: [] });
  assert.equal(readCartLineSelection({}), undefined);
  assert.throws(() => readCartLineSelection({ optionItemIds: ['s'], selectedOptions: [{ itemId: 'l' }] }), /cart_line_selection_invalid/);
  assert.throws(() => readCartLineSelection({ optionItemIds: ['s', 's'] }), /cart_line_selection_invalid/);
  assert.deepEqual(plain(readCartLineSelection({ optionItemIds: [], serviceSlotId: null })), { optionItemIds: [], serviceSlotId: null });
  assert.throws(() => readCartLineSelection({ serviceSlotId: null, selectedServiceSlotId: 'a' }), /cart_line_selection_invalid/);
});
test('front line keys distinguish same variant options and service slots', () => {
  const { cartLineKey, readCartLineSelection } = load(file);
  assert.notEqual(cartLineKey({ variantId: 'v', optionItemIds: ['small'] }), cartLineKey({ variantId: 'v', optionItemIds: ['large'] }));
  assert.notEqual(cartLineKey({ variantId: 'v', optionItemIds: [], serviceSlotId: 'a' }), cartLineKey({ variantId: 'v', optionItemIds: [], serviceSlotId: 'b' }));
  assert.equal(cartLineKey({ variantId: 'v', optionItemIds: ['s', 'b'] }), cartLineKey({ variantId: 'v', optionItemIds: ['b', 's'] }));
  assert.deepEqual(plain(readCartLineSelection({ selectedOptions: [{ itemId: 'small' }], selectedServiceSlotId: 'slot' })),
    { optionItemIds: ['small'], serviceSlotId: 'slot' });
});
test('real shared CartSheet click closures target equal-price color lines and accessible titles distinguish them', () => {
  // Execute real JSX callbacks with a hook/element double, not a browser or a
  // real React renderer. DOM layout, focus, hit targets and paint are not proven.
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: value => [value, () => {}], useEffect: () => {} };
  const { CartSheet } = load(path.join(__dirname, '../../../packages/checkout-ui/src/CartSheet.tsx'), { react });
  const calls = [], item = (color, quantity) => ({ variantId: 'v', optionItemIds: [color], serviceSlotId: null,
    selectionLabel: 'Cor: ' + color, productName: 'Camiseta', quantity, price: 20, subtotal: quantity * 20 });
  const tree = CartSheet({ open: true, cart: { items: [item('Azul', 1), item('Vermelho', 2)], itemCount: 3, subtotal: 60, discount: 0, total: 60 },
    onClose() {}, onCheckout() {}, onUpdateQty: (...args) => calls.push(['update', ...plain(args)]), onRemoveItem: (...args) => calls.push(['remove', ...plain(args)]) });
  const nodes = []; function visit(value) { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object') return;
    nodes.push(value); visit(value.props?.children); } visit(tree);
  const buttons = nodes.filter(node => node.type === 'button' && node.props.className === 'ckui-quantity');
  assert.equal(buttons.length, 4);
  buttons[0].props.onClick(); buttons[2].props.onClick(); buttons[1].props.onClick();
  assert.deepEqual(calls, [ ['remove', 'v', { optionItemIds: ['Azul'], serviceSlotId: null }],
    ['update', 'v', 1, { optionItemIds: ['Vermelho'], serviceSlotId: null }], ['update', 'v', 2, { optionItemIds: ['Azul'], serviceSlotId: null }] ]);
  assert.notEqual(buttons[0].props['aria-label'], buttons[2].props['aria-label']);
  assert.deepEqual(nodes.filter(node => node.props?.title).map(node => node.props.title), ['Camiseta — Cor: Azul', 'Camiseta — Cor: Vermelho']);
  assert.equal(new Set(nodes.filter(node => node.props?.key && String(node.props.key).startsWith('["v"')).map(node => node.props.key)).size, 2);
});
test('real API client sends exact identity in PATCH and keeps legacy requests selector-free', async () => {
  const calls = [];
  const { cartApi } = load(path.join(__dirname, '../src/lib/api/api-client.ts'), {
    '../conversation-access': { conversationFetch: async (cartId, url, request) => {
      calls.push({ cartId, url, ...request() }); return { ok: true, json: async () => ({ cartId, items: [] }) };
    } }, '../storefront-read-ui-action': {}, '../cross-sell-quote': {}, '@/lib/services/http': {},
  });
  await cartApi.updateItem('cart', 'v', 0, 'merchant', { optionItemIds: ['blue'], serviceSlotId: null });
  await cartApi.updateItem('cart', 'unique', 2, 'merchant');
  assert.deepEqual(JSON.parse(calls[0].body), { quantity: 0, optionItemIds: ['blue'], serviceSlotId: null });
  assert.deepEqual(JSON.parse(calls[1].body), { quantity: 2 }); assert.equal(calls[0].cartId, 'cart');
  assert.equal(calls[0].method, 'PATCH'); assert.ok(calls[0].url.endsWith('/storefront/cart/cart/items/v?merchantId=merchant'));
});
test('real CartProvider preserves block selection and forwards it through quantity action transport', async () => {
  const calls = [], snapshots = [], seed = { cartId: 'cart', items: [], itemCount: 0, total: 0, discount: 0 };
  const react = { createContext: () => ({ Provider: 'Provider' }), createElement: (type, props) => ({ type, props }), useEffect() {},
    useRef: value => ({ current: value }), useCallback: fn => fn, useContext() {}, useState: initial => {
      let value = initial && Array.isArray(initial.items) ? seed : initial;
      return [value, next => { value = typeof next === 'function' ? next(value) : next;
        if (value && Array.isArray(value.items)) snapshots.push(plain(value)); }];
    } };
  const data = { cartId: 'cart', items: [{ variantId: 'v', productName: 'Shirt', quantity: 1, price: 20, subtotal: 20,
    optionItemIds: ['blue'], serviceSlotId: null, selectionLabel: 'Cor: Azul' }], itemCount: 1, total: 20, discount: 0 };
  const { CartProvider } = load(path.join(__dirname, '../src/lib/cart-store.tsx'), { react,
    '@/lib/api/api-client': { cartApi: { updateItem: async (...args) => { calls.push(plain(args)); return data; } } },
    '@/lib/conversation-access': {}, '@/lib/checkout-session-access': {},
    '@/lib/commercial-notices': { parseCommercialNotices: value => value },
  });
  const view = CartProvider({ merchantId: 'merchant', children: null }).props.value;
  view.updateFromBlocks([{ type: 'cart_summary', data }]);
  assert.equal(snapshots.at(-1).items[0].selectionLabel, 'Cor: Azul');
  assert.deepEqual(snapshots.at(-1).items[0].optionItemIds, ['blue']); assert.equal(snapshots.at(-1).items[0].serviceSlotId, null);
  const { handleUpdateQuantity } = load(path.join(__dirname, '../src/lib/handlers/conversation.handlers.ts'), {
    '@/lib/services/conversation.service': {}, '@/lib/api/api-client': {}, '@/lib/buyer-auth': {}, '@/lib/conversation-access': {},
    '@/lib/storefront-read-ui-action': {}, '@/lib/storefront-suggested-read-actions': {}, '@/lib/trigger-messages': {},
  });
  await handleUpdateQuantity({ cartId: 'cart', merchantId: 'merchant', variantId: 'v', quantity: 0,
    selection: { optionItemIds: ['blue'], serviceSlotId: null }, updateItemQuantity: view.updateItemQuantity });
  assert.deepEqual(calls, [['cart', 'v', 0, 'merchant', { optionItemIds: ['blue'], serviceSlotId: null }]]);
});
test('real CartProvider ignores an old mutation response after a newer cart block replaced the snapshot', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; }), snapshots = [];
  const seed = { cartId: 'cart-a', items: [], itemCount: 0, total: 0, discount: 0 };
  const react = { createContext: () => ({ Provider: 'Provider' }), createElement: (type, props) => ({ type, props }), useEffect() {},
    useRef: value => ({ current: value }), useCallback: fn => fn, useContext() {}, useState: initial => {
      let value = initial && Array.isArray(initial.items) ? seed : initial;
      return [value, next => { value = typeof next === 'function' ? next(value) : next;
        if (value && Array.isArray(value.items)) snapshots.push(plain(value)); }];
    } };
  const { CartProvider } = load(path.join(__dirname, '../src/lib/cart-store.tsx'), { react,
    '@/lib/api/api-client': { cartApi: { updateItem: async () => pending } }, '@/lib/conversation-access': {},
    '@/lib/checkout-session-access': {}, '@/lib/commercial-notices': { parseCommercialNotices: value => value },
  });
  const view = CartProvider({ merchantId: 'merchant', children: null }).props.value;
  const old = view.updateItemQuantity('v', 0, { optionItemIds: ['blue'], serviceSlotId: null });
  view.updateFromBlocks([{ type: 'cart_summary', data: { ...seed, cartId: 'cart-b', total: 50 } }]);
  release({ ...seed, cartId: 'cart-a', total: 20 }); await old;
  assert.equal(snapshots.at(-1).cartId, 'cart-b'); assert.equal(snapshots.at(-1).total, 50);
});
for (const oldOutcome of ['success', 'error']) test(`old ${oldOutcome} finally cannot clear a new cart command's busy state or singleflight`, async () => {
  const hooks = [], requests = []; let cursor = 0;
  const seed = { cartId: 'cart-a', items: [], itemCount: 0, total: 0, discount: 0 };
  const react = { createContext: () => ({ Provider: 'Provider' }), createElement: (type, props) => ({ type, props }), useEffect() {},
    useContext() {}, useCallback: fn => fn, useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = index === 0 ? seed : initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; } };
  const { CartProvider } = load(path.join(__dirname, '../src/lib/cart-store.tsx'), { react,
    '@/lib/api/api-client': { cartApi: { updateItem: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } },
    '@/lib/conversation-access': { ConversationSessionExpiredError: class extends Error {} },
    '@/lib/checkout-session-access': {}, '@/lib/commercial-notices': { parseCommercialNotices: value => value },
  });
  const render = () => { cursor = 0; return CartProvider({ merchantId: 'merchant', children: null }).props.value; };
  const first = render(), old = first.updateItemQuantity('v', 0);
  first.updateFromBlocks([{ type: 'cart_summary', data: { ...seed, cartId: 'cart-b', total: 50 } }]);
  const second = render(), current = second.updateItemQuantity('v', 1);
  if (oldOutcome === 'success') requests[0].resolve({ ...seed, cartId: 'cart-a', total: 20 }); else requests[0].reject(new Error('old_request_failed'));
  await old; assert.equal(render().updating, true); assert.equal(render().error, null);
  await second.updateItemQuantity('v', 2); assert.equal(requests.length, 2); // No new send while cart-b owns the token.
  requests[1].resolve({ ...seed, cartId: 'cart-b', total: 50 }); await current;
  assert.equal(render().updating, false); assert.equal(render().cart.cartId, 'cart-b');
});
function providerLifecycleFixture(get) {
  const hooks = [], effects = [], storage = new Map([['zyon-cart-id:merchant-a', 'cart-a']]); let cursor = 0;
  const react = { createContext: () => ({ Provider: 'Provider' }), createElement: (type, props) => ({ type, props }),
    useContext() {}, useCallback: fn => fn, useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; },
    useEffect: (work, deps) => { const index = cursor++, prior = hooks[index];
      if (!prior || JSON.stringify(prior.deps) !== JSON.stringify(deps)) effects.push(() => {
        prior?.cleanup?.(); hooks[index] = { deps, cleanup: work() }; }); },
  };
  const { CartProvider } = load(path.join(__dirname, '../src/lib/cart-store.tsx'), { react,
    '@/lib/api/api-client': { cartApi: { get } }, '@/lib/conversation-access': {}, '@/lib/checkout-session-access': {},
    '@/lib/commercial-notices': { parseCommercialNotices: value => value },
    __globals: { window: {}, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
  });
  return { render: merchantId => { cursor = 0; return CartProvider({ merchantId, children: null }).props.value; },
    flush: async () => { for (const work of effects.splice(0)) work(); await Promise.resolve(); await Promise.resolve(); } };
}
const bootstrapCart = cartId => ({ cartId, items: [{ variantId: 'v', productName: 'Old merchant shirt', quantity: 1,
  price: 20, subtotal: 20, optionItemIds: ['blue'], serviceSlotId: null }], itemCount: 1, total: 20, discount: 0 });
test('merchant without a saved cart never exposes the previous merchant cart or reference, even before effects', async () => {
  const f = providerLifecycleFixture(async () => bootstrapCart('cart-a'));
  f.render('merchant-a'); await f.flush(); assert.equal(f.render('merchant-a').cart.cartId, 'cart-a');
  const immediate = f.render('merchant-b'); assert.equal(immediate.cart.cartId, null); assert.deepEqual(plain(immediate.cart.items), []);
  await f.flush(); const settled = f.render('merchant-b'); assert.equal(settled.cart.cartId, null); assert.deepEqual(plain(settled.cart.items), []);
});
test('bootstrap GET cannot apply a cart with a different reference than the saved request', async () => {
  const calls = [], f = providerLifecycleFixture(async (...args) => { calls.push(args); return bootstrapCart('foreign-cart'); });
  f.render('merchant-a'); await f.flush(); const view = f.render('merchant-a');
  assert.equal(view.cart.cartId, null); assert.deepEqual(plain(view.cart.items), []); assert.ok(view.error);
  assert.deepEqual(calls, [['cart-a', 'merchant-a']]);
});
