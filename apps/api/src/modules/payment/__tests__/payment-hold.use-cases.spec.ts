import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// In-memory Prisma mock for PaymentHold
class InMemoryPaymentHoldStore {
  private holds: any[] = [];
  private idCounter = 0;

  get paymentHold() {
    return {
      create: async ({ data }: any) => {
        const hold = { id: `hold_${++this.idCounter}`, ...data, createdAt: new Date() };
        this.holds.push(hold);
        return hold;
      },
      findMany: async ({ where, take }: any) => {
        return this.holds
          .filter((h) => {
            if (where.status && h.status !== where.status) return false;
            if (where.holdUntil?.lte && h.holdUntil > where.holdUntil.lte) return false;
            return true;
          })
          .slice(0, take ?? 100);
      },
      findUnique: async ({ where }: any) => {
        if (where.paymentIntentId) return this.holds.find((h) => h.paymentIntentId === where.paymentIntentId) ?? null;
        return this.holds.find((h) => h.id === where.id) ?? null;
      },
      update: async ({ where, data }: any) => {
        const hold = this.holds.find((h) => h.id === where.id);
        if (hold) Object.assign(hold, data);
        return hold;
      },
    };
  }

  getAll() { return this.holds; }
}

// Inline use-case implementations (same logic as production)
function createHold(prisma: any, input: { merchantId: string; paymentIntentId: string; totalAmountCents: number; feePercent: number }) {
  const platformFeeCents = Math.round(input.totalAmountCents * input.feePercent / 100);
  const merchantNetCents = input.totalAmountCents - platformFeeCents;
  const holdUntil = new Date(Date.now() + 14 * 86_400_000);
  return prisma.paymentHold.create({
    data: {
      merchantId: input.merchantId,
      paymentIntentId: input.paymentIntentId,
      totalAmountCents: input.totalAmountCents,
      platformFeeCents,
      merchantNetCents,
      status: "held",
      holdUntil,
    },
  });
}

async function releaseHolds(prisma: any) {
  const now = new Date();
  const due = await prisma.paymentHold.findMany({ where: { status: "held", holdUntil: { lte: now } }, take: 100 });
  let released = 0;
  for (const h of due) {
    await prisma.paymentHold.update({ where: { id: h.id }, data: { status: "released", releasedAt: now } });
    released++;
  }
  return { released };
}

async function refundHold(prisma: any, paymentIntentId: string) {
  const hold = await prisma.paymentHold.findUnique({ where: { paymentIntentId } });
  if (!hold || hold.status !== "held") return;
  await prisma.paymentHold.update({ where: { id: hold.id }, data: { status: "refunded" } });
}

describe("PaymentHold Use Cases", () => {
  let store: InMemoryPaymentHoldStore;

  beforeEach(() => { store = new InMemoryPaymentHoldStore(); });

  describe("CreatePaymentHold", () => {
    it("calculates platform fee correctly (2.49%)", async () => {
      const hold = await createHold(store, { merchantId: "m1", paymentIntentId: "pi_1", totalAmountCents: 10000, feePercent: 2.49 });
      assert.equal(hold.platformFeeCents, 249);
      assert.equal(hold.merchantNetCents, 9751);
      assert.equal(hold.status, "held");
    });

    it("sets holdUntil to 14 days from now", async () => {
      const before = Date.now();
      const hold = await createHold(store, { merchantId: "m1", paymentIntentId: "pi_2", totalAmountCents: 5000, feePercent: 3 });
      const diff = hold.holdUntil.getTime() - before;
      const fourteenDaysMs = 14 * 86_400_000;
      assert.ok(diff >= fourteenDaysMs - 1000 && diff <= fourteenDaysMs + 1000);
    });

    it("rounds fee to nearest cent", async () => {
      const hold = await createHold(store, { merchantId: "m1", paymentIntentId: "pi_3", totalAmountCents: 333, feePercent: 2.49 });
      assert.equal(hold.platformFeeCents, 8); // 333 * 0.0249 = 8.29 → rounded to 8
      assert.equal(hold.merchantNetCents, 325);
    });
  });

  describe("ReleasePaymentHolds", () => {
    it("releases holds past holdUntil", async () => {
      await store.paymentHold.create({ data: { merchantId: "m1", paymentIntentId: "pi_old", totalAmountCents: 1000, platformFeeCents: 25, merchantNetCents: 975, status: "held", holdUntil: new Date(Date.now() - 1000) } });
      await store.paymentHold.create({ data: { merchantId: "m1", paymentIntentId: "pi_future", totalAmountCents: 2000, platformFeeCents: 50, merchantNetCents: 1950, status: "held", holdUntil: new Date(Date.now() + 86_400_000) } });

      const { released } = await releaseHolds(store);
      assert.equal(released, 1);

      const all = store.getAll();
      assert.equal(all.find((h: any) => h.paymentIntentId === "pi_old").status, "released");
      assert.equal(all.find((h: any) => h.paymentIntentId === "pi_future").status, "held");
    });

    it("does not release refunded holds", async () => {
      await store.paymentHold.create({ data: { merchantId: "m1", paymentIntentId: "pi_ref", totalAmountCents: 1000, platformFeeCents: 25, merchantNetCents: 975, status: "refunded", holdUntil: new Date(Date.now() - 1000) } });
      const { released } = await releaseHolds(store);
      assert.equal(released, 0);
    });
  });

  describe("RefundPaymentHold", () => {
    it("marks held payment as refunded", async () => {
      await store.paymentHold.create({ data: { merchantId: "m1", paymentIntentId: "pi_to_refund", totalAmountCents: 5000, platformFeeCents: 125, merchantNetCents: 4875, status: "held", holdUntil: new Date(Date.now() + 86_400_000) } });
      await refundHold(store, "pi_to_refund");
      const hold = await store.paymentHold.findUnique({ where: { paymentIntentId: "pi_to_refund" } });
      assert.equal(hold.status, "refunded");
    });

    it("does nothing if already released", async () => {
      await store.paymentHold.create({ data: { merchantId: "m1", paymentIntentId: "pi_released", totalAmountCents: 5000, platformFeeCents: 125, merchantNetCents: 4875, status: "released", holdUntil: new Date(Date.now() - 1000) } });
      await refundHold(store, "pi_released");
      const hold = await store.paymentHold.findUnique({ where: { paymentIntentId: "pi_released" } });
      assert.equal(hold.status, "released"); // unchanged
    });

    it("does nothing if payment not found", async () => {
      await refundHold(store, "pi_nonexistent"); // should not throw
    });
  });
});
