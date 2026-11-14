const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');

function runtime(createSession) {
  const sent = [], calls = [], audio = { style: {}, setAttribute() {}, remove() {}, pause() {}, play: async () => {} };
  const listeners = new Map();
  const channel = { readyState: 'open', send: value => sent.push(JSON.parse(value)), close() {},
    addEventListener: (name, fn) => listeners.set(name, fn) };
  let peer;
  class FakePeer {
    iceGatheringState = 'complete';
    constructor() { peer = this; }
    addTrack() {} addEventListener() {} close() {}
    createDataChannel() { return channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\nsynthetic-offer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.answer = value; }
  }
  const react = { useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }), useState: value => [value, () => {}] };
  const context = vm.createContext({ console, Promise, DOMException, setTimeout, clearTimeout, RTCPeerConnection: FakePeer,
    window: { RTCPeerConnection: FakePeer, setTimeout, clearTimeout }, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: { createElement: () => audio, body: { appendChild() {} } },
    fetch: async () => { calls.push('direct-fetch'); throw new Error('browser must not call provider'); } });
  function load(file) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename: file })(id => {
      if (id === 'react') return react;
      if (id === '@zyon/shared-types') return {
        ...load(path.resolve(root, '../../../packages/shared-types/src/realtime-voice-input.ts')),
        ...load(path.resolve(root, '../../../packages/shared-types/src/realtime-voice-session.ts')),
      };
      throw new Error('unexpected voice dependency: ' + id);
    }, module, module.exports);
    return module.exports;
  }
  const state = load(path.join(root, 'lib/voice/use-realtime-voice-checkout.ts')).useRealtimeVoiceCheckout({ enabled: true,
    createSession: async sdp => { calls.push(sdp); return createSession(sdp); },
    onCommerceTurn: async (...args) => { calls.push({ commerce: args }); return { agentMessage: 'Resposta comercial confirmada' }; },
    onBeginCheckout: async () => { calls.push({ checkout: true }); return { agentMessage: 'Continue na tela' }; },
  });
  return { state, sent, calls, listeners, peer: () => peer, emit: async event => {
    listeners.get('message')?.({ data: JSON.stringify(event) });
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }, settle: async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); } };
}
test('voice sends SDP offer only to authenticated server callback and consumes answer', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.start(); await f.settle();
  assert.deepEqual(f.calls, ['v=0\r\nsynthetic-offer\r\n']);
  assert.equal(f.peer().answer.sdp, 'v=0\r\nsynthetic-answer\r\n');
  f.state.stop();
});
test('initial greeting and typed input are user items, never client response.create', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.start(); await f.settle(); f.listeners.get('open')();
  f.state.sendText('Explique Fibonacci'); await f.settle();
  assert.equal(f.sent.filter(event => event.type === 'conversation.item.create' && event.item.role === 'user').length, 2);
  assert.equal(f.sent.filter(event => event.type === 'response.create').length, 0);
  f.state.stop();
});
test('recognized speech and tool completion wait for server admission', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.start(); await f.settle();
  await f.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'speech', transcript: 'Buscar produtos' });
  await f.emit({ type: 'response.created', response: { id: 'response_a', metadata: { zyon_turn_token: 'synthetic-signed-voice-permit' } } });
  await f.emit({ type: 'response.output_item.done', response_id: 'response_a', item: { type: 'function_call', name: 'handoff_to_commerce_agent', call_id: 'tool', arguments: JSON.stringify({ buyer_message: 'Buscar produtos' }) } });
  assert.equal(f.sent.filter(event => event.item?.type === 'function_call_output').length, 1);
  assert.equal(f.sent.filter(event => event.type === 'response.create').length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(value => value.commerce).commerce)), ['Buscar produtos', 'commerce', 'synthetic-signed-voice-permit']);
  f.state.stop();
});
test('tool calls without an admitted response permit cannot invoke commerce callbacks', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.start(); await f.settle();
  await f.emit({ type: 'response.output_item.done', response_id: 'unknown', item: { type: 'function_call', name: 'add_item_to_cart', call_id: 'forged', arguments: JSON.stringify({ buyer_message: 'Adicionar produto' }) } });
  assert.equal(f.calls.filter(value => value.commerce).length, 0);
  f.state.stop();
});
test('ConversationShell negotiates storefront purchase voice with authenticated SDP, not client secret', () => {
  const source = fs.readFileSync(path.join(root, 'components/ConversationShell.tsx'), 'utf8');
  const purchase = source.slice(source.indexOf('const realtimeVoice = useRealtimeVoiceCheckout'), source.indexOf('const narrationRequestIdRef'));
  assert.match(purchase, /createSession:\s*async\s*\(sdp\)/);
  assert.match(purchase, /JSON\.stringify\(\{\s*sdp\s*\}\)/);
  assert.match(purchase, /readRealtimeVoiceCall\(response\)/);
  assert.doesNotMatch(purchase, /data\.value|expires_at/);
});
test('legacy secret response is not accepted as an SDP answer', async () => {
  const f = runtime(async () => ({ value: 'must-not-use-client-secret' }));
  f.state.start(); await f.settle();
  assert.equal(f.peer().answer, undefined);
  assert.equal(f.calls.includes('direct-fetch'), false);
  f.state.stop();
});
test('stopped session ignores a late server answer without retry', async () => {
  let release; const answer = new Promise(resolve => { release = resolve; });
  const f = runtime(async () => answer);
  f.state.start(); await f.settle(); f.state.stop();
  release({ sdp: 'v=0\r\nlate-answer' }); await f.settle();
  assert.equal(f.peer().answer, undefined);
  assert.equal(f.calls.length, 1);
});

test('admitted tool call is deduplicated and completed response permit cannot be replayed', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.start(); await f.settle();
  await f.emit({ type: 'response.created', response: { id: 'response_a', metadata: { zyon_turn_token: 'synthetic-signed-voice-permit' } } });
  const tool = { type: 'response.output_item.done', response_id: 'response_a', item: { type: 'function_call', name: 'add_item_to_cart', call_id: 'same_call', arguments: JSON.stringify({ buyer_message: 'Adicionar produto' }) } };
  await f.emit(tool); await f.emit(tool);
  assert.equal(f.calls.filter(value => value.commerce).length, 1);
  assert.equal(f.sent.filter(event => event.item?.type === 'function_call_output').length, 1);
  await f.emit({ type: 'response.done', response: { id: 'response_a' } });
  await f.emit({ ...tool, item: { ...tool.item, call_id: 'replayed_response' } });
  assert.equal(f.calls.filter(value => value.commerce).length, 1);
  assert.equal(f.sent.filter(event => event.type === 'response.create').length, 0);
  f.state.stop();
});

test('checkout function also requires a nonempty bounded response permit', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.start(); await f.settle();
  for (const token of [undefined, '', 'x'.repeat(513)]) {
    await f.emit({ type: 'response.created', response: { id: 'unadmitted', metadata: token === undefined ? {} : { zyon_turn_token: token } } });
    await f.emit({ type: 'response.output_item.done', response_id: 'unadmitted', item: { type: 'function_call', name: 'begin_checkout', call_id: 'not_allowed', arguments: '{}' } });
  }
  assert.equal(f.calls.filter(value => value.checkout).length, 0);
  assert.equal(f.sent.filter(event => event.item?.type === 'function_call_output').length, 0);
  await f.emit({ type: 'response.created', response: { id: 'admitted', metadata: { zyon_turn_token: 'synthetic-valid-permit' } } });
  await f.emit({ type: 'response.output_item.done', response_id: 'admitted', item: { type: 'function_call', name: 'begin_checkout', call_id: 'allowed', arguments: '{}' } });
  assert.equal(f.calls.filter(value => value.checkout).length, 1);
  f.state.stop();
});

test('new server-owned tracker preserves cancellation/playback controls without browser inference', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\nsynthetic-answer' }));
  f.state.start(); await f.settle();
  assert.equal(f.peer().answer.sdp, 'v=0\r\nsynthetic-answer\r\n');
  await f.emit({ type: 'response.created', response: { id: 'playing', metadata: { zyon_turn_token: 'synthetic-permit' } } });
  await f.emit({ type: 'output_audio_buffer.started' });
  f.state.sendText('Quero buscar um produto');
  assert.equal(f.sent.filter(event => event.type === 'response.cancel').length, 1);
  assert.equal(f.sent.filter(event => event.type === 'output_audio_buffer.clear').length, 1);
  assert.equal(f.sent.filter(event => event.type === 'conversation.item.create' && event.item.role === 'user').length, 1);
  assert.equal(f.sent.filter(event => event.type === 'response.create').length, 0);
  f.state.stop();
});
