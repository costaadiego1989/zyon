const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(relative, overrides = {}) {
  const file = path.resolve(__dirname, "../src", relative);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = new Module(file, module); mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
  const originalRequire = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(overrides, id) ? overrides[id] : id.endsWith(".module.css")
    ? { default: { button: "cashback-navigation" } } : originalRequire(id);
  mod._compile(compiled, file);
  return mod.exports;
}
const { storeCashbackEnabled, hasExistingCashback, cashbackWelcomeReplies, isCashbackBalanceLink } = load("lib/cashback-navigation.ts");
const { CashbackNavigation } = load("components/CashbackNavigation.tsx");
const wallet = amounts => ({ merchantId: "store-a", buyerId: "buyer", currency: "BRL",
  program: { status: "paused" }, balance: { availableCents: 0, pendingCents: 0, reservedCents: 0, ...amounts } });

test("MU-03 merchant-enabled storefront exposes a named Cashback balance action", () => {
  const enabled = storeCashbackEnabled({ merchantId: "store-a", cashbackEnabled: true }, "store-a");
  const html = renderToStaticMarkup(React.createElement(CashbackNavigation, { enabled, onOpen() {} }));
  assert.match(html, /aria-label="Consultar cashback"/); assert.match(html, />Cashback<\/span>/);
});

test("MU-01 public hint requires the exact merchant and an explicit true boolean", () => {
  for (const value of [undefined, null, {}, { merchantId: "store-b", cashbackEnabled: true },
    { merchantId: "store-a", cashbackEnabled: false }, { merchantId: "store-a", cashbackEnabled: "true" },
    { merchantId: "store-a", cashbackEnabled: 1 }]) {
    assert.equal(storeCashbackEnabled(value, "store-a"), false);
  }
  assert.equal(storeCashbackEnabled({ merchantId: "store-a", cashbackEnabled: true }, undefined), false);
});

test("MU-04 disabled, draft, paused and unavailable hints do not render the menu action", () => {
  for (const status of ["disabled", "draft", "paused", "unavailable"]) {
    const enabled = storeCashbackEnabled({ merchantId: "store-a", cashbackEnabled: false, status }, "store-a");
    assert.equal(renderToStaticMarkup(React.createElement(CashbackNavigation, { enabled, onOpen() {} })), "");
  }
  assert.equal(renderToStaticMarkup(React.createElement(CashbackNavigation, { enabled: "true", onOpen() {} })), "");
});

test("MU-04 paused earned, pending and reserved credits remain reachable from the account", () => {
  for (const amounts of [{ availableCents: 3500 }, { pendingCents: 500 }, { reservedCents: 1500 }]) {
    assert.equal(hasExistingCashback(wallet(amounts), 0), true);
  }
  assert.equal(hasExistingCashback(wallet({}), 6), true);
  assert.equal(hasExistingCashback(wallet({}), 0), false);
  assert.equal(hasExistingCashback(null, 6), false);
});

test("MU-04 configured welcome shortcuts follow current availability while preserving every other choice", () => {
  const labels = ["Ver produtos", "Cashback", "Meus dados", "Meu saldo de cashback", "Ofertas"];
  assert.deepEqual(cashbackWelcomeReplies(labels, false), ["Ver produtos", "Meus dados", "Ofertas"]);
  assert.deepEqual(cashbackWelcomeReplies(labels, true), labels);
  for (const label of ["Cashback", "/cashback", "Meu saldo de cashback", "Consultar cashback"]) assert.equal(isCashbackBalanceLink(label), true);
  for (const label of ["Ver produtos", "Usar R$ 10 de cashback", "Remover cashback"]) assert.equal(isCashbackBalanceLink(label), false);
});

function hookHarness(loadConfig) {
  let cursor = 0, output, callbacks = [], state = [], effects = [], props = ["store-a", "store-a", true];
  const listeners = new Map();
  const fakeWindow = { setTimeout, clearTimeout, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const fakeDocument = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const oldWindow = global.window, oldDocument = global.document;
  global.window = fakeWindow; global.document = fakeDocument;
  const react = { useState(value) { const key = cursor++; if (!(key in state)) state[key] = value; return [state[key], next => { state[key] = typeof next === "function" ? next(state[key]) : next; }]; },
    useRef(value) { const key = cursor++; if (!(key in state)) state[key] = { current: value }; return state[key]; },
    useCallback(fn, deps) { const key = cursor++, previous = callbacks[key]; if (!previous || deps.some((d, i) => d !== previous.deps[i])) callbacks[key] = { fn, deps }; return callbacks[key].fn; },
    useEffect(fn, deps) { const key = cursor++, previous = effects[key]; if (!previous || deps.some((d, i) => d !== previous.deps[i])) effects[key] = { fn, deps, cleanup: previous?.cleanup, pending: true }; } };
  const { useStoreCashbackNavigation } = load("lib/hooks/useStoreCashbackNavigation.ts", { react,
    "../services/http": { apiCall: loadConfig }, "../cashback-navigation": { storeCashbackEnabled } });
  const render = (...next) => { if (next.length) props = next; cursor = 0; output = useStoreCashbackNavigation(...props); return output; };
  return { render, runEffects() { for (const effect of effects.filter(Boolean)) if (effect.pending) { effect.cleanup?.(); effect.pending = false; effect.cleanup = effect.fn(); } },
    close() { for (const effect of effects.filter(Boolean)) effect.cleanup?.(); global.window = oldWindow; global.document = oldDocument; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("MU-01 late availability from another merchant cannot reveal its menu on the new store", async () => {
  const pending = [];
  const h = hookHarness((route, init) => new Promise(resolve => pending.push({ route, init, resolve })));
  try {
    h.render(); h.runEffects();
    assert.equal(h.render("store-b", "store-b", false).enabled, false); h.runEffects();
    pending[1].resolve({ merchantId: "store-b", cashbackEnabled: false }); await settle();
    pending[0].resolve({ merchantId: "store-a", cashbackEnabled: true }); await settle();
    assert.equal(h.render().enabled, false);
    assert.equal(pending[0].init.signal.aborted, true);
    assert.equal(pending[1].init.authRequired, false); assert.equal(pending[1].init.cache, "no-store");
  } finally { h.close(); }
});

test("MU-04 refreshed pause or network failure hides a previously enabled menu", async () => {
  let calls = 0;
  const h = hookHarness(async () => { if (++calls === 1) return { merchantId: "store-a", cashbackEnabled: false }; throw Error("offline"); });
  try {
    h.render(); h.runEffects(); await settle(); assert.equal(h.render().enabled, false);
    assert.equal(await h.render().refresh(), false); assert.equal(h.render().enabled, false);
  } finally { h.close(); }
});

test("MU-01 an unavailable refresh closes an enabled menu rather than keeping stale availability", async () => {
  let unavailable = false;
  const h = hookHarness(async () => { if (unavailable) throw Error("offline"); return { merchantId: "store-a", cashbackEnabled: true }; });
  try {
    h.render(); h.runEffects(); await settle(); assert.equal(h.render().enabled, true);
    unavailable = true;
    assert.equal(await h.render().refresh(), false); assert.equal(h.render().enabled, false);
  } finally { h.close(); }
});
