import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '../../auth/domain/services/jwt.service.js';
import { AuthCookieService } from '../../auth/domain/services/auth-cookie.service.js';
import { AuthGuard } from '../../auth/presentation/auth.guard.js';
import { metaAssistantFixture } from '../application/__tests__/assistant-fixture.js';
import { FundingService } from '../application/funding.service.js';
import { MetaAdsAgentService } from '../application/meta-ads-agent.service.js';
import { MetaAdsHttpErrorFilter } from './meta-ads-agent.controller.js';
import { FundingController } from './funding.controller.js';

async function fixture() {
  const f = await metaAssistantFixture(); await f.connect(); let reads = 0, unavailable = false;
  Object.assign(f.service.env, { META_ADS_DASHBOARD_URL: 'https://dashboard.example.test' });
  const funding = new FundingService(f.repo, f.service.billing, f.service.connection, { read: async access => {
    reads++; assert.equal(access.merchantId, 'store-a'); assert.equal(access.accountId, '100');
    if (unavailable) throw Error('private-provider-error');
    return { accountId: '100', accountName: 'Loja A', currency: 'BRL', billingType: 'prepaid', paymentMethod: 'present', confirmedBlock: false, blockCode: null, amountDueCents: 500, prepaidAvailableCents: null, checkedAt: f.clock().toISOString(), source: 'controlled-meta', paymentUrl: null };
  } }, f.clock);
  const jwt = { authenticate: async (token: string) => {
    if (!['owner-a', 'owner-b', 'staff-a'].includes(token)) throw Error('jwt_invalid_signature');
    return { merchantId: token === 'owner-b' ? 'store-b' : 'store-a', userId: token, email: 'owner@example.test', role: token === 'staff-a' ? 'staff' : 'owner' };
  } } as unknown as JwtService;
  Reflect.defineMetadata('design:paramtypes', [JwtService, AuthCookieService], AuthGuard);
  @Module({ controllers: [FundingController], providers: [{ provide: FundingService, useValue: funding }, { provide: MetaAdsAgentService, useValue: f.service }, { provide: JwtService, useValue: jwt }, { provide: AuthCookieService, useValue: new AuthCookieService('aacp_access_token', false) }, AuthGuard, MetaAdsHttpErrorFilter] }) class HttpModule {}
  const app = await NestFactory.create(HttpModule, { logger: false }); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/meta-ads-agent/funding`;
  const request = (method = 'GET', body?: unknown, token: string | null = 'owner-a', headers: Record<string, string> = {}) => fetch(base + (method === 'POST' ? '/refresh' : ''), { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ...f, request, reads: () => reads, unavailable: () => { unavailable = true; }, closeHttp: async () => { await app.close(); await f.close(); } };
}
test('ADAS-48 funding HTTP principal rejects anonymous staff and foreign store before a payment read', async () => {
  const f = await fixture(); try {
    assert.equal((await f.request('GET', undefined, null)).status, 401);
    assert.equal((await f.request('GET', undefined, 'staff-a')).status, 403);
    assert.equal((await f.request('GET', undefined, 'owner-b')).status, 403);
    assert.equal(f.reads(), 0);
    assert.equal((await f.request()).status, 200); assert.equal(f.reads(), 1);
  } finally { await f.closeHttp(); }
});
test('ADAS-06 refreshing financial status never creates a media payment receipt or commercial credit', async () => {
  const f = await fixture(); try {
    const before = await f.repo.read('store-a');
    const first = await f.request(); assert.equal(first.status, 200); const value = await first.json();
    assert.equal(value.snapshot.accountId, '100'); assert.equal(value.snapshot.amountDueCents, 500); assert.equal(value.snapshot.prepaidAvailableCents, null);
    for (let i = 0; i < 2; i++) assert.equal((await f.request('POST', {})).status, 200);
    assert.equal(f.reads(), 3); const after = await f.repo.read('store-a');
    assert.deepEqual(after.credits, before.credits); assert.deepEqual(after.subscription, before.subscription);
    assert.deepEqual(await f.repo.listRecords('store-a', 'billing_event'), []);
    assert.deepEqual(await f.repo.listRecords('store-a', 'billing_period'), []);
    assert.ok(!f.calls.includes('execute'));
  } finally { await f.closeHttp(); }
});
test('ADAS-48 refresh refuses client-selected account merchant payment proof and untrusted cookie origin', async () => {
  const f = await fixture(); try {
    for (const body of [{ accountId: '200' }, { merchantId: 'store-b' }, { paid: true, receipt: 'claimed' }]) assert.equal((await f.request('POST', body)).status, 400);
    assert.equal((await f.request('POST', {}, null, { Cookie: 'aacp_access_token=owner-a', Origin: 'https://evil.example.test' })).status, 403);
    assert.equal(f.reads(), 0);
    assert.equal((await f.request('POST', {}, null, { Cookie: 'aacp_access_token=owner-a', Origin: 'https://dashboard.example.test' })).status, 200);
    assert.equal(f.reads(), 1);
  } finally { await f.closeHttp(); }
});
test('ADAS-04 unavailable fields remain a usable unknown diagnosis without secrets or a fabricated payment URL', async () => {
  const f = await fixture(); try {
    f.unavailable(); const response = await f.request(); assert.equal(response.status, 200);
    const value = await response.json(); assert.equal(value.status, 'unknown'); assert.equal(value.snapshot, null);
    assert.equal(value.error, 'meta_funding_unavailable'); assert.ok(value.nextSteps.some((step: string) => step.includes('Meta')));
    assert.ok(!JSON.stringify(value).includes('private-provider-error')); assert.ok(!JSON.stringify(value).includes('scoped-test-token'));
    assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable, 30);
  } finally { await f.closeHttp(); }
});
