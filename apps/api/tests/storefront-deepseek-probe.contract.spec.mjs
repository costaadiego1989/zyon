import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateProbeUsage, createBoundedDeepSeekFetch, selectDeepSeekConfig } from './storefront-deepseek-probe.mjs';

test('usage counters are bounded numbers, never unvalidated provider text', () => {
  const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  assert.deepEqual(aggregateProbeUsage(zero, { promptTokens: 12, completionTokens: 8, totalTokens: 20 }),
    { promptTokens: 12, completionTokens: 8, totalTokens: 20 });
  for (const value of ['PRIVATE_PROVIDER_USAGE', -1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => aggregateProbeUsage(zero, { promptTokens: value, completionTokens: 8, totalTokens: 20 }), /probe_usage_invalid/);
  }
  assert.throws(() => aggregateProbeUsage(zero, null), /probe_usage_invalid/);
});

test('probe selects only explicit DeepSeek config and rejects another provider', () => {
  const config = selectDeepSeekConfig({ DEEPSEEK_API_KEY: 'synthetic-key', DEEPSEEK_MODEL: 'deepseek-chat' });
  assert.deepEqual(config, { apiKey: 'synthetic-key', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' });
  assert.throws(() => selectDeepSeekConfig({ DEEPSEEK_API_KEY: '' }), /probe_config_invalid/);
  assert.throws(() => selectDeepSeekConfig({ DEEPSEEK_API_KEY: 'synthetic-key', DEEPSEEK_BASE_URL: 'https://untrusted.invalid/v1' }), /probe_config_invalid/);
  assert.throws(() => selectDeepSeekConfig({ DEEPSEEK_API_KEY: 'synthetic-key', DEEPSEEK_MODEL: 'model\nsecret' }), /probe_config_invalid/);
});

test('bounded fetch enforces three calls, output budget, JSON and no redirects/retries', async () => {
  const calls = [];
  const fetchFn = createBoundedDeepSeekFetch(async (url, options) => {
    calls.push({ url, options });
    return new Response('{}');
  });
  const options = { method: 'POST', body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 256,
    response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Return JSON.' }] }) };
  for (let index = 0; index < 3; index++) await fetchFn('https://api.deepseek.com/v1/chat/completions', options);
  await assert.rejects(() => fetchFn('https://api.deepseek.com/v1/chat/completions', options), /probe_call_limit/);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

for (const [name, url, patch] of [
  ['external origin', 'https://untrusted.invalid/v1/chat/completions', {}],
  ['credential URL', 'https://user:password@api.deepseek.com/v1/chat/completions', {}],
  ['alternate path', 'https://api.deepseek.com/v1/models', {}],
  ['query', 'https://api.deepseek.com/v1/chat/completions?key=secret', {}],
  ['token overflow', 'https://api.deepseek.com/v1/chat/completions', { max_tokens: 257 }],
  ['tools', 'https://api.deepseek.com/v1/chat/completions', { tools: [] }],
  ['streaming', 'https://api.deepseek.com/v1/chat/completions', { stream: true }],
  ['missing JSON', 'https://api.deepseek.com/v1/chat/completions', { response_format: undefined }],
]) test(`probe rejects ${name} before network`, async () => {
  let calls = 0;
  const fetchFn = createBoundedDeepSeekFetch(async () => { calls++; return new Response('{}'); });
  await assert.rejects(() => fetchFn(url, { method: 'POST', body: JSON.stringify({ max_tokens: 256,
    response_format: { type: 'json_object' }, ...patch }) }), /probe_request_invalid/);
  assert.equal(calls, 0);
});

test('a failed network call is counted and never retried', async () => {
  let calls = 0;
  const fetchFn = createBoundedDeepSeekFetch(async () => { calls++; throw new Error('synthetic_network_failure'); });
  const options = { method: 'POST', body: JSON.stringify({ max_tokens: 64, response_format: { type: 'json_object' } }) };
  await assert.rejects(() => fetchFn('https://api.deepseek.com/v1/chat/completions', options), /synthetic_network_failure/);
  assert.equal(calls, 1);
});

test('provider HTTP failure keeps only status, never response body', async () => {
  const fetchFn = createBoundedDeepSeekFetch(async () => new Response('PRIVATE_PROVIDER_BODY', { status: 401 }));
  await assert.rejects(() => fetchFn('https://api.deepseek.com/v1/chat/completions', { method: 'POST',
    body: JSON.stringify({ max_tokens: 64, response_format: { type: 'json_object' } }) }), error => {
      assert.equal(error.message, 'probe_http_failed');
      assert.equal(error.httpStatus, 401);
      assert.equal(String(error).includes('PRIVATE_PROVIDER_BODY'), false);
      return true;
    });
});

for (const body of ['null', '[]', '{']) test(`probe rejects invalid request object ${body}`, async () => {
  let calls = 0;
  const fetchFn = createBoundedDeepSeekFetch(async () => { calls++; return new Response('{}'); });
  await assert.rejects(() => fetchFn('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body }), /probe_request_invalid/);
  assert.equal(calls, 0);
});
