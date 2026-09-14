import { findMerchantAgentRule } from "../../../agent-rules/infrastructure/find-merchant-agent-rule.js";
import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { isBillingFeatureEnabled } from "../../../payment/domain/billing-plans.js";
import type { StorefrontConfigQueryPort, StorefrontConfigSnapshot } from "../../domain/ports/storefront-config-query.port.js";

@Injectable()
export class PrismaStorefrontConfigQueryRepository implements StorefrontConfigQueryPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findPublicConfig(identifier: string): Promise<StorefrontConfigSnapshot | null> {
    let merchant = null;
    let resolvedSubscription: {
      status: string;
      trialEndsAt: Date | null;
      stripePriceId: string | null;
      planKey: string | null;
    } | null | undefined;
    if (identifier.includes(".")) {
      const domain = await this.prisma.merchantDomain.findUnique({
        where: { domain: identifier },
        select: { merchantId: true, verified: true },
      });
      if (domain?.verified) {
        resolvedSubscription = await this.prisma.merchantBillingSubscription.findUnique({
          where: { merchantId: domain.merchantId },
          select: { status: true, trialEndsAt: true, stripePriceId: true, planKey: true },
        });
        if (isBillingFeatureEnabled(resolvedSubscription, "customDomain")) {
          merchant = await this.prisma.merchant.findUnique({ where: { id: domain.merchantId } });
        }
      }
    }
    if (!merchant) merchant = await this.prisma.merchant.findUnique({ where: { storeSlug: identifier } });
    if (!merchant) return null;

    const [subscription, agentRule, merchantRules, stories] = await Promise.allSettled([
      resolvedSubscription === undefined
        ? this.prisma.merchantBillingSubscription.findUnique({
          where: { merchantId: merchant.id },
          select: { status: true, trialEndsAt: true, stripePriceId: true, planKey: true },
        })
        : Promise.resolve(resolvedSubscription),
      findMerchantAgentRule(this.prisma, merchant.id),
      this.prisma.merchantRule.findUnique({ where: { merchantId: merchant.id }, select: { quickReplies: true } }),
      this.prisma.storyCategory.findMany({
        where: { merchantId: merchant.id, isArchived: false },
        include: { stories: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    return {
      merchant: { id: merchant.id, name: merchant.name, theme: merchant.theme, storeCategory: merchant.storeCategory, storeSettings: merchant.storeSettings },
      subscriptionStatus: settledValue(subscription)?.status,
      agentRule: settledValue(agentRule) ?? undefined,
      quickReplies: settledValue(merchantRules)?.quickReplies,
      stories: settledValue(stories) ?? [],
    };
  }
}

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}
