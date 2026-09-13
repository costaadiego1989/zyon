import { Injectable } from "@nestjs/common";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { CreatePaymentHoldUseCase, type PaymentHoldProvider } from "./payment-hold.use-cases.js";

/**
 * Converts an approved, platform-owned payment into a payout hold. The flag
 * lives in the immutable provider-creation snapshot, so a merchant setting
 * changed after checkout cannot alter where that already-paid order settles.
 */
@Injectable()
export class PaymentHoldLifecycleService {
  constructor(private readonly createHold: CreatePaymentHoldUseCase) {}

  async createForApprovedPayment(snapshot: PaymentIntentSnapshot): Promise<void> {
    if (snapshot.status !== "approved") return;
    const input = snapshot.creation?.input;
    if (input?.settlementMode !== "delayed_merchant_payout") return;

    const provider = input.provider;
    const payoutDestination = input.merchantPayoutDestination?.trim();
    const providerPaymentId = snapshot.providerPaymentId?.trim();
    // Only Asaas has a transfer executor plus a provider confirmation webhook
    // for this hold lifecycle. Reject stale/manual Stripe snapshots instead of
    // letting a later job strand the merchant balance in payout_failed.
    if (provider !== "asaas" || !payoutDestination || !providerPaymentId) {
      throw new Error("delayed_merchant_payout_snapshot_invalid");
    }

    await this.createHold.execute({
      merchantId: snapshot.merchantId,
      paymentIntentId: snapshot.id,
      orderId: snapshot.commerceOrderId,
      provider: provider as PaymentHoldProvider,
      providerPaymentId,
      payoutDestination,
      totalAmountCents: snapshot.amountCents,
      platformFeeCents: input.platformFeeCents ?? 0,
      holdDays: input.merchantPayoutHoldDays,
    });
  }
}
