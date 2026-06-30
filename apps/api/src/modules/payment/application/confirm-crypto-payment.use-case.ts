import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { CurrencyCode } from "@zyon/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import { evmCryptoVerifier } from "../infrastructure/evm-crypto-verifier.js";
import type { CryptoBuyerFacing } from "../infrastructure/evm-crypto.constants.js";

export type ConfirmCryptoPaymentRequest = {
  merchant_id: string;
  session_id: string;
  intent_id: string;
  tx_hash: string;
  wallet_address: string;
};

function asCryptoBuyerFacing(raw: unknown): CryptoBuyerFacing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.chainId !== "number" ||
    typeof r.chain !== "string" ||
    typeof r.evmNetwork !== "string" ||
    typeof r.tokenAddress !== "string" ||
    typeof r.amountAtomic !== "string" ||
    typeof r.destinationAddress !== "string" ||
    typeof r.quoteExpiresAt !== "string"
  ) {
    return null;
  }
  return raw as CryptoBuyerFacing;
}

@Injectable()
export class ConfirmCryptoPaymentUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Optional() @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment?: CheckoutPaymentPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox?: OutboxRepository
  ) {}

  async execute(body: ConfirmCryptoPaymentRequest): Promise<{ status: string; intent_id: string }> {
    const merchantId = body.merchant_id.trim();
    const sessionId = body.session_id.trim();
    const intentId = body.intent_id.trim();
    const txHash = body.tx_hash.trim();
    const walletAddress = body.wallet_address.trim();

    if (!merchantId || !sessionId || !intentId || !txHash || !walletAddress) {
      throw new BadRequestException("crypto_confirm_fields_required");
    }

    const intentRow = await this.payments.getIntentById(merchantId, intentId);
    if (!intentRow) throw new NotFoundException("payment_intent_not_found");

    const snap = intentRow.snapshot();
    if (snap.sessionId !== sessionId) {
      throw new NotFoundException("payment_intent_not_found");
    }
    if (snap.method !== "crypto") {
      throw new BadRequestException("payment_intent_not_crypto");
    }
    if (snap.status === "approved") {
      return { status: "approved", intent_id: intentId };
    }
    if (snap.status !== "requires_action") {
      throw new BadRequestException("payment_intent_not_confirmable");
    }

    const buyerFacing = asCryptoBuyerFacing(snap.buyerFacing);
    if (!buyerFacing) {
      throw new BadRequestException("crypto_quote_missing");
    }

    // Global uniqueness gate: reserve (chain, txHash) for THIS intent BEFORE
    // verifying/approving. A txHash already consumed (by this or any other
    // intent) is rejected — no replay, no cross-intent reuse (ADR 0001 #2).
    const transferKey = { chain: buyerFacing.chain, txHash, merchantId, intentId };
    const reserved = await this.payments.recordCryptoTransfer(transferKey);
    if (!reserved) {
      throw new ConflictException("crypto_tx_already_used");
    }

    let verified: { from: string };
    try {
      verified = await evmCryptoVerifier.verifyTransfer({
        txHash,
        walletAddress,
        buyerFacing
      });

      const intent = PaymentIntentEntity.rehydrate(snap);
      intent.markApproved({
        providerPaymentId: txHash,
        approvedAmountCents: snap.amountCents
      });

      await this.payments.saveIntent({ intent });
    } catch (e) {
      // Verification/approval failed — release the reservation so a legitimate
      // retry (correct tx) is not permanently blocked by this attempt.
      await this.payments.deleteCryptoTransfer({ chain: buyerFacing.chain, txHash });
      throw e;
    }

    if (this.outbox) {
      await this.outbox.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "payment.status.changed",
          merchantId,
          payload: {
            session_id: sessionId,
            payment_intent_id: intentId,
            status: "approved",
            amount_cents: snap.amountCents,
            method: "crypto",
            tx_hash: txHash,
            wallet_address: verified.from
          },
          causationId: intentId
        })
      );
    }

    if (this.checkoutPayment) {
      await this.checkoutPayment.completeAfterApproval({
        merchantId,
        sessionId,
        externalOrderId: txHash,
        orderTotalMajorUnits: Number((snap.amountCents / 100).toFixed(2)),
        currency: snap.currency as CurrencyCode,
        acceptedOfferId: snap.acceptedOfferId
      });
    }

    return { status: "approved", intent_id: intentId };
  }
}
