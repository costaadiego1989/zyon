import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createWhatsAppOperatorHttpFixture } from './whatsapp-operator-http-fixture.mjs';
import { SERVICE_LOCAL_TEST_MS } from './service-test-startup.mjs';

test('T58 dedicated message route cannot mutate ordinary support or aliases', { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createWhatsAppOperatorHttpFixture();
  try {
    const whatsapp = await f.makeCase(f.ownerAuth, 'source-whatsapp');
    const widget = await f.makeCase(f.ownerAuth, 'source-widget', { source: 'widget' });
    const alias = await f.makeCase(f.ownerAuth, 'source-widget-alias', { source: 'widget', mergedIntoId: whatsapp.ticket.id });
    const endpoint = value => '/support/whatsapp/conversations/' + value.ticket.id + '/messages';
    await t.test('same-tenant widget and alias calls reject without any original-case mutation', async () => {
      for (const value of [widget, alias]) {
        const before = await f.snapshot(value);
        const original = await f.snapshot(whatsapp);
        const deliveries = await f.raw.whatsAppDelivery.count({ where: { merchantId: f.ownerAuth.merchant_id } });
        const response = await f.request(endpoint(value), { content: 'Must not persist through WhatsApp route', clientMessageId: 't58_source_' + randomUUID() }, f.ownerAuth);
        assert.equal(response.status, 404);
        assert.deepEqual(await f.snapshot(value), before);
        assert.deepEqual(await f.snapshot(whatsapp), original);
        assert.equal(await f.raw.whatsAppDelivery.count({ where: { merchantId: f.ownerAuth.merchant_id } }), deliveries);
      }
    });
    await t.test('the original generic support endpoint retains normal widget replies', async () => {
      const clientMessageId = 't58_generic_' + randomUUID();
      const response = await f.request('/support/tickets/' + widget.ticket.id + '/messages', { content: 'Normal widget reply', clientMessageId }, f.ownerAuth);
      assert.equal(response.status, 201);
      assert.equal(response.body.ticketId, widget.ticket.id);
      assert.equal(response.body.content, 'Normal widget reply');
      const message = await f.raw.supportTicketMessage.findUniqueOrThrow({ where: { id: response.body.id } });
      assert.equal(message.ticketId, widget.ticket.id);
      assert.equal(message.clientMessageId, clientMessageId);
      assert.equal(message.content, 'Normal widget reply');
      assert.equal(message.senderType, 'merchant');
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
    assert.equal(f.runtime.evidence().authOverrides, false);
    assert.equal(f.runtime.evidence().repositoryOverrides, false);
  } finally { await f.close(); }
});
