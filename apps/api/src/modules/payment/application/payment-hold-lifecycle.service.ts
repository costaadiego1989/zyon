import { Inject, Injectable, Optional } from "@nestjs/common";
import { RETAINED_MERCHANT_PAYMENT_PROVIDER, type RetainedMerchantPaymentProvider } from "../domain/ports/retained-merchant-payment.port.js";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { CreatePaymentHoldUseCase, type PaymentHoldProvider } from "./payment-hold.use-cases.js";

/**
 * Converts an approved, platform-owned payment into a payout hold. The flag
 * lives in the immutable provider-creation snapshot, so a merchant setting
 * changed after checkout cannot alter where that already-paid order settles.
 */
@Injectable()
export class PaymentHoldLifecycleService {
  constructor(private readonly createHold: CreatePaymentHoldUseCase,
    @Optional() @Inject(RETAINED_MERCHANT_PAYMENT_PROVIDER) private readonly retained?: RetainedMerchantPaymentProvider) {}

  async createForApprovedPayment(snapshot: PaymentIntentSnapshot): Promise<void> {
    if (snapshot.status !== "approved") return;
    const input = snapshot.creation?.input;
    if (input?.settlementMode !== "delayed_merchant_payout") return;

    const provider = input.provider;
    const payoutDestination = input.merchantPayoutDestination?.trim();
    const providerPaymentId = snapshot.providerPaymentId?.trim();
    const fulfillmentWindow = input.merchantPayoutAnchor === "fulfillment";
    if ((!fulfillmentWindow && provider !== "asaas") || !["asaas", "stripe"].includes(provider ?? "") || !payoutDestination || !providerPaymentId) {
      throw new Error("delayed_merchant_payout_snapshot_invalid");
    }

    if (fulfillmentWindow && (!this.retained || input.merchantPayoutHoldDays !== 7)) throw new Error("scheduled_split_provider_not_configured");
    const capture = fulfillmentWindow ? await this.retained!.readCapture(input, providerPaymentId) : undefined;
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
      ...(capture ? { holdAnchor: "fulfillment" as const, providerFeeCents: capture.providerFeeCents, captureEvidence: capture } : {}),
    });
  }
}
