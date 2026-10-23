import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const requireApi = createRequire(path.resolve(directory, '../../../../api/package.json'));
const ts = requireApi('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(directory, 'conversation.handlers.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class Expired extends Error {}

function fixture() {
  const calls: any[] = [];
  let current = true;
  let messages: any[] = [], history: any[] = [];
  let access: () => Promise<void> = async () => {};
  let reply: () => Promise<any> = async () => ({ conversation_id: 'original', message: 'Resposta da loja', blocks: [] });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', source)((name: string) => {
    if (name.endsWith('api-client')) return { checkoutApi: {
      create: async (...args: any[]) => { calls.push(['create', ...args]); return { conversation_id: 'fresh' }; },
      sendMessage: async (...args: any[]) => { calls.push(['send', ...args]); return reply(); },
    } };
    if (name.endsWith('conversation.service')) return { narrateStorefrontBlock: () => 'Produtos', trackFunnelEvent: () => {} };
    if (name.endsWith('buyer-auth')) return { getValidBuyer: () => ({ token: 'synthetic-buyer' }) };
    if (name.endsWith('conversation-access')) return {
      ConversationSessionExpiredError: Expired,
      ensureConversationAccess: async (id: string) => { calls.push(['preflight', id]); return access(); },
    };
    if (name.endsWith('storefront-read-ui-action')) return { cloneStorefrontReadUiAction: (value: any) => structuredClone(value) };
    if (name.endsWith('storefront-suggested-read-actions')) return { parseSuggestedReadActions: (value: any) => value ?? null };
    if (name.endsWith('conversation-nudge.handlers')) return {};
    throw Error('Unexpected dependency ' + name);
  }, module, module.exports);
  const params = {
    trimmed: 'Quero um produto para meu cabelo', conversationId: 'original', merchantId: 'store',
    cartId: null, variantId: 'variant', history: [] as any[],
    isCurrent: () => current,
    setConversationId: (id: string) => calls.push(['identity', id]),
    clearCart: () => calls.push(['clear']),
    setMessages: (update: any) => { messages = update(messages); calls.push(['messages']); },
    setHistory: (value: any) => { history = typeof value === 'function' ? value(history) : value; calls.push(['history']); },
    setIsLoading: (value: boolean) => calls.push(['loading', value]),
    setInput: (value: string) => calls.push(['input', value]),
    setCrossSellPending: (value: any) => calls.push(['crosssell', value]),
    setProductCrossSell: (value: any) => calls.push(['productCrosssell', value]),
    updateFromBlocks: (value: any) => calls.push(['unguardedProjection', value]),
    applyCartProjection: (blocks: any[]) => { calls.push(['projection', blocks]); return true; },
    noteActivity: () => calls.push(['activity']),
    onCheckoutPrepared: (value: any) => calls.push(['checkout', value]),
  };
  return { params, calls, handle: module.exports.handleSendMessage, messages: () => messages, history: () => history,
    access: (next: typeof access) => { access = next; }, reply: (next: typeof reply) => { reply = next; }, invalidate: () => { current = false; } };
}

test('integration preflights before optimistic input/history and dispatches exactly one original turn', async () => {
  const f = fixture();
  await f.handle(f.params);
  const index = (name: string) => f.calls.findIndex(call => call[0] === name);
  assert.ok(index('preflight') >= 0);
  assert.ok(index('preflight') < index('messages'));
  assert.ok(index('preflight') < index('input'));
  assert.ok(index('preflight') < index('history'));
  assert.equal(f.calls.filter(call => call[0] === 'send').length, 1);
  assert.equal(f.messages().filter(message => message.role === 'user').length, 1);
  assert.equal(f.calls.some(call => call[0] === 'create' || call[0] === 'clear'), false);
});
test('preflight expiry preserves input/history/cart and never dispatches or creates a replacement', async () => {
  const f = fixture(); f.access(async () => { throw new Expired(); });
  assert.equal(await f.handle(f.params), null);
  assert.deepEqual(f.history(), []);
  assert.equal(f.messages().some(message => message.role === 'user'), false);
  for (const name of ['send', 'create', 'clear', 'input', 'projection', 'checkout']) assert.equal(f.calls.some(call => call[0] === name), false);
  assert.match(f.messages().at(-1).text, /não foi reenviada/);
  assert.equal(f.messages().some(message => /adicione novamente|nova conversa/.test(message.text)), false);
});
test('transient preflight failure preserves the buyer draft and does not dispatch', async () => {
  const f = fixture(); f.access(async () => { throw Error('renewal unavailable'); });
  assert.equal(await f.handle(f.params), null);
  for (const name of ['input', 'send', 'history', 'create', 'clear']) assert.equal(f.calls.some(call => call[0] === name), false);
});
test('merchant or identity invalidation during preflight fences all late callbacks', async () => {
  const f = fixture(); let release!: () => void;
  f.access(() => new Promise(resolve => { release = resolve; }));
  const pending = f.handle(f.params);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  const count = f.calls.length; f.invalidate(); release();
  assert.equal(await pending, null);
  assert.equal(f.calls.length, count);
});
test('an expiry after dispatch never replays the turn or resets a protected cart', async () => {
  const f = fixture(); f.reply(async () => { throw new Expired(); });
  await f.handle({ ...f.params, cartId: 'original', history: [{ role: 'user', content: 'existing cart' }] });
  assert.equal(f.calls.filter(call => call[0] === 'send').length, 1);
  assert.equal(f.calls.some(call => call[0] === 'create' || call[0] === 'clear'), false);
});
test('existing voice proof, attachment and typed read UI action stay bound to the original identity', async () => {
  const f = fixture();
  const attachment = { kind: 'image', name: 'lista.png', mimeType: 'image/png', dataBase64: 'synthetic' };
  const uiAction = { tool: 'get_product_details', args: { productId: 'product' } };
  await f.handle({ ...f.params, attachment, uiAction, voiceTurnToken: 'original-proof' });
  const send = f.calls.find(call => call[0] === 'send');
  assert.equal(send[1], 'original');
  assert.equal(send[3].voiceTurnToken, 'original-proof');
  assert.equal(send[3].attachment, attachment);
  assert.deepEqual(send[3].uiAction, uiAction);
  assert.deepEqual(f.messages()[0].attachment, { kind: 'image', name: 'lista.png' });
});
test('denied single-use projection cannot render cart, checkout or cross-sell effects', async () => {
  const f = fixture();
  f.reply(async () => ({ conversation_id: 'original', message: 'Resposta', blocks: [
    { type: 'cart_summary', data: { cartId: 'original', items: [] } },
    { type: 'checkout_prepared', data: { actionId: 'action', cartId: 'original', shippingPreference: 'fastest', paymentPreference: 'card' } },
    { type: 'cross_sell', data: { products: [{ id: 'product' }] } },
  ] }));
  const result = await f.handle({ ...f.params, applyCartProjection: () => false });
  assert.deepEqual(result.blocks, []);
  for (const name of ['checkout', 'crosssell', 'productCrosssell', 'unguardedProjection']) assert.equal(f.calls.some(call => call[0] === name), false);
});
test('accepted product-detail offer retains existing placement and suggested read actions', async () => {
  const f = fixture();
  const offer = { products: [{ id: 'related' }] };
  const actions = { items: [{ label: 'Ver produto', action: { tool: 'get_product_details', args: { productId: 'product' } } }] };
  f.reply(async () => ({ conversation_id: 'original', message: 'Produto', suggested_actions: actions, blocks: [
    { type: 'product_content', data: { productId: 'product' } }, { type: 'cross_sell', data: offer },
  ] }));
  const result = await f.handle(f.params);
  assert.deepEqual(f.calls.find(call => call[0] === 'productCrosssell')?.[1], { productId: 'product', data: offer });
  assert.equal(f.calls.some(call => call[0] === 'crosssell' || call[0] === 'unguardedProjection'), false);
  assert.deepEqual(result.blocks.find((block: any) => block.type === 'quick_replies').data.suggestedActions, actions);
});
test('a response naming another conversation is rejected before projection, checkout or transcript rendering', async () => {
  const f = fixture();
  f.reply(async () => ({ conversation_id: 'foreign', message: 'foreign response', blocks: [{ type: 'cart_summary', data: { cartId: 'foreign', items: [] } }] }));
  assert.equal(await f.handle(f.params), null);
  assert.equal(f.calls.some(call => call[0] === 'projection' || call[0] === 'checkout'), false);
  assert.equal(f.messages().some(message => message.text === 'foreign response'), false);
});
test('missing identity with a voice proof, protected cart or prior turns never starts a replacement', async () => {
  for (const extra of [
    { voiceTurnToken: 'bound-voice-proof' },
    { cartId: 'protected-cart' },
    { history: [{ role: 'user', content: 'previous purchase' }] },
  ]) {
    const f = fixture();
    assert.equal(await f.handle({ ...f.params, ...extra, conversationId: null }), null);
    for (const name of ['create', 'send', 'clear', 'input', 'projection']) assert.equal(f.calls.some(call => call[0] === name), false);
  }
});
test('a cart bound to another identity is refused without consuming the buyer draft', async () => {
  const f = fixture();
  assert.equal(await f.handle({ ...f.params, cartId: 'different-cart' }), null);
  for (const name of ['create', 'send', 'clear', 'input', 'projection']) assert.equal(f.calls.some(call => call[0] === name), false);
});
test('genuinely new text conversation preflights its created identity before one dispatch', async () => {
  const f = fixture();
  f.reply(async () => ({ conversation_id: 'fresh', message: 'Nova conversa', blocks: [] }));
  const result = await f.handle({ ...f.params, conversationId: null });
  assert.equal(result.agentMessage, 'Nova conversa');
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(f.calls.find(call => call[0] === 'preflight'), ['preflight', 'fresh']);
  assert.equal(f.calls.find(call => call[0] === 'send')[1], 'fresh');
});
