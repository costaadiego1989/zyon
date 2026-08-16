import type { Prisma, PrismaClient } from "@prisma/client";
import type { CheckoutSettings } from "@zyon/shared-types";
import type { CheckoutSettingsRepository } from "../domain/ports/checkout-settings-repository.port.js";
import { OptimisticConcurrencyError } from "../../../shared/http/http-contract.errors.js";

export class PrismaCheckoutSettingsRepository implements CheckoutSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(merchantId: string): Promise<CheckoutSettings | undefined> {
    const row = await this.prisma.checkoutSetting.findUnique({ where: { merchantId } });
    return row ? toCheckoutSettings(row) : undefined;
  }

  async save(
    settings: CheckoutSettings,
    expectedUpdatedAt?: string,
  ): Promise<CheckoutSettings> {
    if (expectedUpdatedAt) {
      const result = await this.prisma.checkoutSetting.updateMany({
        where: {
          merchantId: settings.merchantId,
          updatedAt: new Date(expectedUpdatedAt),
        },
        data: toUpdate(settings),
      });
      if (result.count !== 1) {
        throw new OptimisticConcurrencyError();
      }
      const updated = await this.prisma.checkoutSetting.findUniqueOrThrow({
        where: { merchantId: settings.merchantId },
      });
      return toCheckoutSettings(updated);
    }

    const row = await this.prisma.checkoutSetting.upsert({
      where: { merchantId: settings.merchantId },
      create: toCreate(settings),
      update: toUpdate(settings)
    });
    return toCheckoutSettings(row);
  }

  async delete(merchantId: string): Promise<void> {
    await this.prisma.checkoutSetting.deleteMany({ where: { merchantId } });
  }
}

function toCreate(settings: CheckoutSettings) {
  return {
    merchantId: settings.merchantId,
    createdAt: new Date(settings.createdAt),
    ...toUpdate(settings)
  };
}

function toUpdate(settings: CheckoutSettings) {
  return {
    mode: settings.mode,
    widgetBehavior: settings.widgetBehavior as unknown as Prisma.InputJsonValue,
    interventionPolicy: settings.interventionPolicy as unknown as Prisma.InputJsonValue,
    triggerRules: settings.triggerRules as unknown as Prisma.InputJsonValue,
    suppressionRules: settings.suppressionRules as unknown as Prisma.InputJsonValue,
    handoff: settings.handoff as unknown as Prisma.InputJsonValue,
    advancedRules: settings.advancedRules as unknown as Prisma.InputJsonValue,
    updatedAt: new Date(settings.updatedAt)
  };
}

function toCheckoutSettings(row: {
  merchantId: string;
  mode: string;
  widgetBehavior: unknown;
  interventionPolicy: unknown;
  triggerRules: unknown;
  suppressionRules: unknown;
  handoff: unknown;
  advancedRules: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CheckoutSettings {
  return {
    merchantId: row.merchantId,
    mode: row.mode as CheckoutSettings["mode"],
    widgetBehavior: row.widgetBehavior as CheckoutSettings["widgetBehavior"],
    interventionPolicy: row.interventionPolicy as CheckoutSettings["interventionPolicy"],
    triggerRules: row.triggerRules as CheckoutSettings["triggerRules"],
    suppressionRules: row.suppressionRules as CheckoutSettings["suppressionRules"],
    handoff: row.handoff as CheckoutSettings["handoff"],
    advancedRules: (row.advancedRules as CheckoutSettings["advancedRules"]) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
