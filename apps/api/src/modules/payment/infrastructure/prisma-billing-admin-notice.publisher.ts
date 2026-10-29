import type { PrismaClient } from "@prisma/client";
import type { BillingAdminNoticePort, PaidSubscriptionNotice } from "../domain/ports/billing-admin-notice.port.js";

export class PrismaBillingAdminNoticePublisher implements BillingAdminNoticePort {
  constructor(private readonly prisma: PrismaClient) {}
  async enqueue(input: PaidSubscriptionNotice): Promise<void> {
    await this.prisma.billingAdminNotice.upsert({
      where: { provider_subscriptionId: { provider: input.provider, subscriptionId: input.subscriptionId } },
      create: { ...input, id: `${input.provider}:${input.subscriptionId}`, occurredAt: new Date(input.occurredAt) },
      update: {},
    });
  }
}
