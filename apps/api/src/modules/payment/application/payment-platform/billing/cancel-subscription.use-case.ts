import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import {
  BILLING_PROVIDER,
  type BillingProviderPort,
} from "../../../domain/ports/billing-provider.port.js";

export interface CancelSubscriptionInput {
  merchantId: string;
  immediate?: boolean;
}

@Injectable()
export class CancelSubscriptionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
  ) {}

  async execute(input: CancelSubscriptionInput) {
    const billing = await this.repository.getBilling(input.merchantId);
    if (!billing) {
      return undefined;
    }

    if (billing.status === "cancelled") {
      return billing;
    }

    if (input.immediate && billing.asaasSubscriptionId) {
      await this.provider.cancelSubscription(billing.asaasSubscriptionId);
      await this.finalizeLocally(input.merchantId);
    } else {
      if (!billing.asaasSubscriptionId) {
        // Legacy Stripe records are kept on their existing lifecycle. There is
        // no Asaas recurrence to suspend in this path.
        await this.repository.saveBilling({
          merchantId: input.merchantId,
          cancelAtPeriodEnd: true,
        });
        return this.repository.getBilling(input.merchantId);
      }

      if (billing.cancelAtPeriodEnd && billing.providerCancellationScheduledAt) {
        return billing;
      }

      const cancellationWasAlreadyRequested = billing.cancelAtPeriodEnd;

      const periodEnd = await this.resolvePeriodEnd(billing);
      if (!periodEnd) {
        throw new BadRequestException("billing_period_end_unavailable");
      }

      if (new Date(periodEnd).getTime() <= Date.now()) {
        await this.provider.cancelSubscription(billing.asaasSubscriptionId);
        await this.finalizeLocally(input.merchantId);
        return this.repository.getBilling(input.merchantId);
      }

      // Record intent first. If the process stops after this write, the
      // reconciliation job retries the provider suspension safely.
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: periodEnd,
      });

      try {
        const found = await this.provider.ensureSubscriptionInactive(
          billing.asaasSubscriptionId,
        );
        if (!found) {
          await this.finalizeLocally(input.merchantId);
        } else {
          await this.repository.saveBilling({
            merchantId: input.merchantId,
            providerCancellationScheduledAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        // A request that was already persisted (for example, before a process
        // restart) remains available to the reconciliation job. A new request
        // is rolled back because it was never confirmed to the merchant.
        if (!cancellationWasAlreadyRequested) {
          await this.repository.saveBilling({
            merchantId: input.merchantId,
            cancelAtPeriodEnd: false,
            providerCancellationScheduledAt: null,
          });
        }
        throw error;
      }
    }

    return this.repository.getBilling(input.merchantId);
  }

  private async resolvePeriodEnd(billing: {
    status: string;
    trialEndsAt?: string;
    currentPeriodEnd?: string;
    asaasSubscriptionId?: string;
  }): Promise<string | undefined> {
    if (billing.currentPeriodEnd) return billing.currentPeriodEnd;
    if (billing.status === "trialing" && billing.trialEndsAt) {
      return billing.trialEndsAt;
    }
    if (!billing.asaasSubscriptionId) return undefined;
    const remote = await this.provider.getSubscription(
      billing.asaasSubscriptionId,
    );
    if (!remote?.nextDueDate) return undefined;
    return asProviderDueDate(remote.nextDueDate);
  }

  private async finalizeLocally(merchantId: string): Promise<void> {
    await this.repository.saveBilling({
      merchantId,
      status: "cancelled",
      cancelAtPeriodEnd: false,
      providerCancellationScheduledAt: null,
      pendingPlanKey: null,
      pendingPlanEffectiveAt: null,
    });
  }
}

function asProviderDueDate(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
