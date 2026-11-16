import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '../../auth/domain/services/jwt.service.js';
import { AuthCookieService } from '../../auth/domain/services/auth-cookie.service.js';
import { AuthGuard } from '../../auth/presentation/auth.guard.js';
import { authorityFixture } from '../application/__tests__/authority-fixture.js';
import { AutomationPolicyService } from '../application/automation-policy.service.js';
import { MetaAdsAgentService } from '../application/meta-ads-agent.service.js';
import { PrismaDailyObservationRepository } from '../infrastructure/prisma-daily-observation.repository.js';
import { DAILY_OBSERVATION_REPOSITORY } from '../domain/daily-observation.port.js';
import { latestClosedObservationDay } from '../domain/daily-observation-calendar.js';
import { MetaAdsHttpErrorFilter } from './meta-ads-agent.controller.js';
import { AutomationReportController } from './automation-report.controller.js';

async function fixture() {
  const f = await authorityFixture(); Object.assign(f.service.env, { META_ADS_DASHBOARD_URL: 'https://dashboard.example.test' });
  const daily = new PrismaDailyObservationRepository(f.prisma, f.clock);
  const jwt = { authenticate: async (token: string) => { if (!['owner-a', 'owner-b', 'staff-a'].includes(token)) throw Error('jwt_invalid_signature'); return { merchantId: token === 'owner-b' ? 'store-b' : 'store-a', userId: token, email: 'owner@example.test', role: token === 'staff-a' ? 'staff' : 'owner' }; } } as unknown as JwtService;
  Reflect.defineMetadata('design:paramtypes', [JwtService, AuthCookieService], AuthGuard);
  @Module({ controllers: [AutomationReportController], providers: [{ provide: AutomationPolicyService, useValue: f.policies }, { provide: DAILY_OBSERVATION_REPOSITORY, useValue: daily }, { provide: MetaAdsAgentService, useValue: f.service }, { provide: JwtService, useValue: jwt }, { provide: AuthCookieService, useValue: new AuthCookieService('aacp_access_token', false) }, AuthGuard, MetaAdsHttpErrorFilter] }) class HttpModule {}
  const app = await NestFactory.create(HttpModule, { logger: false }); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/meta-ads-agent`;
  const request = (path: string, method = 'GET', body?: unknown, token: string | null = 'owner-a', headers: Record<string, string> = {}) => fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const terms = { scope: f.policy.scope, limits: f.policy.limits };
  return { ...f, request, daily, terms, closeHttp: async () => { await app.close(); await f.close(); } };
}

test('ADAS-48 policy HTTP rejects anonymous staff and cross-store mutations before acceptance', async () => {
  const f = await fixture(); try { assert.equal((await f.request('/automation', 'GET', undefined, null)).status, 401); assert.equal((await f.request('/automation', 'GET', undefined, 'staff-a')).status, 403); assert.equal((await f.request('/automation/review', 'POST', f.terms, 'owner-b')).status, 403); assert.equal((await f.policies.view('store-a')).policy!.id, f.policy.id); assert.equal((await f.repo.read('store-b')).automation, undefined); } finally { await f.closeHttp(); }
});
test('ADAS-32 policy review returns exact account limits version and digest without accepting changes', async () => {
  const f = await fixture(); try { const response = await f.request('/automation/review', 'POST', f.terms); assert.equal(response.status, 200); const review = await response.json(); assert.equal(review.accountId, '100'); assert.equal(review.version, f.policy.version + 1); assert.deepEqual(review.scope, f.policy.scope); assert.deepEqual(review.limits, f.policy.limits); assert.match(review.digest, /^[a-f0-9]{64}$/); const current = await (await f.request('/automation')).json(); assert.equal(current.policy.id, f.policy.id); assert.equal(current.version, f.policy.version); } finally { await f.closeHttp(); }
});
test('ADAS-33 explicit HTTP accept persists immutable actor terms and idempotent version without proposal approvals', async () => {
  const f = await fixture(); try {
    const review = await (await f.request('/automation/review', 'POST', f.terms)).json(); const input = { ...f.terms, version: review.version, digest: review.digest, idempotencyKey: 'http-accept' };
    const first = await f.request('/automation/accept', 'POST', input); assert.equal(first.status, 200); const policy = (await first.json()).policy;
    const replay = await f.request('/automation/accept', 'POST', input); assert.equal(replay.status, 200); assert.equal((await replay.json()).policy.id, policy.id);
    const saved = (await f.repo.getRecord<{ policy: typeof policy }>('store-a', `automatic-policy:${policy.id}`))!.payload.policy;
    assert.equal(saved.acceptedBy, 'owner-a'); assert.equal(saved.acceptedAt, f.clock().toISOString()); assert.equal(saved.accountId, '100'); assert.equal(saved.version, review.version); assert.equal(saved.digest, review.digest); assert.deepEqual(saved.limits, f.terms.limits);
    assert.equal(Object.values((await f.repo.read('store-a')).proposals).some(p => p.approvedBy !== null), false); assert.equal(f.calls.includes('execute'), false);
  } finally { await f.closeHttp(); }
});
test('ADAS-39 changed digest stale version or client-selected actor cannot accept policy through HTTP', async () => {
  const f = await fixture(); try {
    const review = await (await f.request('/automation/review', 'POST', f.terms)).json();
    for (const input of [{ ...f.terms, version: review.version, digest: 'f'.repeat(64), idempotencyKey: 'bad-digest' }, { ...f.terms, version: 0, digest: review.digest, idempotencyKey: 'old-version' }]) assert.equal((await f.request('/automation/accept', 'POST', input)).status, 409);
    assert.equal((await f.request('/automation/accept', 'POST', { ...f.terms, version: review.version, digest: review.digest, idempotencyKey: 'actor', actorId: 'owner-b' })).status, 400);
    assert.equal((await f.policies.view('store-a')).policy!.id, f.policy.id);
  } finally { await f.closeHttp(); }
});
test('ADAS-38 returning to manual revokes new authority and keeps remote objects and prior audit visible', async () => {
  const f = await fixture(); try {
    const response = await f.request('/automation/manual', 'POST', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'http-manual' }); assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.mode, 'manual'); assert.ok(result.policy.revokedAt);
    const state = await f.repo.read('store-a'); assert.equal(state.campaigns[f.campaignId].remoteCampaignId, '200'); assert.equal(state.campaigns[f.campaignId].status, 'remote_paused'); assert.equal(f.calls.includes('execute'), false); assert.ok(await f.repo.getRecord('store-a', `automatic-policy-revoked:${f.policy.id}`));
  } finally { await f.closeHttp(); }
});
test('ADAS-48 cookie policy mutations require trusted origin and reject client-selected tenant or account', async () => {
  const f = await fixture(); try {
    assert.equal((await f.request('/automation/review', 'POST', f.terms, null, { Cookie: 'aacp_access_token=owner-a', Origin: 'https://evil.example.test' })).status, 403);
    assert.equal((await f.request('/automation/review', 'POST', f.terms, null, { Cookie: 'aacp_access_token=owner-a', Origin: 'https://dashboard.example.test' })).status, 200);
    for (const injected of [{ merchantId: 'store-b' }, { accountId: '200' }, { mode: 'automatic' }]) assert.equal((await f.request('/automation/review', 'POST', { ...f.terms, ...injected })).status, 400);
  } finally { await f.closeHttp(); }
});
test('ADAS-44 report HTTP returns scoped public report without lease private progress or credentials', async () => {
  const f = await fixture(); try {
    const day = latestClosedObservationDay(f.clock(), 'America/Sao_Paulo'); const run = await f.daily.admit({ merchantId: 'store-a', accountId: '100', ...day }); const lease = (await f.daily.claim('store-a', run.id))!;
    const report = { id: run.id, accountId: '100', localDay: day.localDay, timezone: day.timezone, since: day.since, until: day.until, status: 'completed' as const, analysisStatus: 'awaiting_data' as const, collectedAt: f.clock().toISOString(), updatedAt: f.clock().toISOString(), campaigns: [], notes: ['observed_attribution_not_causal_uplift'] };
    await f.daily.checkpoint(lease, { report, progress: { privateModelTurn: 'private-turn' } }); await f.daily.finish(lease, 'completed');
    const response = await f.request(`/reports/${run.id}`); assert.equal(response.status, 200); assert.deepEqual(await response.json(), report);
    const list = await (await f.request('/reports')).json(); assert.deepEqual(list.reports, [report]); assert.equal(JSON.stringify(list).includes('leaseToken'), false); assert.equal(JSON.stringify(list).includes('private-turn'), false); assert.equal(JSON.stringify(list).includes('scoped-test-token'), false);
    assert.equal((await f.request(`/reports/${run.id}`, 'GET', undefined, 'owner-b')).status, 404); assert.deepEqual((await (await f.request('/reports', 'GET', undefined, 'owner-b')).json()).reports, []);
    assert.equal((await f.request('/reports?merchantId=store-b')).status, 400);
  } finally { await f.closeHttp(); }
});
test('ADAS-40 changing ads authority cannot mutate persisted checkout automation settings', async () => {
  const f = await fixture(); try {
    const checkout = { checkout: { automatic: true, discountCeilingPercent: 12 } }; await f.sql.query("ALTER TABLE merchants ADD COLUMN store_settings JSONB"); await f.sql.query("UPDATE merchants SET store_settings=$1 WHERE id='store-a'", [checkout]);
    assert.equal((await f.request('/automation/manual', 'POST', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'separate-checkout' })).status, 200);
    const review = await (await f.request('/automation/review', 'POST', f.terms)).json(); assert.equal((await f.request('/automation/accept', 'POST', { ...f.terms, version: review.version, digest: review.digest, idempotencyKey: 'separate-checkout-again' })).status, 200);
    assert.deepEqual((await f.sql.query("SELECT store_settings FROM merchants WHERE id='store-a'")).rows[0].store_settings, checkout);
  } finally { await f.closeHttp(); }
});
