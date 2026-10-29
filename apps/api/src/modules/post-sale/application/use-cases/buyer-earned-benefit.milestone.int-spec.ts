import test from "node:test";
import assert from "node:assert/strict";
import { CheckLoyaltyMilestoneUseCase } from "./check-loyalty-milestone.use-case.js";
import type { ScheduledMessageRepositoryPort } from "../../domain/ports/scheduled-message-repository.port.js";
import { DEFAULT_POST_SALE_CONFIG, type PostSaleConfigService } from "../services/post-sale-config.service.js";

// Loyalty is opt-in; these specs assert the milestone logic itself, so the
// config stub enables it with the default milestones ("3,5,10").
const loyaltyEnabledConfig = {
  async getConfig() {
    return { ...DEFAULT_POST_SALE_CONFIG, loyaltyEnabled: true };
  },
} as unknown as PostSaleConfigService;

function makeDeps() {
  const created: Array<Record<string, unknown>> = [];
  const messages: ScheduledMessageRepositoryPort = {
    async create() {
      return {} as any;
    },
  } as unknown as ScheduledMessageRepositoryPort;

  const prisma = {
    coupon: {
      async create() {
        return {};
      },
    },
    buyerEarnedBenefit: {
      async create(args: { data: Record<string, unknown> }) {
        const row = {
          id: `beb_${created.length + 1}`,
          createdAt: new Date(),
          expiresAt: (args.data.expiresAt as Date) ?? null,
          value: args.data.value,
          ...args.data,
        };
        created.push(row);
        return row;
      },
    },
  } as any;

  return { created, messages, prisma };
}

test("check-loyalty-milestone: milestone hit records a loyalty_milestone earned benefit (ADI-F5-02)", async () => {
  const { created, messages, prisma } = makeDeps();
  const uc = new CheckLoyaltyMilestoneUseCase(messages, prisma, loyaltyEnabledConfig);

  const res = await uc.execute({
    merchantId: "m1",
    buyerId: "u1",
    globalUserId: "u1",
    purchaseCount: 5, // 10% milestone
  });

  assert.equal(res.milestoneHit, true);
  assert.equal(created.length, 1);
  const benefit = created[0];
  assert.equal(benefit.merchantId, "m1");
  assert.equal(benefit.globalUserId, "u1");
  assert.equal(benefit.origin, "loyalty_milestone");
  assert.equal(benefit.benefitType, "discount_percent");
  assert.equal(benefit.value, 10);
  assert.equal(benefit.status, "active");
});

test("check-loyalty-milestone: no milestone → no benefit recorded", async () => {
  const { created, messages, prisma } = makeDeps();
  const uc = new CheckLoyaltyMilestoneUseCase(messages, prisma, loyaltyEnabledConfig);

  const res = await uc.execute({
    merchantId: "m1",
    buyerId: "u1",
    purchaseCount: 4, // not a milestone
  });

  assert.equal(res.milestoneHit, false);
  assert.equal(created.length, 0);
});

test("check-loyalty-milestone: globalUserId falls back to buyerId when omitted", async () => {
  const { created, messages, prisma } = makeDeps();
  const uc = new CheckLoyaltyMilestoneUseCase(messages, prisma, loyaltyEnabledConfig);

  await uc.execute({ merchantId: "m1", buyerId: "buyer-42", purchaseCount: 3 });

  assert.equal(created.length, 1);
  assert.equal(created[0].globalUserId, "buyer-42");
  assert.equal(created[0].value, 5); // 3-purchase milestone = 5%
});
