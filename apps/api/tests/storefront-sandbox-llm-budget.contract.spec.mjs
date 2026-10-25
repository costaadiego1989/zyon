import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SANDBOX_LLM_APPROVAL, approvedSandboxBudgetDirectory,
  initializeApprovedSandboxLlmBudget, createApprovedSandboxDeepSeekBudget,
  initializeSyntheticSandboxLlmBudget, createSyntheticSandboxDeepSeekBudget,
} from './storefront-sandbox-llm-budget.mjs';

const endpoint = 'https://api.deepseek.com/v1/chat/completions';
const childEnvironment = () => ({ ...Object.fromEntries(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'TEMP', 'TMP']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])), NODE_ENV: 'test' });
const request = patch => ({ method: 'POST', headers: { authorization: 'Bearer synthetic-only', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 1024, stream: false,
    response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'SYNTHETIC_PRIVATE_MESSAGE' }], ...patch }) });
const step = (stage = 'turn') => ({ stepId: randomUUID(), stage });
const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'aacp-sandbox-budget-contract-'));
  const directory = join(root, 'budget');
  t.after(() => {
    const owned = realpathSync(root);
    assert.ok(basename(owned).startsWith('aacp-sandbox-budget-contract-'));
    assert.equal(dirname(owned), realpathSync(tmpdir()));
    rmSync(owned, { recursive: true, force: false });
  });
  initializeSyntheticSandboxLlmBudget({ directory });
  return directory;
};
const budget = (directory, fetchFn = async () => new Response('{}'), patch = {}) =>
  createSyntheticSandboxDeepSeekBudget({ directory, fetchFn, ...patch });
const send = (client, metadata = step(), patch) => client.fetchForStep(metadata)(endpoint, request(patch));

test('approval is fixed at sixty attempts and 1024 output tokens with no retries', () => {
  assert.equal(SANDBOX_LLM_APPROVAL.maximumCalls, 60); assert.equal(SANDBOX_LLM_APPROVAL.maximumOutputTokensPerCall, 1024);
  assert.equal(SANDBOX_LLM_APPROVAL.endpoint, endpoint); assert.equal(SANDBOX_LLM_APPROVAL.model, 'deepseek-chat');
  assert.equal(SANDBOX_LLM_APPROVAL.retries, false); assert.equal(Object.isFrozen(SANDBOX_LLM_APPROVAL), true);
});
test('import and CLI help do not initialize durable approval or access a provider', () => {
  const before = existsSync(approvedSandboxBudgetDirectory);
  const result = spawnSync(process.execPath, ['--import', new URL('./test-network-guard.mjs', import.meta.url).href, '--',
    fileURLToPath(new URL('./storefront-sandbox-llm-budget.mjs', import.meta.url)), '--help'], { env: childEnvironment(), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); assert.equal(existsSync(approvedSandboxBudgetDirectory), before);
  assert.equal(JSON.parse(result.stdout).providerCalls, 0);
});
test('real initialization and transport require the exact explicit approval before filesystem or network', () => {
  const before = existsSync(approvedSandboxBudgetDirectory);
  for (const options of [{}, { allowRealDeepSeek: true }, { allowRealDeepSeek: true, approvalId: 'another-approval' },
    { allowRealDeepSeek: true, approvalId: SANDBOX_LLM_APPROVAL.approvalId, maximumCalls: 61 }]) {
    assert.throws(() => initializeApprovedSandboxLlmBudget(options), /sandbox_budget_explicit_approval_required/);
    assert.throws(() => createApprovedSandboxDeepSeekBudget(options), /sandbox_budget_explicit_approval_required/);
  }
  assert.equal(existsSync(approvedSandboxBudgetDirectory), before);
});
test('initialization is exclusive and a second client resumes rather than resetting attempts', async t => {
  const directory = fixture(t), client = budget(directory);
  await send(client); await send(client, step('tool'));
  assert.throws(() => initializeSyntheticSandboxLlmBudget({ directory }), /sandbox_budget_already_initialized/);
  const resumed = budget(directory); assert.equal(resumed.status().attemptedCalls, 2); assert.equal(resumed.status().remainingCalls, 58);
});
test('sixty calls across fresh clients exhaust one ledger and the sixty-first never reaches transport', async t => {
  const directory = fixture(t); let calls = 0;
  const transport = async () => { calls++; return new Response('{}'); };
  for (let index = 0; index < 60; index++) await send(budget(directory, transport), step(index % 2 ? 'tool' : 'turn'));
  await assert.rejects(send(budget(directory, transport)), /sandbox_budget_exhausted/);
  assert.equal(calls, 60); assert.equal(budget(directory).status().attemptedCalls, 60);
});
test('concurrent calls reserve at most sixty durable slots before asynchronous transport', async t => {
  const directory = fixture(t); let calls = 0;
  const client = budget(directory, async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return new Response('{}'); });
  const outcomes = await Promise.allSettled(Array.from({ length: 65 }, () => send(client)));
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 60);
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.reason.message === 'sandbox_budget_exhausted').length, 5);
  assert.equal(calls, 60); assert.equal(client.status().attemptedCalls, 60);
});
test('a durable step UUID cannot be retried by the same or a fresh client after network uncertainty', async t => {
  const directory = fixture(t), metadata = step('tool'); let calls = 0;
  const transport = async () => { calls++; throw new Error('PRIVATE_PROVIDER_FAILURE'); };
  await assert.rejects(send(budget(directory, transport), metadata), error => error.message === 'sandbox_provider_network_failed');
  await assert.rejects(send(budget(directory, transport), metadata), /sandbox_budget_step_already_attempted/);
  assert.equal(calls, 1); assert.equal(budget(directory).status().attemptedCalls, 1);
});
test('network failure, HTTP rejection and timeout all consume one call without retry or response leakage', async t => {
  const directory = fixture(t); let calls = 0;
  for (const [transport, expected] of [
    [async () => { calls++; throw new Error('PRIVATE_TRANSPORT'); }, 'sandbox_provider_network_failed'],
    [async () => { calls++; return new Response('PRIVATE_PROVIDER_BODY', { status: 401 }); }, 'sandbox_provider_http_failed'],
    [async () => { calls++; return new Promise(() => {}); }, 'sandbox_provider_timeout'],
  ]) {
    await assert.rejects(send(budget(directory, transport, { timeoutMs: 5 })), error => {
      assert.equal(error.message, expected); assert.equal(String(error).includes('PRIVATE'), false); return true;
    });
  }
  assert.equal(calls, 3); assert.equal(budget(directory).status().attemptedCalls, 3);
});
test('redirects are refused and the request has one bounded abort signal', async t => {
  const directory = fixture(t); let observed;
  await send(budget(directory, async (url, options) => { observed = { url, options }; return new Response('{}'); }));
  assert.equal(observed.url, endpoint); assert.equal(observed.options.redirect, 'error');
  assert.ok(observed.options.signal instanceof AbortSignal); assert.equal(JSON.parse(observed.options.body).max_tokens, 1024);
});
test('body reading is timeout-bounded and an endless response does not release the durable reservation', async t => {
  const directory = fixture(t), client = budget(directory, async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 5 });
  await assert.rejects(send(client), /sandbox_provider_timeout/); assert.equal(client.status().attemptedCalls, 1);
});
test('oversized provider bodies fail closed without storing or echoing content', async t => {
  const directory = fixture(t), client = budget(directory, async () => new Response('x'.repeat(262145)));
  await assert.rejects(send(client), /sandbox_provider_response_too_large/); assert.equal(client.status().attemptedCalls, 1);
});
for (const [label, url, patch] of [
  ['foreign URL', 'https://untrusted.invalid/v1/chat/completions', {}],
  ['query', `${endpoint}?token=PRIVATE`, {}], ['credentials', 'https://key@api.deepseek.com/v1/chat/completions', {}],
  ['alternate model', endpoint, { model: 'deepseek-reasoner' }], ['overflow', endpoint, { max_tokens: 1025 }],
  ['zero tokens', endpoint, { max_tokens: 0 }], ['streaming', endpoint, { stream: true }], ['hidden token limit', endpoint, { max_completion_tokens: 999999 }],
]) test(`invalid ${label} fails before consuming a slot or reaching transport`, async t => {
  const directory = fixture(t); let calls = 0;
  const client = budget(directory, async () => { calls++; return new Response('{}'); });
  await assert.rejects(client.fetchForStep(step())(url, request(patch)), /sandbox_provider_request_invalid/);
  assert.equal(calls, 0); assert.equal(client.status().attemptedCalls, 0);
});
test('tool definitions and assistant/tool continuations count as separate provider calls without executing any tools', async t => {
  const directory = fixture(t); let calls = 0;
  const client = budget(directory, async () => { calls++; return new Response('{}'); });
  await send(client, step('tool'), { tools: [{ type: 'function', function: { name: 'get_cart', description: 'Synthetic', parameters: { type: 'object' } } }] });
  await send(client, step('tool'), { messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'synthetic-call', type: 'function', function: { name: 'get_cart', arguments: '{}' } }] },
    { role: 'tool', content: 'Synthetic data', tool_call_id: 'synthetic-call' }] });
  assert.equal(calls, 2); assert.equal(client.status().attemptedCalls, 2);
});
test('a separate process sees durable prior usage and cannot silently reset or retry a step', async t => {
  const directory = fixture(t), metadata = step(); await send(budget(directory), metadata);
  const moduleUrl = new URL('./storefront-sandbox-llm-budget.mjs', import.meta.url).href;
  const source = `import {createSyntheticSandboxDeepSeekBudget} from ${JSON.stringify(moduleUrl)};
    const client=createSyntheticSandboxDeepSeekBudget({directory:${JSON.stringify(directory)},fetchFn:async()=>new Response('{}')});
    let denied=false; try{await client.fetchForStep(${JSON.stringify(metadata)})(${JSON.stringify(endpoint)},${JSON.stringify(request())})}catch(error){denied=error.message==='sandbox_budget_step_already_attempted'}
    console.log(JSON.stringify({count:client.status().attemptedCalls,denied}));`;
  const child = spawnSync(process.execPath, ['--import', new URL('./test-network-guard.mjs', import.meta.url).href, '--input-type=module'],
    { env: childEnvironment(), input: source, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(child.status, 0); assert.deepEqual(JSON.parse(child.stdout), { count: 1, denied: true });
});
test('an exhausted sixty-call ledger also refuses a new step in a fresh guarded process', async t => {
  const directory = fixture(t), client = budget(directory);
  for (let index = 0; index < 60; index++) await send(client);
  const moduleUrl = new URL('./storefront-sandbox-llm-budget.mjs', import.meta.url).href;
  const source = `import {createSyntheticSandboxDeepSeekBudget} from ${JSON.stringify(moduleUrl)};
    let calls=0; const client=createSyntheticSandboxDeepSeekBudget({directory:${JSON.stringify(directory)},fetchFn:async()=>{calls++;return new Response('{}')}});
    let denied=false; try{await client.fetchForStep(${JSON.stringify(step())})(${JSON.stringify(endpoint)},${JSON.stringify(request())})}catch(error){denied=error.message==='sandbox_budget_exhausted'}
    console.log(JSON.stringify({count:client.status().attemptedCalls,calls,denied}));`;
  const child = spawnSync(process.execPath, ['--import', new URL('./test-network-guard.mjs', import.meta.url).href, '--input-type=module'],
    { env: childEnvironment(), input: source, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(child.status, 0); assert.deepEqual(JSON.parse(child.stdout), { count: 60, calls: 0, denied: true });
});
test('a transport exception cannot spoof a known failure and leak arbitrary private properties', async t => {
  const directory = fixture(t), forged = Object.assign(new Error('sandbox_provider_http_failed'), { httpStatus: 'PRIVATE_STATUS', secret: 'PRIVATE_CONTEXT' });
  await assert.rejects(send(budget(directory, async () => { throw forged; })), error => {
    assert.equal(error.message, 'sandbox_provider_network_failed'); assert.equal(error.httpStatus, undefined); assert.equal(error.secret, undefined); return true;
  });
});
test('missing, malformed and truncated ledger state never auto-initializes or spends again', async t => {
  const directory = fixture(t); await send(budget(directory));
  writeFileSync(join(directory, 'attempts.jsonl'), '{');
  assert.throws(() => budget(directory).status(), /sandbox_budget_ledger_invalid/);
  assert.throws(() => budget(join(directory, 'absent')).status(), /sandbox_budget_not_initialized/);
  assert.equal(existsSync(join(directory, 'absent')), false);
});
test('a leftover lock fails closed instead of assuming process death authorizes a fresh budget', async t => {
  const directory = fixture(t); writeFileSync(join(directory, 'reservation.lock'), 'synthetic-stale-lock');
  await assert.rejects(send(budget(directory)), /sandbox_budget_locked/);
  assert.equal(readFileSync(join(directory, 'attempts.jsonl'), 'utf8'), '');
});
test('manifest tampering or a real manifest substituted into synthetic tests is refused', t => {
  const directory = fixture(t), path = join(directory, 'manifest.json'), original = JSON.parse(readFileSync(path, 'utf8'));
  for (const patch of [{ maximumCalls: 61 }, { maximumOutputTokensPerCall: 2048 }, { approvalId: 'another' }, { synthetic: false }]) {
    writeFileSync(path, JSON.stringify({ ...original, ...patch }));
    assert.throws(() => budget(directory).status(), /sandbox_budget_manifest_invalid/);
  }
});
test('ledger stores only technical bounded metadata, never prompt, credentials or tool results', async t => {
  const directory = fixture(t), client = budget(directory); await send(client, step('copy'));
  const text = readFileSync(join(directory, 'attempts.jsonl'), 'utf8');
  assert.equal(text.includes('SYNTHETIC_PRIVATE_MESSAGE'), false); assert.equal(text.includes('synthetic-only'), false);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['at', 'callNumber', 'maxTokens', 'stage', 'stepId', 'version']);
});
test('invalid CLI arguments stop before creating state or initializing any application', () => {
  const result = spawnSync(process.execPath, ['--', fileURLToPath(new URL('./storefront-sandbox-llm-budget.mjs', import.meta.url)), '--run', '--env-file=never-read'],
    { env: childEnvironment(), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).reason, 'sandbox_budget_cli_invalid');
});
