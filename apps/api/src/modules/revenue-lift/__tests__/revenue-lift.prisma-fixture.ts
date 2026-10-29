import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { RevenueLiftRepository } from "../infrastructure/revenue-lift.repository.js";

/** Explicit disposable runner only. No AppModule, BullMQ, HTTP or provider. */
export async function revenueLiftPrismaFixture() {
  const prisma = createPrismaClient();
  const merchantId = `synthetic_lift_${randomUUID()}`, otherMerchantId = `synthetic_lift_${randomUUID()}`;
  const repo = new RevenueLiftRepository(prisma);
  const session = async (merchant: string, id: string, cohort: string, at: Date, aiCostCents = 5) => {
    return prisma.checkoutSession.create({ data: { merchantId: merchant, sessionId: id,
      globalUserId: "synthetic-buyer", conversationId: `synthetic-${id}`,
      cart: { currency: "BRL", items: [] }, cohort, aiCostCents, createdAt: at, updatedAt: at } });
  };
  const order = async (merchant: string, id: string, value: number, at: Date, status = "approved") => {
    return prisma.completedOrder.create({ data: { merchantId: merchant, sessionId: id,
      externalOrderId: `synthetic-order-${id}`, orderTotal: value, currency: "BRL", status, completedAt: at } });
  };
  const tag = (merchant: string, id: string) => ({ merchantId: merchant, orderId: `synthetic-order-${id}`,
    sessionId: id, globalUserId: "synthetic-buyer", cohort: "treatment" as const,
    negotiationApplied: false, crossSellApplied: true, progressiveDiscountApplied: false,
    cartRecoveryApplied: false, intentPersonalizationApplied: false, orderValueCents: 15000,
    discountGivenCents: 0, shippingSubsidyCents: 0, aiCostCents: 5 });
  const dispose = async () => {
    try {
      await prisma.attributionTag.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
      await prisma.completedOrder.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
      await prisma.checkoutSession.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
    } finally { await prisma.$disconnect(); }
  };
  return { prisma, repo, merchantId, otherMerchantId, session, order, tag, dispose };
}

