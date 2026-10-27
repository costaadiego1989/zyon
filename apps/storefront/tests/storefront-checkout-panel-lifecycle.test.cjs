const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const props = { merchantId: 'synthetic-merchant', globalUserId: 'synthetic-buyer', cartRef: 'synthetic-cart', onClose() {} };
const reply = value => Response.json({ embed_session_token: value, expires_at_unix: 2000000000 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Executes the actual content/effect code. This deterministic hook scheduler is
// NOT a React DOM/browser, API authorization or real widget/payment proof.
function runtime(options = {}) {
  const calls = [], listeners = new Map(), storage = new Map(), modules = new Map(); let current;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const owner = current, index = owner.index++; if (!owner.hooks[index]) owner.hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      const cell = owner.hooks[index]; return [cell.value, value => { if (!owner.mounted) owner.lateWrites++; cell.value = typeof value === 'function' ? value(cell.value) : value; }]; },
    useRef(value) { const index = current.index++; return current.hooks[index] ??= { current: value }; },
    useEffect(effect, deps) { const owner = current, index = owner.index++, cell = owner.hooks[index];
      if (!cell || !depsEqual(cell.deps, deps)) owner.effects.push(() => { cell?.cleanup?.(); owner.hooks[index] = { deps, cleanup: effect() }; }); },
    useCallback(callback, deps) { const index = current.index++, cell = current.hooks[index];
      if (cell && depsEqual(cell.deps, deps)) return cell.value; current.hooks[index] = { deps, value: callback }; return callback; },
    lazy: () => 'InlineCheckoutFixture', Suspense: 'SuspenseFixture',
  };
  const context = vm.createContext({ Promise, URL, Map, JSON, Error, Number, Object, String, console, atob,
    process: { env: {} }, window: { location: { origin: 'https://store.fixture.invalid' },
      addEventListener: (name, fn) => { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); },
      removeEventListener: (name, fn) => listeners.get(name)?.delete(fn) },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  const getCart = () => ({ cart: { cartId: props.cartRef }, clearCart() {} });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const extra = file.endsWith('CheckoutPanel.tsx') ? '\nmodule.exports.__content = CheckoutPanelContent;' : '';
    vm.runInContext(`(function(require,module,exports){${source}${extra}\n})`, context)(id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (id === '@/lib/cart-store') return { useCart: getCart };
      if (id === '@/lib/api/api-client') return { cartApi: { clear: async () => {} } };
      if (id === '@/lib/buyer-auth' || id === './buyer-auth') return { getValidBuyer: () => ({ token: 'synthetic-buyer-proof' }) };
      if (id === '@/lib/conversation-access' || id === './conversation-access') return { conversationFetch: async (cart, url, init) => {
        calls.push({ cart, url, body: JSON.parse(init.body) }); return options.fetch ? options.fetch(calls) : reply(`synthetic-${calls.length}`);
      } };
      if (id === '@/lib/checkout-session-access') return load('lib/checkout-session-access.ts');
      if (id === './CheckoutErrorBoundary') return { __esModule: true, default: 'BoundaryFixture' };
      throw Error('unexpected dependency: ' + id);
    }, module, module.exports);
    return module.exports;
  }
  const content = load('components/CheckoutPanel.tsx').__content;
  function mount(value = props) {
    const owner = { hooks: [], effects: [], index: 0, mounted: true, lateWrites: 0, props: value };
    owner.render = (next = owner.props) => { owner.props = next; owner.index = 0; current = owner; owner.tree = content(next);
      for (const effect of owner.effects.splice(0)) effect(); current = undefined; return owner.tree; };
    owner.unmount = () => { owner.mounted = false; for (const cell of owner.hooks) cell?.cleanup?.(); };
    owner.render(); return owner;
  }
  return { mount, calls, storage, settle: async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); } };
}
function inline(tree) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'InlineCheckoutFixture') return tree;
  const children = tree.props?.children; return (Array.isArray(children) ? children : [children]).map(inline).find(Boolean) ?? null;
}

test('hosted product detail suspends the existing inline checkout without dropping its token or repeating bootstrap', async () => {
  const f = runtime(), onOpenProductDetail = () => {}, value = { ...props, onOpenProductDetail };
  const panel = f.mount(value); await f.settle(); const before = inline(panel.render());
  assert.equal(before.props.onOpenProductDetail, onOpenProductDetail); assert.equal(f.calls.length, 1);
  const suspended = panel.render({ ...value, suspended: true });
  assert.equal(suspended.props.style.display, 'none'); assert.equal(inline(suspended).props.embedToken, before.props.embedToken);
  const restored = panel.render(value); assert.equal(restored.props.style.display, 'flex');
  assert.equal(inline(restored).props.embedToken, before.props.embedToken); assert.equal(f.calls.length, 1);
});

test('actual panel remount submits the previously returned token, preserving current buyer proof', async () => {
  const f = runtime(), first = f.mount(); await f.settle(); assert.equal(inline(first.render()).props.embedToken, 'synthetic-1');
  first.unmount(); const second = f.mount(); await f.settle(); assert.equal(inline(second.render()).props.embedToken, 'synthetic-2');
  assert.equal(f.calls[1].body.previous_embed_token, 'synthetic-1'); assert.equal(f.calls[1].body.buyer_access_token, 'synthetic-buyer-proof');
  second.unmount();
});

test('two simultaneous panel mounts share token issuance instead of minting two checkout sessions', async () => {
  const barrier = deferred(), f = runtime({ fetch: () => barrier.promise }); const a = f.mount(), b = f.mount();
  assert.equal(f.calls.length, 1); barrier.resolve(reply('shared')); await f.settle();
  assert.equal(inline(a.render()).props.embedToken, 'shared'); assert.equal(inline(b.render()).props.embedToken, 'shared'); a.unmount(); b.unmount();
});

test('detached panel ignores late state updates, while next mount can use the captured receipt', async () => {
  const barrier = deferred(), f = runtime({ fetch: calls => calls.length === 1 ? barrier.promise : reply('continued') });
  const old = f.mount(); old.unmount(); barrier.resolve(reply('late-first')); await f.settle();
  assert.equal(old.lateWrites, 0); const next = f.mount(); await f.settle();
  assert.equal(f.calls[1].body.previous_embed_token, 'late-first'); assert.equal(inline(next.render()).props.embedToken, 'continued'); next.unmount();
});

test('context change immediately removes old render token and ignores an older response', async () => {
  const barrier = deferred(), f = runtime({ fetch: calls => calls.length === 1 ? reply('old-context') : barrier.promise });
  const panel = f.mount(); await f.settle(); panel.render();
  panel.render({ ...props, merchantId: 'other-merchant', cartRef: 'other-cart' });
  assert.equal(inline(panel.render()), null); barrier.resolve(reply('new-context')); await f.settle();
  assert.equal(inline(panel.render()).props.embedToken, 'new-context'); panel.unmount();
});

test('recovered initial token preserves its separate no-issuance path', async () => {
  const f = runtime(), panel = f.mount({ ...props, cartRef: undefined, recovered: true, initialEmbedToken: 'recovered-signed' });
  await f.settle(); const checkout = inline(panel.render()); assert.equal(checkout.props.embedToken, 'recovered-signed');
  assert.equal(checkout.props.cartRef, undefined); assert.equal(f.calls.length, 0); panel.unmount();
});

test('actual refresh callback preserves continuity and does not expose failure as a fresh request', async () => {
  const f = runtime({ fetch: calls => calls.length === 1 ? reply('first') : Response.json({}, { status: 403 }) });
  const panel = f.mount(); await f.settle(); const checkout = inline(panel.render());
  assert.equal(await checkout.props.onRefreshEmbedToken('first'), null);
  panel.unmount(); const reopened = f.mount(); await f.settle();
  assert.equal(f.calls[2].body.previous_embed_token, 'first'); assert.equal(inline(reopened.render()), null); reopened.unmount();
});

test('actual CartProvider clear callback invalidates exact continuity before local reset', () => {
  const filename = path.join(root, 'lib/cart-store.tsx'), source = fs.readFileSync(filename, 'utf8');
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let declaration;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'clearCart') declaration = node; ts.forEachChild(node, visit); }; visit(file);
  assert.ok(declaration && ts.isCallExpression(declaration.initializer));
  const expression = declaration.initializer.arguments[0].getText(file), dependencies = declaration.initializer.arguments[1].getText(file);
  assert.match(dependencies, /cart\.cartId/); const calls = [], empty = { cartId: null, items: [] };
  const snapshotVersionRef = { current: 7 }, updatingRef = { current: { syntheticPendingCommand: true } }, busy = [];
  const callback = vm.runInNewContext(`(${expression})`, { merchantId: props.merchantId, cart: { cartId: props.cartRef },
    forgetStorefrontCheckoutToken: value => calls.push(['forget', JSON.parse(JSON.stringify(value))]), snapshotVersionRef, updatingRef,
    setUpdating: value => busy.push(value),
    EMPTY_CART: empty, setCart: value => calls.push(['cart', value]), setSnapshotMerchantId: () => {}, setError: () => {},
    getStorageKey: merchant => `cart:${merchant}`, sessionStorage: { removeItem: key => calls.push(['remove', key]) } });
  callback(); assert.deepEqual(calls, [['forget', { merchantId: props.merchantId, cartRef: props.cartRef }], ['cart', empty], ['remove', `cart:${props.merchantId}`]]);
  assert.equal(snapshotVersionRef.current, 8); assert.equal(updatingRef.current, null); assert.deepEqual(busy, [false]);
});
