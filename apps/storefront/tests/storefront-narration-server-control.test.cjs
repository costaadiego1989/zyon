const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sourceRoot = path.resolve(__dirname, '../src');

function runtime(createSession) {
  const sent = [], calls = [], progress = [], tracks = [];
  const listeners = new Map();
  const channel = { readyState: 'open', send: value => sent.push(JSON.parse(value)), close() {}, addEventListener: (name, fn) => listeners.set(name, fn) };
  let peer;
  class FakePeer {
    iceGatheringState = 'complete';
    constructor() { peer = this; }
    addTransceiver(...args) { tracks.push(args); }
    addEventListener() {} close() {}
    createDataChannel() { return channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\nsynthetic-offer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.answer = value; }
  }
  const react = { useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }), useState: value => [value, () => {}] };
  const audio = { style: {}, setAttribute() {}, remove() {}, pause() {}, play: async () => {} };
  const context = vm.createContext({ console, Promise, DOMException, setTimeout, clearTimeout, RTCPeerConnection: FakePeer,
    window: { RTCPeerConnection: FakePeer, setTimeout, clearTimeout },
    navigator: { mediaDevices: { getUserMedia: () => assert.fail('narration never requests microphone') } },
    document: { createElement: () => audio, body: { appendChild() {} } },
    fetch: () => { calls.push('direct-provider-fetch'); throw new Error('browser must not contact provider'); } });
  function load(file) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context, { filename: file })(id => {
      if (id === 'react') return react;
      if (id === '@zyon/shared-types') return load(path.resolve(sourceRoot, '../../../packages/shared-types/src/realtime-voice-session.ts'));
      throw new Error('unexpected narration dependency: ' + id);
    }, module, module.exports);
    return module.exports;
  }
  const state = load(path.join(sourceRoot, 'lib/voice/use-realtime-product-narration.ts')).useRealtimeProductNarration({ enabled: true,
    createSession: async (...args) => { calls.push(args); return createSession(...args); }, onProgress: value => progress.push(value) });
  return { state, sent, calls, progress, tracks, listeners, peer: () => peer,
    settle: async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); } };
}
test('narration negotiates authenticated SDP with productId, no client secret/provider fetch/microphone', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.play('product'); await f.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['product', 'v=0\r\nsynthetic-offer\r\n']]);
  assert.equal(f.peer().answer.sdp, 'v=0\r\nsynthetic-answer\r\n');
  assert.deepEqual(JSON.parse(JSON.stringify(f.tracks)), [['audio', { direction: 'recvonly' }]]);
  f.state.stop();
});
test('narration sends only fixed command and waits for server response admission', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.play('product'); await f.settle();
  f.listeners.get('open')();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].type, 'conversation.item.create');
  assert.equal(f.sent[0].item.content[0].text, 'Reproduza agora o resumo configurado para este produto.');
  assert.equal(f.sent.filter(value => value.type === 'response.create').length, 0);
  f.state.stop();
});
test('narration ignores late SDP after stop without retry', async () => {
  let release;
  const answer = new Promise(resolve => { release = resolve; });
  const f = runtime(async () => answer);
  f.state.play('product'); await f.settle(); f.state.stop();
  release({ sdp: 'v=0\r\nlate-answer' }); await f.settle();
  assert.equal(f.peer().answer, undefined);
  assert.equal(f.calls.length, 1);
});
test('legacy client secret response is rejected with no provider fetch', async () => {
  const f = runtime(async () => ({ value: 'must-not-use-secret' }));
  f.state.play('product'); await f.settle();
  assert.equal(f.calls.includes('direct-provider-fetch'), false);
  assert.equal(f.peer().answer, undefined);
  assert.ok(f.progress.some(value => value.status === 'error'));
  f.state.stop();
});
test('blocked playback reuses its product session, but a different product creates a new bound session', async () => {
  const f = runtime(async () => ({ sdp: 'v=0\r\nsynthetic-answer' }));
  f.state.play('first-product'); await f.settle();
  f.state.play('first-product'); await f.settle();
  assert.equal(f.calls.length, 1);
  f.state.play('second-product'); await f.settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1][0], 'second-product');
  f.state.stop();
});
test('ConversationShell binds selected productId to authenticated SDP request, never browser summary authority', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'components/ConversationShell.tsx'), 'utf8');
  const narration = source.slice(source.indexOf('const narrationVoice = useRealtimeProductNarration'), source.indexOf('// Every checkout entry point'));
  assert.match(narration, /createSession:\s*async\s*\(productId,\s*sdp\)/);
  assert.match(narration, /JSON\.stringify\(\{\s*productId,\s*sdp\s*\}\)/);
  assert.doesNotMatch(narration, /data\.value|JSON\.stringify\(\{\s*summary/);
  assert.match(source, /narrationVoice\.play\(richProduct\.productId\)/);
});
