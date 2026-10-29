import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as budget from './storefront-sandbox-llm-budget.mjs';
import net from 'node:net';
import { parseApprovedLlmFlags } from './storefront-journey-llm.guards.mjs';
import { verifyJourneyPreflight } from './storefront-journey-guards.mjs';
import { installStorefrontJourneyEgress } from './storefront-journey-egress.mjs';

const approvalId = 'storefront-sandbox-20261022-approved130';
const metadata = () => ({ stepId: randomUUID(), stage: 'turn' });
const request = (max_tokens = 1024) => ({ method: 'POST', headers: { authorization: 'Bearer synthetic-only', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'deepseek-chat', max_tokens, messages: [{ role: 'user', content: 'synthetic shopping' }] }) });
const send = (client, step = metadata(), tokens = 1024) => client.fetchForStep(step)(budget.SANDBOX_LLM_APPROVAL.endpoint, request(tokens));
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aacp-budget130-contract-')), directory = join(root, 'budget');
  t.after(() => { const target = realpathSync(root); assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.ok(basename(target).startsWith('aacp-budget130-contract-')); rmSync(target, { recursive: true }); });
  budget.initializeSyntheticSandboxLlmBudget({ directory });
  writeFileSync(join(directory, 'attempts.jsonl'), Array.from({ length: 49 }, (_, index) => JSON.stringify({ version: 1, callNumber: index + 1,
    ...metadata(), maxTokens: 1024, at: '2026-10-21T12:00:00.000Z' })).join('\n') + '\n');
  const oldApproval = budget.SANDBOX_LLM_EXTENSION_APPROVAL.approvalId;
  budget.initializeSyntheticSandboxLlmExtension({ directory, approvalId: oldApproval, expectedConsumedCalls: 49 });
  const old = budget.createSyntheticExtendedSandboxDeepSeekBudget({ directory, approvalId: oldApproval, fetchFn: async () => new Response('{}') });
  for (let i = 0; i < 40; i++) await send(old);
  assert.equal(old.status().attemptedCalls, 89);
  const before = new Map(['manifest.json', 'attempts.jsonl', 'extension90.json', 'extension90-attempts.jsonl'].map(name => [name, readFileSync(join(directory, name))]));
  const unchanged = () => { for (const [name, bytes] of before) assert.deepEqual(readFileSync(join(directory, name)), bytes); };
  return { directory, old, unchanged, options: { directory, approvalId, expectedConsumedCalls: 89 } };
}
const client = (directory, fetchFn = async () => new Response('{}')) => budget.createSyntheticContinuationSandboxDeepSeekBudget({ directory, approvalId, fetchFn });

test('new authority preserves old approvals and continues at call90 with41 available', async t => {
  const f = await fixture(t);
  assert.equal(budget.SANDBOX_LLM_APPROVAL.maximumCalls, 60);
  assert.equal(budget.SANDBOX_LLM_EXTENSION_APPROVAL.maximumCalls, 90);
  const status = budget.initializeSyntheticSandboxLlmContinuation(f.options);
  assert.equal(status.attemptedCalls, 89); assert.equal(status.maximumCalls, 130); assert.equal(status.remainingCalls, 41);
  await send(client(f.directory));
  assert.equal(client(f.directory).status().attemptedCalls, 90);
  assert.equal(JSON.parse(readFileSync(join(f.directory, 'extension130-attempts.jsonl'), 'utf8')).callNumber, 90);
  f.unchanged();
});
test('older clients cannot reserve the same remaining slot after continuation exists', async t => {
  const f = await fixture(t); budget.initializeSyntheticSandboxLlmContinuation(f.options);
  assert.throws(() => f.old.status(), /continuation_explicit_authority_required/);
  await assert.rejects(send(f.old), /continuation_explicit_authority_required/);
  f.unchanged();
});
test('cumulative ceiling130 survives resume and refuses the next network call', async t => {
  const f = await fixture(t); budget.initializeSyntheticSandboxLlmContinuation(f.options);
  let calls = 0;
  const c = client(f.directory, async () => { calls++; return new Response('{}'); });
  for (let i = 0; i < 41; i++) await send(c);
  assert.equal(client(f.directory).status().remainingCalls, 0);
  await assert.rejects(send(c), /sandbox_budget_exhausted/);
  assert.equal(calls, 41); f.unchanged();
});
test('failed network attempt is durable before dispatch and cannot be retried or refunded', async t => {
  const f = await fixture(t); budget.initializeSyntheticSandboxLlmContinuation(f.options);
  let calls = 0; const step = metadata();
  const c = client(f.directory, async () => { calls++; assert.equal(client(f.directory).status().attemptedCalls, 90); throw Error('network'); });
  await assert.rejects(send(c, step), /sandbox_provider_network_failed/);
  await assert.rejects(send(c, step), /sandbox_budget_step_already_attempted/);
  assert.equal(calls, 1); assert.equal(client(f.directory).status().remainingCalls, 40); f.unchanged();
});
test('invalid token limit fails before consuming authority', async t => {
  const f = await fixture(t); budget.initializeSyntheticSandboxLlmContinuation(f.options);
  const c = client(f.directory);
  await assert.rejects(send(c, metadata(), 1025), /sandbox_provider_request_invalid/);
  assert.equal(c.status().attemptedCalls, 89); f.unchanged();
});
test('explicit approval, baseline89 and exclusive initialization are mandatory', async t => {
  const f = await fixture(t);
  assert.throws(() => budget.initializeSyntheticSandboxLlmContinuation({ ...f.options, expectedConsumedCalls: 0 }));
  assert.throws(() => budget.initializeSyntheticSandboxLlmContinuation({ ...f.options, approvalId: 'unapproved' }));
  budget.initializeSyntheticSandboxLlmContinuation(f.options);
  assert.throws(() => budget.initializeSyntheticSandboxLlmContinuation(f.options), /already_initialized/);
  f.unchanged();
});
test('drift in the frozen prior journal refuses new reservations before network', async t => {
  const f = await fixture(t); budget.initializeSyntheticSandboxLlmContinuation(f.options);
  const file = join(f.directory, 'extension90-attempts.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  rows[0].stage = 'copy'; writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  let calls = 0;
  await assert.rejects(send(client(f.directory, async () => { calls++; return new Response('{}'); })), /continuation_original_drift/);
  assert.equal(calls, 0);
});
test('synthetic continuation cannot target the real canonical ledger directory', () => {
  assert.throws(() => budget.initializeSyntheticSandboxLlmContinuation({ directory: budget.originalExtendedSandboxBudgetDirectory, approvalId, expectedConsumedCalls: 89 }), /synthetic_configuration_invalid/);
});
test('continuation flags require exact approval130, explicit89..129 count and no mixed or duplicate authority', () => {
  const flags = ['--local-disposable', '--prisma-loopback-exec', '--compiled-test-artifact', '--approved-deepseek-http', '--allow-real-deepseek',
    `--approval-id=${approvalId}`, '--extend-original-budget-to=130'];
  for (const count of [89, 90, 100, 129]) assert.deepEqual(parseApprovedLlmFlags([...flags, `--expected-consumed-calls=${count}`]),
    { approvalId, expectedConsumedCalls: count, extensionMaximumCalls: 130 });
  for (const count of ['88', '130', '089', '89.0', '-1']) assert.throws(() => parseApprovedLlmFlags([...flags, `--expected-consumed-calls=${count}`]));
  for (const extra of ['--extend-original-budget-to=90', '--extend-original-budget-to=130', '--allow-real-deepseek'])
    assert.throws(() => parseApprovedLlmFlags([...flags, '--expected-consumed-calls=89', extra]));
  assert.throws(() => parseApprovedLlmFlags(flags.filter(flag => !flag.startsWith('--extend')).concat('--expected-consumed-calls=89')));
});
test('explicit130 composes through actual egress and transport into durable cumulative call90', async t => {
  const f = await fixture(t); budget.initializeSyntheticSandboxLlmContinuation(f.options);
  const manifest = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: randomUUID(),
    apiOrigin: 'http://127.0.0.1:19987', postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const principal = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId };
  const capability = await verifyJourneyPreflight({ manifest, principalToken: 'synthetic-only', verifyPrincipal: async () => principal,
    verifyResources: async () => ({ ...principal, apiOrigin: manifest.apiOrigin, postgresRunId: manifest.postgresRunId,
      redisRunId: manifest.redisRunId, postgresPort: manifest.postgresPort, redisPort: manifest.redisPort }) });
  const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect;
  let egress, calls = 0;
  const earlyFetch = async () => { throw Error('early-denied'); }, earlyConnect = () => { throw Error('early-denied'); };
  globalThis.fetch = earlyFetch; net.Socket.prototype.connect = earlyConnect;
  try {
    egress = await installStorefrontJourneyEgress({ capability, previousFence: { fetch: earlyFetch, connect: earlyConnect,
      underlyingConnect: originalConnect, underlyingFetch: async () => { calls++; return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] })); } } });
    const c = client(f.directory, (url, options) => globalThis.fetch(url, options)), traces = [];
    assert.throws(() => egress.createTransport({ budget: c, record() {} }), /journey_budget_invalid/);
    const transport = egress.createTransport({ budget: c, record: value => traces.push(value), approvalId });
    const options = request(); options.body = JSON.stringify({ ...JSON.parse(options.body), response_format: { type: 'json_object' } });
    await transport.runOperation({ operationId: randomUUID(), stage: 'turn' }, () => transport.fetchFactory('primary')(budget.SANDBOX_LLM_APPROVAL.endpoint, options));
    assert.equal(calls, 1); assert.equal(c.status().attemptedCalls, 90); assert.equal(traces.length, 2);
    assert.equal(egress.evidence().budgetedFetches, 1); f.unchanged();
  } finally { if (egress) egress.dispose(); globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; }
});
