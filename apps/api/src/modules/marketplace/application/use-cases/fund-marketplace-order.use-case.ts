import { Logger } from "@nestjs/common";
import type { MarketplaceCaptureProvider } from "../../domain/ports/marketplace-capture-provider.port.js";
import { PrismaMarketplaceFundingRepository } from "../../infrastructure/repositories/prisma-marketplace-funding.repository.js";

export class FundMarketplaceOrderUseCase {
  private readonly logger = new Logger(FundMarketplaceOrderUseCase.name);
  constructor(private readonly repository: PrismaMarketplaceFundingRepository, private readonly captures: MarketplaceCaptureProvider) {}

  async execute(host: string, order: string): Promise<"funded" | "pending" | "skipped"> {
    const plan = await this.repository.pendingForOrder(host, order);
    if (!plan) return "skipped";
    // Network reads never hold a database transaction/lock.
    let evidence;
    try {
      evidence = await this.captures.readCapture({ provider: plan.provider as "stripe" | "asaas",
        environment: plan.environment as "test" | "live", accountFingerprint: plan.accountFingerprint,
        providerPaymentId: order, amountCents: plan.amountCents, currency: "BRL" });
    } catch {
      // A successful card capture can legitimately have an unavailable balance.
      // The durable funding queue retries independently of order delivery.
      await this.repository.defer(plan.paymentIntentId);
      this.logger.warn({ event: "marketplace_funding_pending", reason: "capture_not_verified" });
      return "pending";
    }
    await this.repository.fund(plan.paymentIntentId, evidence);
    return "funded";
  }

  async recover(): Promise<{ attempted: number; funded: number; pending: number; failed: number }> {
    const plans = await this.repository.pending(20);
    const result = { attempted: plans.length, funded: 0, pending: 0, failed: 0 };
    let next = 0;
    const worker = async () => {
      while (next < plans.length) {
        const plan = plans[next++];
        try {
          const outcome = await this.execute(plan.hostMerchantId, plan.payment.providerPaymentId!);
          if (outcome === "funded") result.funded++;
          else if (outcome === "pending") result.pending++;
        } catch {
          result.failed++;
          // Failure to defer one row must not prevent attempts for the rest.
          try { await this.repository.defer(plan.paymentIntentId); } catch { /* retried from durable queue */ }
          this.logger.warn({ event: "marketplace_funding_pending", reason: "capture_or_allocation_not_verified" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, plans.length) }, worker));
    return result;
  }
}
