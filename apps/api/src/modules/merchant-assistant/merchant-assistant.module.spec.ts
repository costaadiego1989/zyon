import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantDatabase } from './infrastructure/__tests__/database.js';
import { TenantContextService } from '../../shared/tenant/tenant-context.service.js';
import { configureAiMetering } from '../../shared/ai-metering.js';
import type { MerchantStoreMembership } from '../merchant/domain/ports/merchant-store.repository.port.js';
import type { AssistantContextPort } from './domain/context.port.js';
import { AssistantError } from './domain/assistant.port.js';
import { createMerchantAssistantRuntime } from './infrastructure/runtime.js';
import { MerchantAssistantModule } from './merchant-assistant.module.js';

const scope = { merchantId: 'store-a', actorId: 'owner-a', context: 'inert' };
async function fixture(env: Record<string, string | undefined> = {}) {
  const db = await assistantDatabase(); const tenant = new TenantContextService();
  const memberships = new Map<string, MerchantStoreMembership>([['owner-a:store-a', { merchantId: 'store-a', billingAccountMerchantId: 'company-a', role: 'owner' }]]);
  const identities: Array<{ merchantId: string; userId: string; role: string }> = []; const grants: string[] = []; let calls = 0;
  const runtime = createMerchantAssistantRuntime({ prisma: db.prisma, tenant, memberships: { findMembership: async (actor, merchant) => memberships.get(`${actor}:${merchant}`) },
    governance: { authorize: async (_context, kind, resource) => { grants.push(`${kind}:${resource}`); const identity = tenant.get(); assert.ok(identity); identities.push({ merchantId: identity.merchantId, userId: identity.userId, role: identity.role }); return {} as never; } },
    env: { OPENAI_API_KEY: 'synthetic-key', OPENAI_MODEL: 'gpt-4o-mini', ...env }, clock: () => new Date('2026-11-16T12:00:00Z'),
    transport: async () => { calls++; return new Response(JSON.stringify({ id: 'model-result-a', choices: [{ message: { content: '{"reply":"Como posso ajudar?","referenceIds":[]}' } }], usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } }), { status: 200 }); } });
  const context: AssistantContextPort = { descriptor: { id: 'inert', label: 'Contexto de teste', capabilities: [] }, knowledgeScope: { context: 'inert', audience: 'merchant' }, authorize: runtime.authorizeActor, authorizeInvocation: runtime.authorizeActor, tools: () => [], execute: async () => { throw new AssistantError('assistant_tool_unavailable', 403); } };
  const price = async () => {
    await db.sql.query('CREATE TABLE ai_price_versions(id TEXT PRIMARY KEY, provider TEXT, model TEXT, channel TEXT, component TEXT, currency TEXT, input_micros_per_million BIGINT, output_micros_per_million BIGINT, rates JSONB, effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ)');
    await db.sql.query(`INSERT INTO ai_price_versions VALUES ('price-a','openai','gpt-4o-mini','chat','text_generation','USD',10000,20000,'{"input":"10000","output":"20000"}','2026-01-01',NULL)`);
  };
  return { ...db, runtime, tenant, memberships, identities, grants, context, price, calls: () => calls };
}
test('ADAS-48 module defaults disabled even with a configured provider and registered context', async () => {
  const f = await fixture(); try {
    assert.equal(typeof MerchantAssistantModule, 'function'); f.runtime.contexts.register(f.context);
    await assert.rejects(f.runtime.api.thread(scope), { code: 'assistant_unavailable' });
    assert.equal(await f.prisma.merchantAssistantThread.count(), 0); assert.equal(f.calls(), 0); assert.deepEqual(f.grants, []);
    f.runtime.worker.onModuleInit(); await f.runtime.worker.onModuleDestroy(); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
test('ADAS-15 enabled module requires an explicitly registered context and has no implicit Meta fallback', async () => {
  const f = await fixture({ MERCHANT_ASSISTANT_ENABLED: 'true' }); try {
    await assert.rejects(f.runtime.api.thread(scope), { code: 'assistant_context_unavailable' });
    f.runtime.contexts.register(f.context);
    const thread = await f.runtime.api.thread(scope); assert.equal(thread.context.label, 'Contexto de teste'); assert.deepEqual(thread.context.capabilities, []);
    assert.deepEqual((await f.runtime.contexts.resolve(scope)).tools(), []);
    await assert.rejects(f.runtime.api.thread({ ...scope, context: 'meta-ads' }), { code: 'assistant_context_unavailable' });
    assert.throws(() => f.runtime.contexts.register(f.context), /assistant_context_duplicate/); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
test('ADAS-49 composed worker uses actual gateway and pricing with canonical actor identity in governance and metering', async () => {
  const f = await fixture({ MERCHANT_ASSISTANT_ENABLED: 'true' });
  const meteredActors: string[] = [];
  const dispose = configureAiMetering({ fetch: async (_context, url, init, transport) => { meteredActors.push(f.tenant.get()?.userId ?? 'missing'); return transport!(url, init); } }, () => f.tenant.get()?.merchantId);
  try {
    await f.price(); f.runtime.contexts.register(f.context); const thread = await f.runtime.api.thread(scope);
    const admitted = await f.runtime.api.submit(scope, thread.id, { message: 'Olá', expectedRevision: 0, idempotencyKey: 'runtime-a' });
    await f.runtime.worker.drain(); const result = await f.runtime.api.page(scope, thread.id);
    assert.equal(result.turns[0].id, admitted.turn.id); assert.equal(result.turns[0].status, 'completed'); assert.equal(result.turns[0].reply, 'Como posso ajudar?');
    assert.equal(f.calls(), 1); assert.deepEqual(meteredActors, ['owner-a']); assert.deepEqual(f.identities, [{ merchantId: 'store-a', userId: 'owner-a', role: 'owner' }]);
    assert.deepEqual(f.grants, ['model:openai:gpt-4o-mini']); assert.equal(f.tenant.get(), null);
  } finally { dispose(); await f.runtime.worker.onModuleDestroy(); await f.close(); }
});
test('ADAS-48 revoked or staff membership blocks history and consumption before any provider work', async () => {
  const f = await fixture({ MERCHANT_ASSISTANT_ENABLED: 'true' }); try {
    f.runtime.contexts.register(f.context); const thread = await f.runtime.api.thread(scope);
    f.memberships.set('owner-a:store-a', { merchantId: 'store-a', billingAccountMerchantId: 'company-a', role: 'staff' });
    await assert.rejects(f.runtime.api.page(scope, thread.id), { code: 'assistant_forbidden' });
    await assert.rejects(f.runtime.api.submit(scope, thread.id, { message: 'Oi', expectedRevision: 0, idempotencyKey: 'denied' }), { code: 'assistant_forbidden' });
    await assert.rejects(f.runtime.api.thread({ ...scope, merchantId: 'store-b' }), { code: 'assistant_forbidden' });
    assert.equal(await f.prisma.merchantAssistantTurn.count(), 0); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
test('ADAS-49 missing current tariff fails closed without assuming zero cost or sending a paid request', async () => {
  const f = await fixture({ MERCHANT_ASSISTANT_ENABLED: 'true' }); try {
    await f.price(); await f.sql.query('DELETE FROM ai_price_versions');
    f.runtime.contexts.register(f.context); const thread = await f.runtime.api.thread(scope);
    await f.runtime.api.submit(scope, thread.id, { message: 'Oi', expectedRevision: 0, idempotencyKey: 'no-price' });
    await f.runtime.worker.drain(); const turn = (await f.runtime.api.page(scope, thread.id)).turns[0];
    assert.equal(turn.status, 'failed'); assert.equal(turn.error, 'assistant_pricing_unavailable'); assert.equal(f.calls(), 0);
    const stored = (await f.runtime.repo.turns(scope, thread.id)).turns[0]; assert.equal(stored.budgetState, 'released'); assert.deepEqual(stored.providerRequests, []);
  } finally { await f.runtime.worker.onModuleDestroy(); await f.close(); }
});
test('ADAS-49 invalid operational budget never admits a turn or silently chooses another limit', async () => {
  const f = await fixture({ MERCHANT_ASSISTANT_ENABLED: 'true', MERCHANT_ASSISTANT_TURN_BUDGET_MICROS: '-1' }); try {
    f.runtime.contexts.register(f.context); const thread = await f.runtime.api.thread(scope);
    await assert.rejects(f.runtime.api.submit(scope, thread.id, { message: 'Oi', expectedRevision: 0, idempotencyKey: 'invalid-budget' }), { code: 'assistant_ai_budget_invalid' });
    assert.equal(await f.prisma.merchantAssistantTurn.count(), 0); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
