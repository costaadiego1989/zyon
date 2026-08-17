import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

const PLANS_WITH_STORE = new Set(["BOTH", "STORE_ONLY"]);

@Injectable()
export class GetMerchantThemeUseCase {
  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly repo: MerchantRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(merchantId: string): Promise<MerchantTheme> {
    const profile = await this.repo.getProfile(merchantId);
    const theme = (profile?.theme ?? {}) as Record<string, unknown>;

    let merged: MerchantTheme;
    if (profile?.plan && PLANS_WITH_STORE.has(profile.plan)) {
      const storeStyles = profile.storeSettings?.styles ?? {};
      merged = { ...DEFAULT_MERCHANT_THEME, ...storeStyles, ...theme } as MerchantTheme;
    } else {
      merged = { ...DEFAULT_MERCHANT_THEME, ...theme } as MerchantTheme;
    }

    // Fill agentName from agent_rules if not in theme
    if (!merged.agentName) {
      const rule = await this.prisma.agentRule.findFirst({
        where: { merchantId },
        select: { identity: true },
      });
      const identity = rule?.identity as { agentName?: string } | null;
      if (identity?.agentName) {
        merged.agentName = identity.agentName;
      }
    }

    return merged;
  }
}
