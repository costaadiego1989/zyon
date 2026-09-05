import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { PrismaMarketplaceSettlementRepository } from "./prisma-marketplace-settlement.repository.js";

const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
describe("Marketplace settlement tenant filters and conditional updates (PostgreSQL)", { skip: !clientPath || !databaseUrl }, () => {
  const hostMerchantId = `audit_finance_${randomUUID()}`;
  const sellerMerchantId = `audit_finance_${randomUUID()}`;
  let prisma: any;
  let repository: PrismaMarketplaceSettlementRepository;
  before(async () => {
    const { PrismaClient } = createRequire(import.meta.url)(clientPath!);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    repository = new PrismaMarketplaceSettlementRepository(prisma);
  });
  after(async () => {
    if (!prisma) return;
    await prisma.marketplaceSettlement.deleteMany({ where: { hostMerchantId } });
    await prisma.$disconnect();
  });
  const createSettlement = () => repository.create({
    hostMerchantId, sellerMerchantId, orderId: randomUUID(), lineItemId: randomUUID(),
    totalAmountCents: 2000, commissionCents: 300, sellerNetCents: 1700,
    returnWindowUntil: new Date("2026-09-01"), transferScheduledAt: new Date("2026-09-04"),
    chargebackWindowUntil: new Date("2026-09-15"),
  });

  it("returns an owned settlement only for its host or seller", async () => {
    const settlement = await createSettlement();
    assert.equal(await repository.getByIdForMerchant(settlement.id, "foreign-merchant"), undefined);
    assert.equal(await repository.getByIdForMerchant(settlement.id, ""), undefined);
    for (const owner of [hostMerchantId, sellerMerchantId]) {
      assert.equal((await repository.getByIdForMerchant(settlement.id, owner))?.id, settlement.id);
    }
    assert.equal(settlement.transferScheduledAt?.toISOString(), "2026-09-04T00:00:00.000Z");
  });

  it("permits only one conditional transition when workers race", async () => {
    const settlement = await createSettlement();
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => repository.updateStatus({
      settlementId: settlement.id, expectedStatus: "awaiting_return_window", status: "transfer_scheduled",
    })));
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await repository.getById(settlement.id))?.status, "transfer_scheduled");
  });

  it("does not automatically finalize a legacy transfer without a provider reference", async () => {
    const unverified = await createSettlement();
    const referenced = await createSettlement();
    for (const row of [unverified, referenced]) {
      await prisma.marketplaceSettlement.update({ where: { id: row.id }, data: {
        status: "transferred", providerTransferId: row.id === referenced.id ? "fixture-reference" : null,
      } });
    }
    const candidates = await repository.findExpiredChargebackWindows(new Date("2026-09-16"));
    assert.equal(candidates.some((row) => row.id === unverified.id), false);
    assert.equal(candidates.some((row) => row.id === referenced.id), true);
  });
});
