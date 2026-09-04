import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CheckoutSettingsContext } from "@zyon/shared-types";
import { GetCheckoutSettingsContextUseCase } from "../../../checkout-settings/application/checkout-settings.use-cases.js";
import type { CheckoutSettingsPort, InterventionPolicy } from "../../domain/ports/checkout-settings.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

@Injectable()
export class CheckoutSettingsAdapter implements CheckoutSettingsPort {
  constructor(
    private readonly getCheckoutSettingsContext: GetCheckoutSettingsContextUseCase,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient
  ) {}

  getContext(merchantId: string): Promise<CheckoutSettingsContext | undefined> {
    return this.getCheckoutSettingsContext.execute(merchantId);
  }

  async getInterventionConfig(
    merchantId: string
  ): Promise<{ advancedRules: unknown[] | null; interventionPolicy: InterventionPolicy | null }> {
    if (!this.prisma) {
      return { advancedRules: null, interventionPolicy: null };
    }

    const setting = await this.prisma.checkoutSetting.findUnique({
      where: { merchantId },
      select: { advancedRules: true, interventionPolicy: true },
    });

    return {
      advancedRules: (Array.isArray(setting?.advancedRules) ? setting.advancedRules : null) ?? null,
      interventionPolicy: (setting?.interventionPolicy as InterventionPolicy | null) ?? null,
    };
  }
}
