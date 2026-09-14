import { findMerchantAgentRule } from "../../agent-rules/infrastructure/find-merchant-agent-rule.js";
import { Inject, Injectable , Logger} from "@nestjs/common";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

const PLANS_WITH_STORE = new Set(["BOTH", "STORE_ONLY"]);

@Injectable()
export class GetMerchantThemeUseCase {
  private readonly logger = new Logger(GetMerchantThemeUseCase.name);

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly repo: MerchantRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(merchantId: string): Promise<MerchantTheme & { agentGreeting?: string }> {
    const profile = await this.repo.getProfile(merchantId);
    const theme = (profile?.theme ?? {}) as Record<string, unknown>;

    let merged: MerchantTheme;
    if (profile?.plan && PLANS_WITH_STORE.has(profile.plan)) {
      const storeStyles = profile.storeSettings?.styles ?? {};
      merged = { ...DEFAULT_MERCHANT_THEME, ...storeStyles, ...theme } as MerchantTheme;
    } else {
      merged = { ...DEFAULT_MERCHANT_THEME, ...theme } as MerchantTheme;
    }

    const rule = await findMerchantAgentRule(this.prisma, merchantId);
    const identity = rule?.identity as { agentName?: string; greeting?: string } | null;
    return {
      ...merged,
      ...(identity?.agentName ? { agentName: identity.agentName } : {}),
      ...(identity?.greeting !== undefined ? { agentGreeting: identity.greeting } : {}),
    };
  }
}
