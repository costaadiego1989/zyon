import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as scoped from '../../scoped-conversation.js';
import { prepareConversationTurn } from '../../prepare-conversation-turn.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const requireApi = createRequire(path.resolve(directory, '../../../../../api/package.json'));
const ts = requireApi('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(directory, 'hook.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class Expired extends Error {}

function fixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let denyWrites = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (denyWrites) throw Error('private storage'); values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  let creates = 0;
  let preflight: (id: string) => Promise<void> = async () => {};
  let dispatch: (params: any) => Promise<any> = async () => ({ agentMessage: 'ok', blocks: [] });
  const calls: any[] = [];
  const state: any[] = [];
  const noop = () => {};
  const experiment = { captureFromConversationStart: (value: any) => calls.push(['experiment', value]),
    getTrackingVariantId: () => 'stale-variant', setExperimentGreeting: noop, getExperimentGreeting: () => null };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', source)((name: string) => {
    if (name === 'react') return { useCallback: (fn: any) => fn, useMemo: (fn: any) => fn(),
      useRef: (value: any) => ({ current: value }), useEffect: noop,
      useState: (initial: any) => { const cell = { value: typeof initial === 'function' ? initial() : initial }; state.push(cell);
        return [cell.value, (value: any) => { cell.value = typeof value === 'function' ? value(cell.value) : value; }]; } };
    if (name.endsWith('scoped-conversation')) return scoped;
    if (name.endsWith('prepare-conversation-turn')) return { prepareConversationTurn };
    if (name.endsWith('storefront-read-ui-action')) return { assertStorefrontReadUiAction: noop };
    if (name.endsWith('widget-config')) return { useWidgetConfig: () => ({ config: {} }) };
    if (name.endsWith('cart-store')) return { useCart: () => ({ cart: { cartId: null, itemCount: 0 },
      updateFromBlocks: noop, updateItemQuantity: noop, clearCart: () => calls.push(['clear']),
      captureConversationCartProjection: (scope: any) => { calls.push(['captureProjection', scope]); return () => true; } }) };
    if (name.endsWith('api-client')) return { checkoutApi: { create: async () => {
      creates++; calls.push(['create']); return { conversation_id: 'created-' + creates, merchant_id: 'store', experiment: { variant_id: 'variant-' + creates } };
    } } };
    if (name.endsWith('conversation-access')) return { ConversationSessionExpiredError: Expired,
      conversationAccessHeaders: () => ({ Authorization: 'Bearer synthetic-proof' }),
      conversationAccessMatchesCurrentOrigin: () => true, forgetConversationAccess: noop,
      ensureConversationAccess: async (id: string) => { calls.push(['preflight', id]); await preflight(id); } };
    if (name.endsWith('intervention-tracker')) return { canFireTrigger: () => false, recordTriggerFired: noop, noteActivity: noop };
    if (name.endsWith('analytics')) return { trackConversationStart: noop };
    if (name === './effects') return { useNudgeTriggers: noop, useProactiveMode: noop, useReturnOrderTracking: noop };
    if (name.endsWith('conversation.service')) return { restoreThemePreference: () => null, trackFunnelEvent: noop };
    if (name.endsWith('conversation.handlers')) return { handleQuickReply: noop, handleUpdateQuantity: noop, handleFireNudge: noop,
      initConversation: async (params: any) => { const result = await params.ensureConversation();
        params.setConversationId(result.conversation_id); params.captureFromConversationStart({ conversation_id: result.conversation_id, experiment: result.experiment }); },
      handleSendMessage: async (params: any) => { calls.push(['dispatch', params]); return dispatch(params); } };
    if (name.endsWith('useCheckoutExperiment')) return { useCheckoutExperiment: () => experiment };
    throw Error('Unexpected dependency ' + name);
  }, module, module.exports);
  const vm = module.exports.useConversationViewModel({ storeName: 'Store', merchantId: 'store' });
  return { vm, values, calls, state, creates: () => creates, denyStorageWrites: () => { denyWrites = true; }, access: (next: typeof preflight) => { preflight = next; },
    dispatch: (next: typeof dispatch) => { dispatch = next; }, cleanup: () => {
      if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'sessionStorage');
    } };
}

test('view model initializes and prepares with one owner before capturing its cart projection', async () => {
  const f = fixture();
  try {
    await f.vm.sendMessage('produto');
    assert.equal(f.creates(), 1);
    assert.deepEqual(f.calls.find(call => call[0] === 'captureProjection')[1], { merchantId: 'store', conversationId: 'created-1', cartId: 'created-1' });
    const sent = f.calls.find(call => call[0] === 'dispatch')[1];
    assert.equal(sent.conversationId, 'created-1'); assert.equal(sent.variantId, 'variant-1');
    assert.ok(f.calls.findIndex(call => call[0] === 'preflight') < f.calls.findIndex(call => call[0] === 'captureProjection'));
  } finally { f.cleanup(); }
});
test('empty-session replacement refreshes identity, experiment and projection together before dispatch', async () => {
  const f = fixture({ 'zyon-conversation-id:store': 'expired' });
  f.access(async id => { if (id === 'expired') throw new Expired(); });
  try {
    await f.vm.sendMessage('produto');
    assert.equal(f.creates(), 1);
    const sent = f.calls.find(call => call[0] === 'dispatch')[1];
    assert.equal(sent.conversationId, 'created-1'); assert.equal(sent.variantId, 'variant-1');
    assert.equal(sent.isCurrent(), true);
    assert.equal(f.calls.find(call => call[0] === 'captureProjection')[1].conversationId, 'created-1');
    assert.equal(f.calls.some(call => call[0] === 'clear'), false);
  } finally { f.cleanup(); }
});
test('protected persisted cart prevents replacement and no buyer command is dispatched', async () => {
  const f = fixture({ 'zyon-cart-id:store': 'protected' });
  f.access(async () => { throw new Expired(); });
  try {
    assert.equal(await f.vm.sendMessage('produto'), null);
    assert.equal(f.creates(), 0);
    assert.equal(f.calls.some(call => ['dispatch', 'captureProjection', 'clear'].includes(call[0])), false);
    assert.equal(f.values.get('zyon-cart-id:store'), 'protected');
  } finally { f.cleanup(); }
});
test('voice proof without an identity cannot trigger initialization or migrate to a new conversation', async () => {
  const f = fixture();
  try {
    assert.equal(await f.vm.sendMessage('produto', undefined, undefined, 'bound-proof'), null);
    assert.equal(f.creates(), 0); assert.equal(f.calls.some(call => call[0] === 'dispatch'), false);
  } finally { f.cleanup(); }
});
test('an uncertain dispatched buyer turn prevents later automatic replacement even before React commits history', async () => {
  const f = fixture(); f.dispatch(async () => { throw new Expired(); });
  try {
    assert.equal(await f.vm.sendMessage('adicionar produto'), null);
    f.access(async () => { throw new Expired(); });
    assert.equal(await f.vm.sendMessage('outra solicitação'), null);
    assert.equal(f.creates(), 1);
    assert.equal(f.calls.filter(call => call[0] === 'dispatch').length, 1);
  } finally { f.cleanup(); }
});
test('uncertain command protection does not depend on writable browser storage', async () => {
  const f = fixture(); f.denyStorageWrites(); f.dispatch(async () => { throw new Expired(); });
  try {
    assert.equal(await f.vm.sendMessage('adicionar produto'), null);
    f.access(async () => { throw new Expired(); });
    assert.equal(await f.vm.sendMessage('outra solicitação'), null);
    assert.equal(f.creates(), 1);
    assert.equal(f.calls.filter(call => call[0] === 'dispatch').length, 1);
  } finally { f.cleanup(); }
});
