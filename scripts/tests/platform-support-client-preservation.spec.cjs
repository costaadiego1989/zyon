const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function fixture(kind = 'merchant') {
  const calls = [], connections = [];
  const events = new Map();
  let ack = null;
  const socket = {
    connected: true,
    on(event, listener) { events.set(event, listener); return this; },
    io: { on() {} },
    connect() {},
    disconnect() { this.connected = false; },
    timeout(ms) { assert.equal(ms, 5000); return this; },
    emit(event, body, callback) { calls.push({ event, body }); callback(ack?.error ?? null, ack?.reply); },
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../packages/platform-support-ui/src/client.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.equal(name, 'socket.io-client');
    return { io(url, options) { connections.push({ url, options }); return socket; } };
  }, module, module.exports);
  const client = module.exports.createPlatformSupportClient({
    baseUrl: 'https://api.example.test/v1/', kind,
    request: async (url, init) => { calls.push({ url, init }); return { synthetic: true }; },
  });
  return { client, calls, connections, events, socket, setAck(value) { ack = value; }, ...module.exports };
}

test('merchant reads keep their authenticated scope and encode IDs/query', async () => {
  const { client, calls } = fixture();
  await client.capabilities();
  await client.list({ search: 'pedido & ajuda', mine: false, status: 'open' });
  await client.conversation('a/b', 12);
  assert.equal(calls[0].url, '/merchants/me/platform-support/capabilities');
  const query = new URL(calls[1].url, 'https://example.test').searchParams;
  assert.equal(query.get('search'), 'pedido & ajuda');
  assert.equal(query.get('mine'), 'false');
  assert.equal(calls[2].url, '/merchants/me/platform-support/a%2Fb?before=12');
});

test('HTTP message fallback preserves the caller idempotency key', async () => {
  const { client, calls } = fixture();
  const input = { content: 'synthetic message', clientMessageId: 'synthetic-id' };
  await client.send('ticket/1', input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/merchants/me/platform-support/ticket%2F1/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
});

test('lost socket acknowledgement uses the same message ID in HTTP', async () => {
  const f = fixture();
  const unsubscribe = f.client.subscribe({ changed() {}, state() {} });
  try {
    f.events.get('authenticated')();
    f.setAck({ error: new Error('synthetic timeout') });
    const input = { content: 'synthetic message', clientMessageId: 'same-id' };
    await f.client.send('ticket', input);
    assert.deepEqual(f.calls[0], { event: 'send_message', body: { ticketId: 'ticket', ...input } });
    assert.deepEqual(JSON.parse(f.calls[1].init.body), input);
  } finally { unsubscribe(); }
});

test('successful socket acknowledgement does not create another HTTP write', async () => {
  const f = fixture();
  const unsubscribe = f.client.subscribe({ changed() {}, state() {} });
  try {
    f.events.get('authenticated')();
    const message = { id: 'synthetic-message' };
    f.setAck({ reply: { success: true, message } });
    assert.deepEqual(await f.client.send('ticket', { content: 'hello', clientMessageId: 'id' }), message);
    assert.equal(f.calls.length, 1);
  } finally { unsubscribe(); }
});

test('business refusal is surfaced without another HTTP write', async () => {
  const f = fixture();
  const unsubscribe = f.client.subscribe({ changed() {}, state() {} });
  try {
    f.events.get('authenticated')();
    f.setAck({ reply: { success: false, code: 'support_ticket_resolved' } });
    await assert.rejects(f.client.send('ticket', { content: 'hello', clientMessageId: 'id' }), error => error.code === 'support_ticket_resolved');
    assert.equal(f.calls.length, 1);
  } finally { unsubscribe(); }
});

test('subscribers share one merchant socket, clean up and preserve role isolation', async () => {
  const f = fixture();
  const a = f.client.subscribe({ changed() {}, state() {} });
  const b = f.client.subscribe({ changed() {}, state() {} });
  assert.equal(f.connections.length, 1);
  assert.equal(f.connections[0].url, 'https://api.example.test/platform-support');
  assert.equal(f.connections[0].options.withCredentials, true);
  assert.deepEqual(f.connections[0].options.auth, { kind: 'merchant' });
  a(); assert.equal(f.socket.connected, true);
  b(); assert.equal(f.socket.connected, false);
  const operator = fixture('operator');
  await operator.client.list();
  assert.equal(operator.calls[0].url, '/platform/support');
});
