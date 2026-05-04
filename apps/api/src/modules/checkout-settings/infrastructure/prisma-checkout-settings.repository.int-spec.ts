import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutSettingsEntity } from "../domain/entities/checkout-settings.entity.js";
import { createPrismaClient } from "../../checkout/infrastructure/prisma/prisma-client.js";
import { PrismaCheckoutSettingsRepository } from "./prisma-checkout-settings.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaCheckoutSettingsRepository persists settings with tenant isolation",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const repository = new PrismaCheckoutSettingsRepository(prisma);
    const merchantId = `mrc_settings_${crypto.randomUUID()}`;
    const otherMerchantId = `mrc_settings_${crypto.randomUUID()}`;

    try {
      await repository.save(
        CheckoutSettingsEntity.createDefault({ merchantId }).update({ mode: "manual_only" }).snapshot()
      );
      await repository.save(CheckoutSettingsEntity.createDefault({ merchantId: otherMerchantId }).snapshot());

      const saved = await repository.get(merchantId);
      const other = await repository.get(otherMerchantId);

      assert.equal(saved?.mode, "manual_only");
      assert.equal(other?.mode, "silent_until_trigger");
      assert.equal(saved?.merchantId, merchantId);
    } finally {
      await prisma.checkoutSetting.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
      await prisma.$disconnect();
    }
  }
);
