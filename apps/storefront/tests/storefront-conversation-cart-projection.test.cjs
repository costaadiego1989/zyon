const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const hooks = []; let cursor = 0;
  const react = {
    createContext: () => ({ Provider: 'Provider' }), createElement: (type, props) => ({ type, props }),
    useContext() {}, useEffect() {}, useCallback: fn => fn,
    useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; },
  };
  const stubs = { react, '@/lib/api/api-client': {}, '@/lib/conversation-access': {},
    '@/lib/checkout-session-access': { forgetStorefrontCheckoutToken() {} },
    '@/lib/commercial-notices': { parseCommercialNotices: value => value },
    './cart-line-selection': { readCartLineSelection: () => undefined } };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/cart-store.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module, exports: module.exports, require: name => { assert.ok(Object.hasOwn(stubs, name), name); return stubs[name]; },
      React: react, console });
  return merchantId => { cursor = 0; return module.exports.CartProvider({ merchantId, children: null }).props.value; };
}
const blocks = (cartId, total = 20) => [{ type: 'cart_summary', data: { cartId, items: [], itemCount: 0, total, discount: 0 } }];
const scope = { merchantId: 'merchant', conversationId: 'conversation', cartId: 'cart' };

test('generic local projection matches its explicitly requested cart and is single-use', () => {
  // This provider capability is not authorization for a separate public cart:
  // the public conversation controller/client require cartId===conversationId.
  const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
  const apply = render('merchant').captureConversationCartProjection(scope);
  assert.equal(apply(blocks('cart', 30)), true);
  assert.equal(render('merchant').cart.total, 30);
  assert.equal(apply(blocks('cart', 99)), false);
  assert.equal(render('merchant').cart.total, 30);
});
test('cross-sell replacement rejects the late chat cart even when cartId is unchanged', () => {
  const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
  const view = render('merchant'), apply = view.captureConversationCartProjection(scope);
  view.updateFromBlocks(blocks('cart', 50));
  assert.equal(apply(blocks('cart', 10)), false);
  assert.equal(render('merchant').cart.total, 50);
});
test('merchant ABA invalidates captured projection without a layout change', () => {
  const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
  const apply = render('merchant').captureConversationCartProjection(scope);
  render('other'); render('merchant');
  assert.equal(apply(blocks('cart', 10)), false);
});
test('wrong cart identity is rejected and cannot consume a second successful projection', () => {
  const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
  const apply = render('merchant').captureConversationCartProjection(scope);
  assert.equal(apply(blocks('foreign', 10)), false);
  assert.equal(apply(blocks('cart', 10)), false);
  assert.equal(render('merchant').cart.total, 20);
});
test('empty initial cart adopts only the request conversation fallback', () => {
  const render = fixture();
  const apply = render('merchant').captureConversationCartProjection({ merchantId: 'merchant', conversationId: 'conversation' });
  assert.equal(apply(blocks('conversation', 25)), true);
  assert.equal(render('merchant').cart.cartId, 'conversation');
});
test('clear and no-summary responses cannot bypass freshness for dependent financial effects', () => {
  const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
  const view = render('merchant'), apply = view.captureConversationCartProjection(scope);
  view.clearCart();
  assert.equal(apply([{ type: 'checkout_prepared', data: { cartId: 'cart' } }]), false);
  assert.equal(render('merchant').cart.cartId, null);
});
test('fresh text-only response preserves dependent-effect freshness without inventing a cart', () => {
  const render = fixture();
  const apply = render('merchant').captureConversationCartProjection({ merchantId: 'merchant', conversationId: 'conversation' });
  assert.equal(apply([{ type: 'text', data: {} }]), true);
  assert.equal(render('merchant').cart.cartId, null);
});
test('missing or duplicate summary identity never projects a cart', () => {
  for (const response of [blocks(undefined), [...blocks('cart'), ...blocks('cart')]]) {
    const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
    const apply = render('merchant').captureConversationCartProjection(scope);
    assert.equal(apply(response), false);
    assert.equal(render('merchant').cart.total, 20);
  }
});
test('a retained old merchant callback cannot acquire the current merchant cart', () => {
  const render = fixture(); const oldView = render('merchant');
  render('other');
  const apply = oldView.captureConversationCartProjection(scope);
  assert.equal(apply(blocks('cart')), false);
  assert.equal(render('other').cart.cartId, null);
});
test('public conversation identity cannot project over an unrelated current cart', () => {
  const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
  const apply = render('merchant').captureConversationCartProjection({ merchantId: 'merchant', conversationId: 'conversation', cartId: 'conversation' });
  assert.equal(apply(blocks('conversation', 10)), false);
  assert.equal(render('merchant').cart.cartId, 'cart');
});
for (const withSummary of [false, true]) test(`foreign prepared checkout is rejected before any cart projection (summary=${withSummary})`, () => {
  const render = fixture(); render('merchant').updateFromBlocks(blocks('cart'));
  const apply = render('merchant').captureConversationCartProjection(scope);
  const response = withSummary ? blocks('cart', 50) : [];
  response.push({ type: 'checkout_prepared', data: { cartId: 'foreign', actionId: 'action', shippingPreference: 'cheapest', paymentPreference: 'pix' } });
  assert.equal(apply(response), false);
  assert.equal(render('merchant').cart.total, 20);
});
