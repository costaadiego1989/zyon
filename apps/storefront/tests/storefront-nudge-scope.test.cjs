const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture({ deferredUpdater = false } = {}) {
  let current = true, resolve, reject;
  const effects = [], timers = new Map(), updaters = [], calls = [];
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/handlers/conversation-nudge.handlers.ts'), 'utf8');
  const stubs = { '@/lib/trigger-messages': { getTriggerMessage: () => 'Fallback', TRIGGER_MESSAGES: {} },
    '@/lib/api/api-client': { checkoutApi: { generateNudge: (...args) => { calls.push(args); return pending; } } } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020 } }).outputText,
    { module, exports: module.exports, require: name => { assert.ok(Object.hasOwn(stubs, name), name); return stubs[name]; },
      crypto: { randomUUID: () => 'synthetic-id' }, setTimeout: fn => { const key = {}; timers.set(key, fn); return key; },
      clearTimeout: key => timers.delete(key) });
  const params = { triggerEvent: 'idle_30_seconds', stage: 'browsing', merchantId: 'merchant', conversationId: 'conversation',
    agentMode: 'proactive', widgetConfig: {}, isCurrent: () => current,
    setMode: value => effects.push(['mode', value]), setIsLoading: value => effects.push(['loading', value]),
    setMessages: updater => deferredUpdater ? updaters.push(updater) : effects.push(['messages', updater([])]),
    canFireTrigger: () => true, recordTriggerFired: (...args) => effects.push(['record', ...args]) };
  return { params, effects, timers, updaters, calls, resolve, reject,
    fire: () => module.exports.handleFireNudge(params), invalidate: () => { current = false; },
    settle: async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}
for (const outcome of ['success', 'error', 'timer']) test(`stale ${outcome} nudge cannot append a message or clear another scope loading`, async () => {
  const f = fixture(); f.fire(); assert.equal(f.calls.length, 1);
  f.invalidate(); f.effects.length = 0;
  if (outcome === 'success') f.resolve({ message: 'Late' });
  if (outcome === 'error') f.reject(new Error('synthetic'));
  if (outcome === 'timer') [...f.timers.values()][0]();
  await f.settle(); assert.deepEqual(f.effects, []);
});
test('initially stale nudge never records trigger, sends or projects', () => {
  const f = fixture(); f.invalidate(); f.fire();
  assert.deepEqual(f.effects, []); assert.deepEqual(f.calls, []); assert.equal(f.timers.size, 0);
});
test('deferred message updater checks scope at React application time', async () => {
  const f = fixture({ deferredUpdater: true }); f.fire(); f.resolve({ message: 'Own reply' }); await f.settle();
  assert.equal(f.updaters.length, 1); f.invalidate();
  const replacement = [{ id: 'new', text: 'New merchant' }];
  assert.strictEqual(f.updaters[0](replacement), replacement);
});
test('current nudge still reveals once and a late server response cannot duplicate timer fallback', async () => {
  const f = fixture(); f.fire(); [...f.timers.values()][0](); f.resolve({ message: 'Later' }); await f.settle();
  assert.equal(f.effects.filter(effect => effect[0] === 'messages').length, 1);
  assert.equal(f.effects.filter(effect => effect[0] === 'loading' && effect[1] === false).length, 1);
});
test('current nudge preserves synthetic server response and legacy missing-conversation fallback', async () => {
  const f = fixture(); f.fire(); f.resolve({ message: 'Current' }); await f.settle();
  assert.equal(f.effects.find(effect => effect[0] === 'messages')[1][0].text, 'Current');
  const g = fixture(); g.params.conversationId = null; g.fire();
  assert.equal(g.calls.length, 0); assert.equal(g.effects.find(effect => effect[0] === 'messages')[1][0].text, 'Fallback');
});
test('admission callback runs once before effects, never on cooldown or manual rejection', () => {
  const f = fixture(); let admitted = 0;
  f.params.onAdmitted = () => { assert.equal(f.effects.length, 0); admitted++; };
  f.fire(); assert.equal(admitted, 1);
  for (const reason of ['manual', 'cooldown']) {
    const g = fixture(); g.params.onAdmitted = () => assert.fail('rejected nudge must not acquire generation');
    if (reason === 'manual') g.params.agentMode = 'manual_only'; else g.params.canFireTrigger = () => false;
    g.fire(); assert.equal(g.effects.length, 0); assert.equal(g.calls.length, 0);
  }
});
