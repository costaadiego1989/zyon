import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createWhatsAppOperatorHttpFixture } from './whatsapp-operator-http-fixture.mjs';
import { SERVICE_LOCAL_TEST_MS } from './service-test-startup.mjs';

test('T58 signed current membership bootstrap without private profile or authorization grants', { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createWhatsAppOperatorHttpFixture({ provider: 'META_CLOUD', operatorDelivery: true, whatsapp: true });
  const endpoint = '/support/whatsapp/conversations/context';
  const get = (auth, suffix = '') => f.request(endpoint + suffix, undefined, auth, 'GET');
  const membership = auth => ({ merchantId_userId: { merchantId: auth.merchant_id, userId: auth.user_id } });
  async function login(auth) {
    const result = await f.request('/auth/login', { email: auth.email, password: auth.password });
    assert.equal(result.status, 201); return { ...auth, ...result.body };
  }
  try {
    await t.test('products/services and owner/admin/staff use real signed sessions and a closed DTO', async () => {
      for (const owner of [f.ownerAuth, f.productAuth]) {
        assert.deepEqual((await get(owner)).body, { merchant_id: owner.merchant_id, user_id: owner.user_id, role: 'OWNER' });
      }
      for (const role of ['STAFF', 'ADMIN']) {
        await f.raw.merchantTeamMember.update({ where: membership(f.staffAuth), data: { role } });
        await f.raw.merchantUser.update({ where: { id: f.staffAuth.user_id }, data: { role: role.toLowerCase() } });
        const auth = await login(f.staffAuth), actual = await get(auth);
        assert.equal(actual.status, 200);
        assert.deepEqual(actual.body, { merchant_id: auth.merchant_id, user_id: auth.user_id, role });
      }
      await f.raw.merchantTeamMember.update({ where: membership(f.staffAuth), data: { role: 'STAFF' } });
      await f.raw.merchantUser.update({ where: { id: f.staffAuth.user_id }, data: { role: 'staff' } });
      Object.assign(f.staffAuth, await login(f.staffAuth));
      assert.equal((await f.request('/merchants/me', undefined, f.staffAuth, 'GET')).status, 403);
      assert.equal((await f.request('/auth/me', undefined, f.staffAuth, 'GET')).status, 403);
      const email = 'context-products-staff@example.test', password = 'SyntheticPassword123!';
      const registered = await f.request('/auth/register', { merchant_name: 'Synthetic product operator', email, password, business_mode: 'products' });
      assert.equal(registered.status, 201);
      await f.raw.merchantUser.update({ where: { id: registered.body.user_id }, data: { merchantId: f.productAuth.merchant_id, role: 'staff' } });
      await f.raw.merchantTeamMember.updateMany({ where: { userId: registered.body.user_id }, data: { merchantId: f.productAuth.merchant_id, role: 'STAFF' } });
      const productStaff = await login({ email, password });
      const actual = await get(productStaff); assert.equal(actual.status, 200);
      assert.deepEqual(actual.body, { merchant_id: f.productAuth.merchant_id, user_id: registered.body.user_id, role: 'STAFF' });
      assert.equal((await f.request('/merchants/me', undefined, productStaff, 'GET')).status, 403);
    });
    await t.test('foreign authority and missing authentication never select a workspace', async () => {
      assert.equal((await get(undefined)).status, 401);
      const parts = f.staffAuth.access_token.split('.');
      parts[2] = (parts[2][0] === 'x' ? 'y' : 'x') + parts[2].slice(1);
      assert.equal((await get({ ...f.staffAuth, access_token: parts.join('.') })).status, 401);
      assert.equal((await get(f.staffAuth, '?merchant_id=' + f.foreignAuth.merchant_id)).status, 403);
      assert.equal((await get(f.staffAuth, '?role=OWNER')).status, 400);
      assert.equal((await get(f.staffAuth, '?merchant_id=' + f.staffAuth.merchant_id)).status, 400);
      const foreign = await get(f.foreignAuth);
      assert.equal(foreign.status, 200); assert.equal(foreign.body.merchant_id, f.foreignAuth.merchant_id);
      assert.notEqual(foreign.body.merchant_id, f.staffAuth.merchant_id);
    });
    await t.test('missing membership and disabled user invalidate already signed sessions', async () => {
      const row = await f.raw.merchantTeamMember.findUniqueOrThrow({ where: membership(f.staffAuth) });
      await f.raw.merchantTeamMember.delete({ where: membership(f.staffAuth) });
      try { assert.equal((await get(f.staffAuth)).status, 401); }
      finally { await f.raw.merchantTeamMember.create({ data: row }); }
      await f.raw.merchantUser.update({ where: { id: f.staffAuth.user_id }, data: { disabledAt: new Date() } });
      try { assert.equal((await get(f.staffAuth)).status, 401); }
      finally { await f.raw.merchantUser.update({ where: { id: f.staffAuth.user_id }, data: { disabledAt: null } }); }
    });
    await t.test('channel disabled/offline/error changes neither identity nor private access', async () => {
      const original = await f.raw.whatsAppChannelConfig.findUniqueOrThrow({ where: { id: f.staffAuth.merchant_id + '-config' } });
      const expected = { merchant_id: f.staffAuth.merchant_id, user_id: f.staffAuth.user_id, role: 'STAFF' };
      try {
        for (const state of [{ enabled: false, status: 'ACTIVE' }, { enabled: true, status: 'DISCONNECTED' }, { enabled: true, status: 'ERROR' }]) {
          await f.raw.whatsAppChannelConfig.update({ where: { id: original.id }, data: state });
          const actual = await get(f.staffAuth); assert.equal(actual.status, 200); assert.deepEqual(actual.body, expected);
          assert.equal((await f.request('/merchants/me', undefined, f.staffAuth, 'GET')).status, 403);
        }
      } finally { await f.raw.whatsAppChannelConfig.update({ where: { id: original.id }, data: { enabled: original.enabled, status: original.status } }); }
    });
    await t.test('context reads preserve plan, quota, membership and channel data byte-for-value', async () => {
      const read = async () => ({
        merchant: await f.raw.merchant.findUniqueOrThrow({ where: { id: f.staffAuth.merchant_id } }),
        membership: await f.raw.merchantTeamMember.findUniqueOrThrow({ where: membership(f.staffAuth) }),
        channel: await f.raw.whatsAppChannelConfig.findUniqueOrThrow({ where: { id: f.staffAuth.merchant_id + '-config' } }),
        subscription: await f.raw.merchantBillingSubscription.findUnique({ where: { merchantId: f.staffAuth.merchant_id } }),
        quotaPeriods: await f.raw.merchantOrderQuotaPeriod.findMany({ where: { merchantId: f.staffAuth.merchant_id }, orderBy: { periodStart: 'asc' } }),
        quotaEntries: await f.raw.merchantOrderQuotaEntry.findMany({ where: { merchantId: f.staffAuth.merchant_id }, orderBy: { id: 'asc' } }),
      });
      const before = await read(); assert.equal((await get(f.staffAuth)).status, 200); assert.deepEqual(await read(), before);
      try {
        for (const plan of ['CHECKOUT_ONLY', 'STORE_ONLY', 'BOTH', 'API']) {
          await f.raw.merchant.update({ where: { id: f.staffAuth.merchant_id }, data: { plan } });
          const baseline = await read(), actual = await get(f.staffAuth);
          assert.equal(actual.status, 200); assert.deepEqual(actual.body, { merchant_id: f.staffAuth.merchant_id, user_id: f.staffAuth.user_id, role: 'STAFF' });
          assert.deepEqual(await read(), baseline);
          assert.equal((await f.request('/merchants/me', undefined, f.staffAuth, 'GET')).status, 403);
        }
      } finally { await f.raw.merchant.update({ where: { id: f.staffAuth.merchant_id }, data: { plan: before.merchant.plan } }); }
    });
    await t.test('valid scoped machine credentials do not become human membership context', async () => {
      const { ApiKeyService } = await import('../dist/modules/integrations/domain/api-key.service.js');
      const key = new ApiKeyService().generate('test');
      await f.raw.merchantBillingSubscription.upsert({ where: { merchantId: f.ownerAuth.merchant_id }, create: { merchantId: f.ownerAuth.merchant_id, planKey: 'growth', status: 'active' }, update: { planKey: 'growth', status: 'active', stripePriceId: null } });
      await f.raw.merchantApiKey.create({ data: { id: randomUUID(), merchantId: f.ownerAuth.merchant_id, name: 'Synthetic context read', keyHash: key.keyHash, keyPrefix: key.keyPrefix, scopes: ['support:read'], environment: 'test' } });
      const credential = { access_token: key.rawKey, merchant_id: f.ownerAuth.merchant_id };
      assert.equal((await f.request('/support/tickets', undefined, credential, 'GET')).status, 200);
      assert.equal((await get(credential)).status, 403);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
    assert.equal(f.runtime.evidence().authOverrides, false);
    assert.equal(f.runtime.evidence().repositoryOverrides, false);
  } finally { await f.close(); }
});
