import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '../../auth/domain/services/jwt.service.js';
import { AuthCookieService } from '../../auth/domain/services/auth-cookie.service.js';
import { AuthGuard } from '../../auth/presentation/auth.guard.js';
import { assistantScope, metaAssistantFixture } from '../../meta-ads-agent/application/__tests__/assistant-fixture.js';
import { AssistantKnowledgeRetriever } from '../infrastructure/assistant-knowledge.retriever.js';
import { AssistantApiService } from '../application/assistant-api.service.js';
import { MerchantAssistantController, AssistantHttpErrorFilter } from './merchant-assistant.controller.js';

async function fixture() {
  const f = await metaAssistantFixture(); f.setNow('2026-11-16T12:00:00Z');
  // The pre-existing fixture turn is completed so each HTTP test can admit a new one.
  await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(f.turn.id, { status: 'completed', reply: 'Como posso ajudar?', budgetState: 'settled', usageCostMicros: 0n, leaseToken: null, leaseUntil: null }));
  let enabled = true, wakes = 0;
  const api = new AssistantApiService({ repo: f.conversations, context: async () => f.adapter, admission: f.admission, knowledge: new AssistantKnowledgeRetriever(undefined, f.clock), enabled: () => enabled, dashboardUrl: 'https://dashboard.example.test', wake: () => { wakes++; } });
  const jwt = { authenticate: async (token: string) => {
    if (!['owner-a', 'owner-b', 'staff-a'].includes(token)) throw Error('jwt_invalid_signature');
    return { merchantId: token === 'owner-b' ? 'store-b' : 'store-a', userId: token, email: 'owner@example.test', role: token === 'staff-a' ? 'staff' : 'owner' };
  } } as unknown as JwtService;
  Reflect.defineMetadata('design:paramtypes', [JwtService, AuthCookieService], AuthGuard);
  @Module({ controllers: [MerchantAssistantController], providers: [{ provide: AssistantApiService, useValue: api }, { provide: JwtService, useValue: jwt }, { provide: AuthCookieService, useValue: new AuthCookieService('aacp_access_token', false) }, AuthGuard, AssistantHttpErrorFilter] }) class TestHttpModule {}
  const app = await NestFactory.create(TestHttpModule, { logger: false }); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/merchant-assistant/contexts`;
  const request = (path = '/meta-ads/thread', method = 'GET', body?: unknown, token: string | null = 'owner-a', headers: Record<string, string> = {}) => fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const send = (body: unknown, token: string | null = 'owner-a', headers?: Record<string, string>) => request(`/meta-ads/threads/${f.thread.id}/turns`, 'POST', body, token, headers);
  return { ...f, request, send, enabled: (value: boolean) => { enabled = value; }, wakes: () => wakes, closeHttp: async () => { await app.close(); await f.close(); } };
}
const message = { message: 'Como adicionar fundos?', idempotencyKey: 'http-request', expectedRevision: 1 };
test('ADAS-48 real HTTP guard rejects anonymous staff foreign owner context and thread before model work', async () => {
  const f = await fixture(); try {
    assert.equal((await f.request('/meta-ads/thread', 'GET', undefined, null)).status, 401);
    assert.equal((await f.request('/meta-ads/thread', 'GET', undefined, 'staff-a')).status, 403);
    assert.equal((await f.request('/meta-ads/thread', 'GET', undefined, 'owner-b')).status, 403);
    assert.equal((await f.request('/buyer/thread')).status, 403);
    assert.equal((await f.request('/meta-ads/threads/foreign/turns')).status, 404);
    assert.equal((await f.request('/meta-ads/threads/foreign/turns', 'POST', message)).status, 404);
    assert.equal(f.wakes(), 0); assert.deepEqual(f.catalogReads, []);
    assert.equal((await f.prisma.merchantAssistantThread.count()).toString(), '1');
  } finally { await f.closeHttp(); }
});
test('ADAS-10 HTTP admission returns 202 with durable queued identity before calling any model', async () => {
  const f = await fixture(); try {
    const response = await f.send(message); assert.equal(response.status, 202); const value = await response.json();
    assert.equal(value.turn.message, message.message); assert.equal(value.turn.status, 'queued'); assert.equal(value.revision, 2);
    const persisted = await f.prisma.merchantAssistantTurn.findUnique({ where: { id: value.turn.id } });
    assert.equal(persisted?.status, 'queued'); assert.equal(persisted?.merchantId, 'store-a');
    assert.equal(persisted?.threadId, f.thread.id); assert.equal(f.wakes(), 1); assert.deepEqual(f.calls, []);
  } finally { await f.closeHttp(); }
});
test('ADAS-14 HTTP replay reuses turn while changed payload and competing revision are rejected', async () => {
  const f = await fixture(); try {
    const first = await (await f.send(message)).json(); const again = await (await f.send(message)).json();
    assert.equal(again.turn.id, first.turn.id); assert.equal(again.replayed, true);
    assert.equal((await f.send({ ...message, message: 'Trocar o objetivo' })).status, 409);
    assert.equal((await f.send({ ...message, idempotencyKey: 'competing' })).status, 409);
    assert.equal(await f.prisma.merchantAssistantTurn.count(), 2);
  } finally { await f.closeHttp(); }
});
test('ADAS-53 public history and admission never expose internal budget leases model receipts or credentials', async () => {
  const f = await fixture(); try {
    await f.conversations.atomic(assistantScope, f.thread.id, tx => tx.update(f.turn.id, { providerRequests: [{ key: 'model-a', kind: 'model', status: 'completed', providerRequestId: 'private-request-id' }] }));
    const thread = await (await f.request()).json(); assert.equal(thread.context.label, 'Anúncios com IA');
    assert.equal(thread.id, f.thread.id); assert.equal(thread.turns[0].reply, 'Como posso ajudar?');
    const accepted = await (await f.send(message)).json();
    for (const data of [thread, accepted]) for (const field of ['leaseToken', 'leaseUntil', 'usageCostMicros', 'budgetAmountMicros', 'providerRequests', 'private-request-id', 'inputHash', 'requestKey', 'scoped-test-token']) assert.ok(!JSON.stringify(data).includes(field));
  } finally { await f.closeHttp(); }
});
test('ADAS-48 cookie mutations require the configured dashboard origin and reject forged authority fields', async () => {
  const f = await fixture(); try {
    for (const origin of [undefined, 'https://evil.example.test']) assert.equal((await f.send(message, null, { Cookie: 'aacp_access_token=owner-a', ...(origin ? { Origin: origin } : {}) })).status, 403);
    assert.equal((await f.send({ ...message, merchantId: 'store-b' })).status, 400);
    assert.equal((await f.send({ ...message, approvedBy: 'owner-a' })).status, 400);
    assert.equal((await f.send(message, null, { Cookie: 'aacp_access_token=owner-a', Origin: 'https://dashboard.example.test' })).status, 202);
    assert.equal(await f.prisma.merchantAssistantTurn.count(), 2);
  } finally { await f.closeHttp(); }
});
test('ADAS-17 source endpoint returns only the authorized current curated document and valid reference identity', async () => {
  const f = await fixture(); try {
    const source = await f.request('/meta-ads/sources/verba-e-pagamentos'); assert.equal(source.status, 200);
    const value = await source.json(); assert.equal(value.id, 'verba-e-pagamentos'); assert.equal(value.version, '2026-11-16.2');
    assert.equal(value.reviewedAt, '2026-11-16'); assert.ok(value.sections.some((s: { content: string }) => s.content.includes('diretamente à Meta')));
    assert.equal((await f.request('/meta-ads/sources/unpublished')).status, 404);
    assert.equal((await f.request('/meta-ads/sources/verba-e-pagamentos', 'GET', undefined, 'owner-b')).status, 403);
  } finally { await f.closeHttp(); }
});
test('ADAS-11 retained thread and source remain readable after subscription expiry but new consumption is denied', async () => {
  const f = await fixture(); try {
    f.setNow('2026-12-02T12:00:00Z'); assert.equal((await f.request()).status, 200);
    assert.equal((await f.request('/meta-ads/sources/verba-e-pagamentos')).status, 200);
    assert.equal((await f.send(message)).status, 403); assert.equal(f.wakes(), 0);
    f.enabled(false); assert.equal((await f.request()).status, 503);
  } finally { await f.closeHttp(); }
});
test('ADAS-11 pagination validates cursors and scopes each selected turn', async () => {
  const f = await fixture(); try {
    await f.send(message);
    const page = await (await f.request(`/meta-ads/threads/${f.thread.id}/turns?limit=1`)).json();
    assert.equal(page.turns.length, 1); assert.equal(page.turns[0].ordinal, 2); assert.equal(page.nextCursor, '2');
    const older = await (await f.request(`/meta-ads/threads/${f.thread.id}/turns?limit=1&before=${page.nextCursor}`)).json();
    assert.equal(older.turns[0].ordinal, 1);
    assert.equal((await f.request(`/meta-ads/threads/${f.thread.id}/turns?limit=NaN`)).status, 400);
    assert.equal((await f.request(`/meta-ads/threads/${f.thread.id}/turns?before=0`)).status, 400);
  } finally { await f.closeHttp(); }
});
