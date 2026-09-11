import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  BILLING_PROVIDER,
  type BillingProviderPort,
} from "../../../domain/ports/billing-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";

const DEFAULT_BATCH_SIZE = 100;

export interface ReconcileScheduledSubscriptionCancellationsResult {
  suspended: number;
  finalized: number;
  failed: number;
}

/**
 * Reconciles the two provider-side stages of a period-end cancellation.
 *
 * A recurrence is first made INACTIVE so it cannot generate another charge.
 * At the recorded period end it is permanently removed. Both operations are
 * retry-safe, and a persisted suspension timestamp lets a new process resume
 * after an interruption without repeatedly calling the provider.
 */
@Injectable()
export class ReconcileScheduledSubscriptionCancellationsUseCase {
  private readonly logger = new Logger(
    ReconcileScheduledSubscriptionCancellationsUseCase.name,
  );

  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
  ) {}

  async execute(input: { now?: Date; limit?: number } = {}): Promise<ReconcileScheduledSubscriptionCancellationsResult> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.trunc(input.limit ?? DEFAULT_BATCH_SIZE));
    let suspended = 0;
    let finalized = 0;
    let failed = 0;

    const unsuspended = await this.repository.listBillingCancellationsNeedingProviderSuspend(limit);
    for (const billing of unsuspended) {
      if (!billing.asaasSubscriptionId) continue;
      try {
        const found = await this.provider.ensureSubscriptionInactive(
          billing.asaasSubscriptionId,
        );
        if (!found) {
          await this.finalize(billing.merchantId);
          finalized += 1;
          continue;
        }
        await this.repository.saveBilling({
          merchantId: billing.merchantId,
          providerCancellationScheduledAt: now.toISOString(),
        });
        suspended += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Unable to suspend scheduled billing cancellation for merchant=${billing.merchantId}: ${message(error)}`,
        );
      }
    }

    const due = await this.repository.listDueBillingCancellations(now, limit);
    for (const billing of due) {
      if (!billing.asaasSubscriptionId) continue;
      try {
        await this.provider.cancelSubscription(billing.asaasSubscriptionId);
        await this.finalize(billing.merchantId);
        finalized += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Unable to finalize scheduled billing cancellation for merchant=${billing.merchantId}: ${message(error)}`,
        );
      }
    }

    return { suspended, finalized, failed };
  }

  private async finalize(merchantId: string): Promise<void> {
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
