import { ConflictException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { hasMarketplaceCheckout } from "../../checkout/infrastructure/marketplace-checkout-scope.js";
import { PrismaPaymentRepository } from "../infrastructure/prisma-payment.repository.js";
import { assertFrozenMarketplacePaymentIdentity } from "../domain/frozen-marketplace-payment-identity.js";
import { GetPaymentIntentStatusUseCase } from "./get-payment-intent-status.use-case.js";

export interface CurrentMarketplacePayment {
  version: 1;
  session_id: string;
  marketplace: boolean;
  payment: null | {
    intent_id: string;
    status: string;
    amount_cents: number;
    currency: string;
    method: string;
    checkout_status: "pending" | "completed";
    order_id?: string;
  };
}

type LookupReason = "found" | "no_payment" | "not_marketplace" | "identity" | "ambiguous" | "internal_error";
class RecoveryBlocked extends Error {
  constructor(readonly reason: "identity" | "ambiguous") { super("marketplace_payment_recovery_unavailable"); }
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Discover only the token-bound operation. This never resumes creation, calls a
 * provider, or returns the original action credentials/idempotency key. */
@Injectable()
export class GetCurrentMarketplacePaymentService {
  private readonly logger = new Logger(GetCurrentMarketplacePaymentService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MetricsService) private readonly metrics?: MetricsService) {}

  async execute(scope: { merchantId: string; sessionId: string }): Promise<CurrentMarketplacePayment> {
    let reason: LookupReason = "no_payment";
    try {
      if (!nonempty(scope.merchantId) || !nonempty(scope.sessionId)) throw new RecoveryBlocked("identity");
      const result = await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const reader = tx as PrismaClient;
        const payments = new PrismaPaymentRepository(reader);
        const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
        if (session && (session.merchantId !== scope.merchantId || session.sessionId !== scope.sessionId)) {
          throw new RecoveryBlocked("identity");
        }
        const snapshots = (await payments.listBySessionId(scope.merchantId, scope.sessionId)).map(row => row.snapshot());
        if (snapshots.some(row => row.merchantId !== scope.merchantId || row.sessionId !== scope.sessionId)) {
          throw new RecoveryBlocked("identity");
        }
        const cartRef = record(session?.cart)?.cart_ref;
        const refs = [...new Set([scope.sessionId, ...(nonempty(cartRef) ? [cartRef] : [])])];
        // Include cart bindings only to detect conflicts. A different session's
        // payment is never adopted merely because the browser reused its cart.
        const plans = await tx.marketplaceFundingPlan.findMany({ where: { OR: [
          { payment: { merchantId: scope.merchantId, sessionId: scope.sessionId } },
          { hostMerchantId: scope.merchantId, checkoutSessionId: { in: refs } },
        ] }, take: 2 });
        const marked = snapshots.some(row => record(row.creation?.input)?.marketplaceFunding !== undefined ||
          record(row.creation?.input)?.marketplacePublicAdmission !== undefined);
        if (!plans.length) {
          if (marked) throw new RecoveryBlocked("identity");
          const marketplace = session ? await hasMarketplaceCheckout(tx, { ...scope, session }) : false;
          if (marketplace && snapshots.length) throw new RecoveryBlocked("identity");
          reason = marketplace ? "no_payment" : "not_marketplace";
          return { version: 1 as const, session_id: scope.sessionId, marketplace, payment: null };
        }
        if (plans.length > 1 || snapshots.length > 1) throw new RecoveryBlocked("ambiguous");
        if (!session || snapshots.length !== 1) throw new RecoveryBlocked("identity");
        const snapshot = snapshots[0]!, plan = plans[0]!;
        try {
          assertFrozenMarketplacePaymentIdentity(snapshot, plan, nonempty(cartRef) ? cartRef : scope.sessionId);
        } catch { throw new RecoveryBlocked("identity"); }
        // Reuse the authoritative order proof on the same repeatable-read
        // snapshot; capture alone must not mark checkout as completed.
        const status = await new GetPaymentIntentStatusUseCase(payments, reader).execute({
          merchant_id: scope.merchantId, session_id: scope.sessionId, intent_id: snapshot.id,
        });
        reason = "found";
        return { version: 1 as const, session_id: scope.sessionId, marketplace: true, payment: {
          intent_id: status.intent_id, status: status.status, amount_cents: status.amount_cents,
          currency: status.currency, method: status.method, checkout_status: status.checkout_status ?? "pending",
          ...(status.checkout_status === "completed" && status.order_id ? { order_id: status.order_id } : {}),
        } };
      }, { isolationLevel: "RepeatableRead" });
      this.observe(result.payment ? "found" : "empty", reason);
      return result;
    } catch (error) {
      const blocked = error instanceof RecoveryBlocked;
      this.observe(blocked ? "blocked" : "error", blocked ? error.reason : "internal_error");
      if (blocked) throw new ConflictException("marketplace_payment_recovery_unavailable");
      throw new ServiceUnavailableException("marketplace_payment_recovery_unavailable");
    }
  }

  private observe(outcome: "found" | "empty" | "blocked" | "error", reason: LookupReason): void {
    this.metrics?.marketplacePaymentRecoveryLookups.inc({ outcome, reason });
    this.logger.log({ event: "marketplace.payment_recovery_lookup", outcome, reason });
  }
}
