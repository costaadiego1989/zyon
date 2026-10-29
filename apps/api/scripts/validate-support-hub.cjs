// Run through Railway SSH from /repo/apps/api. Creates only isolated QA tenants,
// calls the deployed services, reads committed rows, then removes its fixtures.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const load = p => import(pathToFileURL(resolve('dist', p)).href);
(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { SupportHandoffService } = await load('modules/support/application/support-handoff.service.js');
  const { PrismaSupportTicketRepository } = await load('modules/support/infrastructure/prisma-support-ticket.repository.js');
  const { ListSupportTicketsUseCase } = await load('modules/support/application/list-support-tickets.use-case.js');
  const { SendTicketMessageUseCase } = await load('modules/support/application/send-ticket-message.use-case.js');
  const { ReturnCaseService } = await load('modules/returns/application/return-case.service.js');
  const db = new PrismaClient();
  const suffix = randomUUID(); const merchantId = `qa_support_${suffix}`, otherMerchant = `qa_other_${suffix}`;
  const buyerId = `qa_buyer_${suffix}`, sessionId = `qa_conversation_${suffix}`;
  const checks = [];
  try {
    const repo = new PrismaSupportTicketRepository(db);
    let published = 0;
    // No external webhook, email or WhatsApp sender is constructed in this probe.
    const handoff = new SupportHandoffService(repo, { publishCreated: () => { published++; } }, db);
    const cases = new ReturnCaseService(db, {}, { urls: () => [] }, {}, {}, {});
    const send = new SendTicketMessageUseCase(db);
    const args = { merchantId, sessionId, buyerMessage: 'QA: customer requests human support', initialMessage: 'QA: falar com humano' };
    const openings = await Promise.all(Array.from({ length: 4 }, () => handoff.createHandoff(args)));
    const ticketId = openings[0].ticketId;
    assert.equal(new Set(openings.map(r => r.ticketId)).size, 1);
    assert.equal(published, 1);
    assert.equal(await db.supportTicketMessage.count({ where: { ticketId } }), 1);
    assert.ok((await new ListSupportTicketsUseCase(repo).execute(merchantId)).data.some(t => t.id === ticketId));
    assert.equal((await new ListSupportTicketsUseCase(repo).execute(otherMerchant)).data.length, 0);
    checks.push('concurrent_handoff_single_persisted_ticket', 'merchant_dashboard_list', 'initial_buyer_message');
    await assert.rejects(cases.buyerTicket(buyerId, ticketId), /ticket_not_found/);
    assert.equal((await handoff.linkBuyerConversation(otherMerchant, sessionId, buyerId)).linked, 0);
    assert.equal((await handoff.linkBuyerConversation(merchantId, 'foreign_conversation', buyerId)).linked, 0);
    await handoff.linkBuyerConversation(merchantId, sessionId, buyerId);
    assert.equal((await cases.buyerTicket(buyerId, ticketId, merchantId)).id, ticketId);
    await handoff.linkBuyerConversation(merchantId, sessionId, 'another_buyer');
    await assert.rejects(cases.buyerTicket('another_buyer', ticketId), /ticket_not_found/);
    await assert.rejects(cases.buyerTicket(buyerId, ticketId, otherMerchant), /ticket_not_found/);
    checks.push('guest_claim_ownership_and_tenant_isolation');
    const key = randomUUID();
    const replies = await Promise.all(Array.from({ length: 3 }, () => send.execute({ merchantId, ticketId, senderType: 'merchant', content: 'QA: posso ajudar a encontrar seu produto.', clientMessageId: key })));
    assert.equal(new Set(replies.map(r => r.id)).size, 1);
    let inbox = await cases.list(buyerId, merchantId);
    assert.equal(inbox.items.filter(t => t.unreadCount > 0).length, 1);
    let detail = await cases.detail(merchantId, ticketId);
    assert.ok(detail.messages.some(m => m.id === replies[0].id));
    assert.equal((await cases.list('another_buyer', merchantId)).items.length, 0);
    const viewed = detail.messages.at(-1).id;
    const later = await send.execute({ merchantId, ticketId, senderType: 'merchant', content: 'QA: nova resposta depois da leitura.', clientMessageId: randomUUID() });
    await cases.markRead(merchantId, ticketId, 'buyer', viewed);
    assert.equal((await cases.detail(merchantId, ticketId)).unreadCount, 1);
    await cases.markRead(merchantId, ticketId, 'buyer', later.id);
    assert.equal((await cases.detail(merchantId, ticketId)).unreadCount, 0);
    checks.push('merchant_reply_persisted_in_buyer_hub', 'one_unread_conversation', 'concurrent_reply_stays_unread', 'read_ack_clears_counter');
    const buyerKey = randomUUID();
    const buyerReplies = await Promise.all(Array.from({ length: 3 }, () => cases.sendMessage(merchantId, ticketId, buyerId, 'QA: obrigado, recebi a resposta.', buyerKey)));
    assert.equal(new Set(buyerReplies.map(r => r.id)).size, 1);
    assert.ok((await cases.detail(merchantId, ticketId)).messages.some(m => m.id === buyerReplies[0].id));
    checks.push('buyer_reply_persisted_once');
    // Historical duplicate messages remain available through the canonical case.
    const aliasId = `sup_qa_alias_${suffix}`;
    await db.supportTicket.create({ data: { id: aliasId, merchantId, sessionId, buyerMessage: 'QA legacy duplicate', source: 'widget', status: 'open', createdAt: new Date(), updatedAt: new Date() } });
    await db.supportTicketMessage.create({ data: { ticketId: aliasId, senderType: 'merchant', content: 'QA preserved legacy reply' } });
    await handoff.linkBuyerConversation(merchantId, sessionId, buyerId);
    assert.equal((await db.supportTicket.findUnique({ where: { id: aliasId } })).mergedIntoId, ticketId);
    detail = await cases.detail(merchantId, ticketId);
    assert.ok(detail.messages.some(m => m.content === 'QA preserved legacy reply'));
    assert.equal((await cases.list(buyerId, merchantId)).items.length, 1);
    assert.equal((await new ListSupportTicketsUseCase(repo).execute(merchantId)).data.length, 1);
    checks.push('legacy_duplicates_merge_without_message_loss');
  } finally {
    await db.supportTicket.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchant] } } });
    await db.outboxMessage.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchant] }, producer: 'support' } });
    assert.equal(await db.supportTicket.count({ where: { merchantId } }), 0);
    assert.equal(await db.outboxMessage.count({ where: { merchantId, producer: 'support' } }), 0);
    await db.$disconnect();
  }
  console.log('ZYON_SUPPORT_HUB_VALIDATION=' + JSON.stringify({ checks, passed: checks.length, fixtureCleanup: true, externalMessages: 0 }));
})().catch(error => { console.error(error.name + ': ' + error.message.slice(0, 500)); process.exitCode = 1; });
