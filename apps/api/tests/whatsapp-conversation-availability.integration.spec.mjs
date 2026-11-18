import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createWhatsAppOperatorHttpFixture } from './whatsapp-operator-http-fixture.mjs';
import { SERVICE_LOCAL_TEST_MS } from './service-test-startup.mjs';

test('T58 actual empty queue, offline detail and history pagination', { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createWhatsAppOperatorHttpFixture({ provider: 'META_CLOUD', operatorDelivery: true, whatsapp: true });
  try {
    const base = '/support/whatsapp/conversations';
    const get = (suffix, auth = f.ownerAuth) => f.request(base + suffix, undefined, auth, 'GET');
    const visible = await f.makeCase(f.ownerAuth, 'availability-visible');
    const merged = await f.makeCase(f.ownerAuth, 'availability-merged');
    await f.raw.supportTicket.update({ where: { id: merged.ticket.id }, data: { mergedIntoId: visible.ticket.id } });

    await t.test('an actual empty own queue is empty while a merged WhatsApp case stays excluded', async () => {
      const empty = await get('', f.productAuth);
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.body, { data: [], has_more: false, next_cursor: null });
      const list = await get('');
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.data.map(row => row.id), [visible.ticket.id]);
      assert.equal((await get('/' + merged.ticket.id)).status, 404);
      assert.equal((await get('/' + visible.ticket.id, f.foreignAuth)).status, 404);
    });

    await t.test('offline channel facts remain visible without mutating the case or inventing delivery', async () => {
      const original = await f.raw.whatsAppChannelConfig.findUniqueOrThrow({ where: { id: visible.scope.configId } });
      try {
        await f.raw.whatsAppChannelConfig.update({ where: { id: original.id }, data: { enabled: false, status: 'DISCONNECTED' } });
        const before = await f.snapshot(visible);
        const detail = await get('/' + visible.ticket.id);
        assert.equal(detail.status, 200);
        assert.deepEqual(detail.body.channel, { id: original.id, provider: 'META_CLOUD', enabled: false, status: 'DISCONNECTED' });
        assert.equal(detail.body.binding.mode, before.binding.mode);
        assert.equal(detail.body.binding.epoch, before.binding.epoch);
        assert.equal(detail.body.ticket.status, before.ticket.status);
        assert.deepEqual(detail.body.messages, []);
        for (const field of ['credentials', 'accessToken', 'webhookSecret', 'authority', 'submission']) {
          assert.equal(JSON.stringify(detail.body).includes('"' + field + '":'), false, field);
        }
        assert.deepEqual(await f.snapshot(visible), before);
      } finally {
        await f.raw.whatsAppChannelConfig.update({ where: { id: original.id }, data: { enabled: original.enabled, status: original.status } });
      }
    });

    await t.test('real history pages preserve same-time message order with no duplicate or missing row', async () => {
      const value = await f.makeCase(f.ownerAuth, 'availability-history');
      const createdAt = new Date('2026-11-18T12:00:00.000Z');
      await f.raw.supportTicketMessage.createMany({ data: ['c', 'a', 'b'].map(label => ({
        id: 't58-history-' + label + '-' + randomUUID(), ticketId: value.ticket.id,
        senderType: 'buyer', content: 'Synthetic history ' + label, createdAt,
      })) });
      const stored = await f.raw.supportTicketMessage.findMany({ where: { ticketId: value.ticket.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const seen = [];
      let cursor;
      for (let index = 0; index < Math.ceil(stored.length / 2); index += 1) {
        const page = await get('/' + value.ticket.id + '?limit=2' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        assert.equal(page.status, 200);
        assert.equal(page.body.messages.length, Math.min(2, stored.length - seen.length));
        seen.push(...page.body.messages.map(row => row.id));
        assert.equal(page.body.has_more, seen.length < stored.length);
        cursor = page.body.next_cursor;
        assert.equal(typeof cursor === 'string', seen.length < stored.length);
        if (seen.length === stored.length) assert.equal(cursor, null);
      }
      assert.deepEqual(seen, stored.map(row => row.id));
      assert.equal(new Set(seen).size, stored.length);
      const before = await f.snapshot(value);
      for (const query of ['limit=0', 'limit=201', 'cursor=invalid', 'cursor=', 'status=open']) {
        assert.equal((await get('/' + value.ticket.id + '?' + query)).status, 400);
      }
      assert.deepEqual(await f.snapshot(value), before);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
    assert.equal(f.runtime.evidence().authOverrides, false);
    assert.equal(f.runtime.evidence().repositoryOverrides, false);
  } finally { await f.close(); }
});
