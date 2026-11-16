import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantScope, metaAssistantFixture } from '../../meta-ads-agent/application/__tests__/assistant-fixture.js';
import { AssistantService } from '../application/assistant.service.js';
import { AssistantKnowledgeRetriever } from './assistant-knowledge.retriever.js';
import { MerchantAiGateway } from './merchant-ai.gateway.js';
import { AssistantWorker } from './assistant.worker.js';
const serialized = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);

async function fixture() {
  const f = await metaAssistantFixture();
  await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(f.turn.id, { status: 'queued', leaseToken: null, leaseUntil: null }));
  let calls = 0;
  let provider: () => Promise<Response> = async () => new Response(JSON.stringify({ id: `response-${calls}`, choices: [{ message: { content: JSON.stringify({ reply: 'Qual resultado deseja para sua campanha?', referenceIds: [] }) } }], usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } }), { status: 200 });
  const gateway = new MerchantAiGateway({ repo: f.conversations, admission: f.admission, clock: f.clock, config: () => ({ apiKey: 'synthetic-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }), authorizeModel: async () => {}, rates: async () => ({ inputMicrosPerMillion: 10000n, outputMicrosPerMillion: 20000n }), transport: async () => { calls++; return provider(); } });
  const service = new AssistantService({ repo: f.conversations, context: f.adapter, knowledge: new AssistantKnowledgeRetriever(undefined, f.clock), model: gateway, clock: f.clock });
  const worker = () => new AssistantWorker({ repo: f.conversations, admission: f.admission, respond: input => service.respond(input), clock: f.clock });
  const saved = async () => (await f.conversations.turns(assistantScope, f.thread.id)).turns[0];
  return { ...f, gateway, service, worker, saved, calls: () => calls, provider: (fn: () => Promise<Response>) => { provider = fn; } };
}
test('ADAS-10 persisted queue completes with response and settled measured usage', async () => {
  const f = await fixture(); try {
    await f.worker().drain(); const saved = await f.saved();
    assert.equal(saved.status, 'completed'); assert.equal(saved.reply, 'Qual resultado deseja para sua campanha?');
    assert.equal(saved.budgetState, 'settled'); assert.equal(saved.usageCostMicros, 1n);
    assert.equal(saved.leaseToken, null); assert.equal(f.calls(), 1); assert.equal(saved.error, null);
    await f.worker().drain(); assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});
test('ADAS-51 two workers drain one persisted turn with one physical model request', async () => {
  const f = await fixture(); try {
    await Promise.all([f.worker().drain(), f.worker().drain()]);
    assert.equal(f.calls(), 1); assert.equal((await f.saved()).status, 'completed');
    assert.equal((await f.saved()).providerRequests.length, 1);
  } finally { await f.close(); }
});
test('ADAS-51 restart before dispatch reclaims the expired lease and finishes the existing turn', async () => {
  const f = await fixture(); try {
    await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(f.turn.id, { status: 'running', leaseToken: 'dead-worker', leaseUntil: '2026-11-14T11:59:00Z' }));
    await f.worker().drain(); assert.equal((await f.saved()).status, 'completed'); assert.equal(f.calls(), 1);
    assert.equal((await f.conversations.turns(assistantScope, f.thread.id)).turns.length, 1);
  } finally { await f.close(); }
});
test('ADAS-50 expired in-flight dispatch becomes unknown without a repeated model call', async () => {
  const f = await fixture(); try {
    await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(f.turn.id, { status: 'running', leaseToken: 'dead-worker', leaseUntil: '2026-11-14T11:59:00Z', budgetState: 'dispatched', providerRequests: [{ key: 'model-step-0-1', kind: 'model', status: 'sending' }] }));
    await f.worker().drain(); const saved = await f.saved();
    assert.equal(saved.status, 'unknown'); assert.equal(saved.budgetState, 'unknown'); assert.equal(saved.providerRequests[0].status, 'unknown'); assert.equal(f.calls(), 0);
    await f.worker().drain(); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
test('ADAS-14 restarting after a paid model result reuses its durable step receipt without another charge', async () => {
  const f = await fixture(); try {
    await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(f.turn.id, { status: 'running', leaseToken: 'lease-a', leaseUntil: '2026-11-14T12:01:00Z' }));
    const first = await f.service.respond(f.input); assert.equal(f.calls(), 1);
    f.setNow('2026-11-14T12:02:00Z'); await f.worker().drain();
    const saved = await f.saved(); assert.equal(saved.status, 'completed'); assert.equal(saved.reply, first.reply);
    assert.equal(f.calls(), 1); assert.equal(saved.usageCostMicros, 1n); assert.equal(saved.providerRequests.length, 1);
  } finally { await f.close(); }
});
test('ADAS-50 sent timeout remains unknown and explicit replay cannot dispatch it again', async () => {
  const f = await fixture(); try {
    f.provider(async () => { throw Error('timeout with Authorization: synthetic-secret'); });
    await f.worker().drain(); const saved = await f.saved();
    assert.equal(saved.status, 'unknown'); assert.equal(saved.budgetState, 'unknown');
    const retry = await f.admission.submit(assistantScope, f.thread.id, { message: 'Quero anunciar', expectedRevision: 0, idempotencyKey: 'request-a' });
    assert.equal(retry.turn.id, f.turn.id); assert.equal(retry.turn.status, 'unknown');
    await f.worker().drain(); assert.equal(f.calls(), 1); assert.ok(!serialized(saved).includes('synthetic-secret'));
  } finally { await f.close(); }
});
test('ADAS-14 failure before paid consumption can explicitly requeue the same turn and reserve once', async () => {
  const f = await fixture(); try {
    f.provider(async () => new Response('sensitive-rejected-response', { status: 401 }));
    await f.worker().drain(); const failed = await f.saved(); assert.equal(failed.status, 'failed'); assert.equal(failed.budgetState, 'released');
    const retry = await f.admission.submit(assistantScope, f.thread.id, { message: 'Quero anunciar', expectedRevision: 0, idempotencyKey: 'request-a' });
    assert.equal(retry.turn.id, f.turn.id); assert.equal(retry.turn.status, 'queued'); assert.equal(retry.turn.budgetState, 'reserved');
    f.provider(async () => new Response(JSON.stringify({ id: 'ok', choices: [{ message: { content: '{"reply":"Qual o objetivo?","referenceIds":[]}' } }], usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } }), { status: 200 }));
    await f.worker().drain(); assert.equal((await f.saved()).status, 'completed'); assert.equal(f.calls(), 2);
    assert.equal((await f.saved()).providerRequests.length, 2);
    assert.equal((await f.conversations.turns(assistantScope, f.thread.id)).turns.length, 1);
  } finally { await f.close(); }
});
test('ADAS-51 a response from a worker that lost its lease cannot overwrite durable state', async () => {
  const f = await fixture(); try {
    const worker = new AssistantWorker({ repo: f.conversations, admission: f.admission, clock: f.clock, respond: async input => {
      await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(input.turnId, { leaseToken: 'new-worker', leaseUntil: '2026-11-14T12:10:00Z' }));
      return { reply: 'Obsoleto', references: [], artifacts: [] };
    } });
    await worker.drain(); const saved = await f.saved();
    assert.equal(saved.status, 'running'); assert.equal(saved.reply, null); assert.equal(saved.leaseToken, 'new-worker');
  } finally { await f.close(); }
});
test('ADAS-53 local orchestration failure releases unspent reservation and persists only a safe code', async () => {
  const f = await fixture(); try {
    const worker = new AssistantWorker({ repo: f.conversations, admission: f.admission, clock: f.clock, respond: async () => { throw Error('Authorization: private-credential'); } });
    await worker.drain(); const saved = await f.saved();
    assert.equal(saved.status, 'failed'); assert.equal(saved.budgetState, 'released'); assert.equal(saved.error, 'assistant_call_failed');
    assert.ok(!serialized(saved).includes('private-credential'));
  } finally { await f.close(); }
});
test('ADAS-14 restart after generation tool reuses paid steps and the same image reservations', async () => {
  const f = await fixture(); try {
    await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(f.turn.id, { status: 'running', leaseToken: 'lease-a', leaseUntil: '2026-11-14T12:01:00Z' }));
    await f.call('merchant_ads_save_draft', { variantIds: ['variant-a'], priority: 'roas', destination: 'store', country: 'BR', approvalPreference: 'manual', budget: { amountCents: 10000, currency: 'BRL', cadence: 'lifetime', startsAt: '2026-11-16T03:00:00Z', endsAt: '2026-11-23T03:00:00Z' } });
    f.provider(async () => new Response(JSON.stringify({ id: `request-${f.calls()}`, choices: [{ message: f.calls() === 1 ? { tool_calls: [{ id: 'generate-a', type: 'function', function: { name: 'merchant_ads_generate', arguments: '{"imageCount":2}' } }] } : { content: '{"reply":"Suas imagens estão na fila.","referenceIds":[]}' } }], usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } }), { status: 200 }));
    const response = await f.service.respond(f.input); assert.equal(f.calls(), 2); assert.equal(response.artifacts[0].type, 'generation');
    f.setNow('2026-11-14T12:02:00Z'); await f.worker().drain();
    assert.equal((await f.saved()).status, 'completed'); assert.equal(f.calls(), 2);
    const state = await f.repo.read('store-a'); assert.equal(Object.keys(state.generations).length, 1); assert.equal(state.credits.monthlyAvailable, 28);
    assert.equal(Object.keys(state.credits.reservations).length, 2); assert.equal(f.physicalImages(), 0);
  } finally { await f.close(); }
});
test('ADAS-50 invalid but metered model response settles known cost and never rebuys that step', async () => {
  const f = await fixture(); try {
    f.provider(async () => new Response(JSON.stringify({ id: 'bad-reply', choices: [{ message: { content: 'invalid-json' } }], usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } }), { status: 200 }));
    await f.worker().drain(); const saved = await f.saved();
    assert.equal(saved.status, 'failed'); assert.equal(saved.budgetState, 'settled'); assert.equal(saved.usageCostMicros, 1n);
    const retry = await f.admission.submit(assistantScope, f.thread.id, { message: 'Quero anunciar', expectedRevision: 0, idempotencyKey: 'request-a' });
    assert.equal(retry.turn.status, 'failed'); await f.worker().drain(); assert.equal(f.calls(), 1);
    assert.equal(saved.providerRequests[0].status, 'completed');
  } finally { await f.close(); }
});
