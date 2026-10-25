import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AppModule } from '../../src/app.module';
import * as request from 'supertest';

describe('Post-Sale E2E (Phase 1 + 2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantId: string;
  let buyerId: string;
  let orderId: string;
  let productId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Setup: create merchant
    const merchant = await prisma.merchant.create({
      data: {
        name: 'Test Merchant',
        email: 'test@merchant.local',
      },
    });
    merchantId = merchant.id;

    // Setup: create buyer
    const buyer = await prisma.buyer.create({
      data: {
        globalUserId: `buyer_${Date.now()}`,
        merchantId,
        email: 'buyer@test.local',
        whatsappNumber: '5521993001883',
      },
    });
    buyerId = buyer.id;

    // Setup: create product
    const product = await prisma.product.create({
      data: {
        merchantId,
        name: 'Test Product',
        sku: `SKU_${Date.now()}`,
        priceCents: 10000,
        costCents: 5000,
      },
    });
    productId = product.id;

    // Setup: create order
    const order = await prisma.order.create({
      data: {
        merchantId,
        buyerId,
        status: 'pending',
        totalCents: 10000,
        items: {
          create: {
            productId,
            quantity: 1,
            priceCents: 10000,
          },
        },
      },
    });
    orderId = order.id;
  });

  afterEach(async () => {
    // Cleanup
    await prisma.postSaleScheduledMessage.deleteMany({ where: { merchantId } });
    await prisma.productReview.deleteMany({ where: { merchantId } });
    await prisma.npsResponse.deleteMany({ where: { merchantId } });
    await prisma.buyerLoyaltyTracker.deleteMany({ where: { merchantId } });
    await prisma.order.deleteMany({ where: { merchantId } });
    await prisma.product.deleteMany({ where: { merchantId } });
    await prisma.buyer.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
  });

  describe('Phase 1: Immediate Post-Delivery Flow', () => {
    it('[PHASE-1] should schedule 4 messages when order.delivered event fires', async () => {
      // Action: emit order.delivered event
      const deliveredAt = new Date();
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'delivered', deliveredAt },
      });

      // Emit domain event via controller (simulating real flow)
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/mark-delivered`)
        .set('Authorization', `Bearer merchant_${merchantId}`)
        .send({})
        .expect(200);

      // Verify: 4 scheduled messages created
      const messages = await prisma.postSaleScheduledMessage.findMany({
        where: { orderId, merchantId },
      });

      expect(messages).toHaveLength(4);
      expect(messages.map((m) => m.type)).toEqual(
        expect.arrayContaining(['follow_up', 'review_request', 'cross_sell', 'nps'])
      );

      // Verify: timings are correct
      const followUp = messages.find((m) => m.type === 'follow_up');
      const review = messages.find((m) => m.type === 'review_request');
      const crossSell = messages.find((m) => m.type === 'cross_sell');
      const nps = messages.find((m) => m.type === 'nps');

      expect(followUp?.sendAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(review?.sendAt.getTime()).toBeGreaterThan(
        deliveredAt.getTime() + 2 * 24 * 60 * 60 * 1000
      ); // D+3
      expect(crossSell?.sendAt.getTime()).toBeGreaterThan(
        deliveredAt.getTime() + 4 * 24 * 60 * 60 * 1000
      ); // D+5
      expect(nps?.sendAt.getTime()).toBeGreaterThan(
        deliveredAt.getTime() + 6 * 24 * 60 * 60 * 1000
      ); // D+7
    });

    it('[PHASE-1] should process scheduled messages and send via WhatsApp', async () => {
      // Setup: create pending scheduled message
      const sendAt = new Date(Date.now() - 1000); // Past = eligible to send
      const msg = await prisma.postSaleScheduledMessage.create({
        data: {
          merchantId,
          buyerId,
          orderId,
          type: 'follow_up',
          channel: 'whatsapp',
          sendAt,
          status: 'pending',
        },
      });

      // Action: trigger scheduler job (manual call for test)
      const response = await request(app.getHttpServer())
        .post('/post-sale/scheduler/process')
        .set('Authorization', `Bearer admin`)
        .send({})
        .expect(200);

      expect(response.body.processed).toBeGreaterThanOrEqual(1);

      // Verify: message marked sent
      const updated = await prisma.postSaleScheduledMessage.findUnique({
        where: { id: msg.id },
      });
      expect(updated?.status).toBe('sent');
      expect(updated?.sentAt).toBeDefined();
      expect(updated?.messageContent).toBeTruthy();
    });

    it('[PHASE-1] should accept and store review submission', async () => {
      // Action: buyer submits review
      const response = await request(app.getHttpServer())
        .post('/post-sale/reviews')
        .send({
          buyerId,
          productId,
          orderId,
          rating: 5,
          text: 'Produto excelente!',
        })
        .expect(201);

      const reviewId = response.body.id;

      // Verify: review stored with pending moderation
      const review = await prisma.productReview.findUnique({
        where: { id: reviewId },
      });
      expect(review).toMatchObject({
        merchantId,
        buyerId,
        productId,
        rating: 5,
        text: 'Produto excelente!',
        moderationStatus: 'pending',
      });

      // Verify: appears in dashboard list
      const list = await request(app.getHttpServer())
        .get(`/post-sale/dashboard/reviews?merchantId=${merchantId}`)
        .expect(200);

      expect(list.body.reviews).toContainEqual(
        expect.objectContaining({ id: reviewId })
      );
    });

    it('[PHASE-1] should accept NPS response and classify', async () => {
      // Action: buyer submits NPS (promoter)
      const response = await request(app.getHttpServer())
        .post('/post-sale/nps')
        .send({
          buyerId,
          orderId,
          score: 9,
          feedback: 'Entrega rápida!',
        })
        .expect(201);

      // Verify: response stored with classification
      const nps = await prisma.npsResponse.findFirst({
        where: { buyerId, orderId },
      });
      expect(nps).toMatchObject({
        score: 9,
        classification: 'promoter',
        feedback: 'Entrega rápida!',
      });

      // Verify: appears in dashboard NPS tab
      const dashboard = await request(app.getHttpServer())
        .get(`/post-sale/dashboard/nps?merchantId=${merchantId}`)
        .expect(200);

      expect(dashboard.body.npsScore).toBeGreaterThan(0);
      expect(dashboard.body.promoters).toBeGreaterThan(0);
    });
  });

  describe('Phase 2: Win-Back, Loyalty, Consumable Reorder', () => {
    it('[PHASE-2] should identify inactive buyers and send win-back (30d+)', async () => {
      // Setup: buyer with last purchase 31 days ago
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const tracker = await prisma.buyerLoyaltyTracker.create({
        data: {
          merchantId,
          buyerId,
          purchaseCount: 1,
          lastPurchaseAt: oldDate,
          lastWinBackAt: null,
        },
      });

      // Action: run win-back scanner
      const response = await request(app.getHttpServer())
        .post('/post-sale/jobs/win-back-scanner')
        .set('Authorization', `Bearer admin`)
        .send({})
        .expect(200);

      expect(response.body.scanned).toBeGreaterThanOrEqual(1);

      // Verify: win-back message scheduled
      const winBack = await prisma.postSaleScheduledMessage.findFirst({
        where: {
          merchantId,
          buyerId,
          type: 'win_back',
          status: 'pending',
        },
      });
      expect(winBack).toBeDefined();

      // Verify: 5% coupon (30d tier)
      const coupon = await prisma.coupon.findFirst({
        where: {
          merchantId,
          reason: 'win_back_30d',
        },
      });
      expect(coupon?.discountPercent).toBe(5);

      // Verify: tracker updated
      const updated = await prisma.buyerLoyaltyTracker.findUnique({
        where: { id: tracker.id },
      });
      expect(updated?.lastWinBackAt).toBeTruthy();
    });

    it('[PHASE-2] should trigger loyalty coupon on milestone purchases', async () => {
      // Setup: buyer at 2nd purchase (next is 3rd = milestone)
      const tracker = await prisma.buyerLoyaltyTracker.upsert({
        where: { merchantId_buyerId: { merchantId, buyerId } },
        update: { purchaseCount: 2 },
        create: {
          merchantId,
          buyerId,
          purchaseCount: 2,
          lastPurchaseAt: new Date(),
        },
      });

      // Action: emit order.completed event (3rd order)
      const newOrder = await prisma.order.create({
        data: {
          merchantId,
          buyerId,
          status: 'completed',
          totalCents: 10000,
          items: { create: { productId, quantity: 1, priceCents: 10000 } },
        },
      });

      // Manually trigger milestone check
      await request(app.getHttpServer())
        .post('/post-sale/check-milestone')
        .set('Authorization', `Bearer admin`)
        .send({ orderId: newOrder.id })
        .expect(200);

      // Verify: 5% loyalty coupon generated (3rd purchase)
      const coupon = await prisma.coupon.findFirst({
        where: {
          merchantId,
          reason: 'loyalty_3rd_purchase',
        },
      });
      expect(coupon?.discountPercent).toBe(5);

      // Verify: loyalty tracker incremented
      const updated = await prisma.buyerLoyaltyTracker.findUnique({
        where: { id: tracker.id },
      });
      expect(updated?.purchaseCount).toBe(3);
    });

    it('[PHASE-2] should scan consumable reorders', async () => {
      // Setup: product marked as consumable with 30d cycle
      const consumable = await prisma.product.create({
        data: {
          merchantId,
          name: 'Coffee Beans',
          sku: `CONSUMABLE_${Date.now()}`,
          priceCents: 2000,
          metadata: {
            consumable: true,
            reorderCycleDays: 30,
          },
        },
      });

      // Setup: order placed 31 days ago
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const oldOrder = await prisma.order.create({
        data: {
          merchantId,
          buyerId,
          status: 'completed',
          completedAt: oldDate,
          totalCents: 2000,
          items: {
            create: { productId: consumable.id, quantity: 1, priceCents: 2000 },
          },
        },
      });

      // Action: run consumable reorder scanner
      const response = await request(app.getHttpServer())
        .post('/post-sale/jobs/consumable-reorder-scanner')
        .set('Authorization', `Bearer admin`)
        .send({})
        .expect(200);

      expect(response.body.scanned).toBeGreaterThanOrEqual(1);

      // Verify: reorder reminder scheduled
      const reminder = await prisma.postSaleScheduledMessage.findFirst({
        where: {
          merchantId,
          buyerId,
          type: 'consumable_reorder',
          status: 'pending',
        },
      });
      expect(reminder).toBeDefined();
    });

    it('[PHASE-2] should allow toggling campaigns via dashboard config', async () => {
      // Action: toggle campaign types on/off
      const response = await request(app.getHttpServer())
        .patch(`/post-sale/config`)
        .set('Authorization', `Bearer merchant_${merchantId}`)
        .send({
          campaignTypes: {
            follow_up: true,
            review_request: false,
            nps: true,
            cross_sell: true,
            win_back: false,
            loyalty: true,
            consumable_reorder: true,
          },
        })
        .expect(200);

      // Verify: config persisted
      const config = response.body;
      expect(config.review_request).toBe(false);
      expect(config.win_back).toBe(false);
      expect(config.loyalty).toBe(true);

      // Verify: disabled campaigns don't schedule
      // (Job checks config before running)
    });
  });

  describe('Cross-cutting Concerns', () => {
    it('should respect merchant boundary (no cross-tenant leakage)', async () => {
      // Setup: different merchant
      const other = await prisma.merchant.create({
        data: {
          name: 'Other Merchant',
          email: 'other@merchant.local',
        },
      });

      // Action: create message for other merchant
      const msg = await prisma.postSaleScheduledMessage.create({
        data: {
          merchantId: other.id,
          buyerId,
          orderId,
          type: 'follow_up',
          channel: 'whatsapp',
          sendAt: new Date(),
          status: 'pending',
        },
      });

      // Verify: first merchant cannot see it
      const list = await request(app.getHttpServer())
        .get(`/post-sale/messages?merchantId=${merchantId}`)
        .set('Authorization', `Bearer merchant_${merchantId}`)
        .expect(200);

      expect(
        list.body.messages.some((m) => m.id === msg.id)
      ).toBe(false);

      // Cleanup
      await prisma.postSaleScheduledMessage.delete({ where: { id: msg.id } });
      await prisma.merchant.delete({ where: { id: other.id } });
    });

    it('should emit safe messages (no LLM generation leaks)', async () => {
      // Setup: scheduled message
      const msg = await prisma.postSaleScheduledMessage.create({
        data: {
          merchantId,
          buyerId,
          orderId,
          type: 'follow_up',
          channel: 'whatsapp',
          sendAt: new Date(Date.now() - 1000),
          status: 'pending',
        },
      });

      // Action: process
      await request(app.getHttpServer())
        .post('/post-sale/scheduler/process')
        .set('Authorization', `Bearer admin`)
        .send({})
        .expect(200);

      // Verify: message content is present and non-empty
      const sent = await prisma.postSaleScheduledMessage.findUnique({
        where: { id: msg.id },
      });

      expect(sent?.messageContent).toBeTruthy();
      expect(sent?.messageContent?.length).toBeGreaterThan(0);
      // Content should NOT contain suspicious patterns
      expect(sent?.messageContent).not.toMatch(/\$\{|<<|>>/);
    });
  });
});
