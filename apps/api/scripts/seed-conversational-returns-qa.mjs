import { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PasswordHasher } from '../dist/modules/auth/domain/services/password-hasher.service.js';

// Explicit, opt-in test data. Never runs against a production environment or
// an existing customer store. No PSP, notification or authentication bypass.
if (process.env.RAILWAY_ENVIRONMENT_ID !== 'a347216c-86e3-4a75-8d73-5ae6e122408c') throw new Error('returns_qa_requires_sandbox');
const merchantId = process.env.RETURNS_QA_SEED_MERCHANT_ID;
if (!merchantId || !/^mrc_[a-f0-9-]+$/.test(merchantId) || !process.env.AACP_PII_ENC_KEY) throw new Error('returns_qa_target_required');
const db = new PrismaClient();
try {
  const owner = await db.merchantUser.findFirst({ where: { merchantId, role: 'owner' } });
  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  if (!owner || !/^returns-qa-[a-f0-9]+@example\.test$/.test(owner.email) || !merchant.name.startsWith('QA Pos-venda ')) throw new Error('returns_qa_only_disposable_test_store');
  const buyerId = `buyer_returns_qa_${merchantId}`;
  const email = `buyer-returns-${merchantId}@example.test`;
  const password = createHmac('sha256', process.env.AACP_PII_ENC_KEY).update(`returns-qa-buyer:${merchantId}`).digest('base64url') + 'aA1!';
  const passwordHash = await new PasswordHasher().hash(password);
  const sessionId = `session_returns_qa_${merchantId}`, orderId = `pedido-teste-29-${merchantId.slice(-8)}`;
  const items = [{ variantId: 'item_creme_qa', name: 'Creme reparador', quantity: 2, unitPriceCents: 1000 }, { variantId: 'item_bruma_qa', name: 'Bruma hidratante', quantity: 1, unitPriceCents: 900 }];
  await db.$transaction(async tx => {
    await tx.buyerAccount.upsert({ where: { globalUserId: buyerId }, create: { globalUserId: buyerId, email, passwordHash, displayName: 'Cliente de Teste' }, update: {} });
    if (await tx.completedOrder.findFirst({ where: { merchantId, externalOrderId: orderId } })) return;
    await tx.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: buyerId, conversationId: sessionId, cart: { items }, createdAt: new Date(), updatedAt: new Date() } });
    await tx.buyerPurchaseRecord.create({ data: { merchantId, globalUserId: buyerId, orderId, currency: 'BRL', totalAmount: 29, discountAmount: 0, completedAt: new Date(), items } });
    await tx.completedOrder.create({ data: { merchantId, sessionId, externalOrderId: orderId, orderTotal: 29, currency: 'BRL', lineItemsJson: items, completedAt: new Date() } });
    // Unsupported fixture provider deliberately blocks every automatic refund.
    await tx.paymentIntent.create({ data: { id: `pay_returns_qa_${merchantId}`, merchantId, sessionId, idempotencyKey: sessionId, amountCents: 2900, currency: 'BRL', method: 'card', status: 'approved', providerPaymentId: 'qa_fixture_do_not_refund', creation: { input: { provider: 'qa_fixture' } } } });
  });
  console.log(JSON.stringify({ returnsQaFixture: true, merchantId, slug: merchant.storeSlug, orderId, simulatedPayment: true, automaticRefundBlocked: true }));
} finally { await db.$disconnect(); }
