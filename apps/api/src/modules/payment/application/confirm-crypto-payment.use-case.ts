import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional , Logger} from "@nestjs/common";
import type { CurrencyCode } from "@zyon/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { CRYPTO_VERIFIER, type CryptoVerifierPort } from "../domain/ports/crypto-verifier.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import type { CryptoBuyerFacing } from "../domain/entities/crypto-buyer-facing.type.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

export type ConfirmCryptoPaymentRequest = {
  merchant_id: string;
  session_id: string;
  intent_id: string;
  tx_hash: string;
  tx_hashes?: string[];
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
  private readonly logger = new Logger(ConfirmCryptoPaymentUseCase.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Optional() @Inject(CRYPTO_VERIFIER) private readonly cryptoVerifier?: CryptoVerifierPort,
    @Optional() @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment?: CheckoutPaymentPort,
    @Optional() @Inject(OUTBOX_REPOSITORY) private readonly outbox?: OutboxRepository
  ) {}

  async execute(body: ConfirmCryptoPaymentRequest): Promise<{ status: string; intent_id: string }> {
    const merchantId = body.merchant_id.trim();
    const sessionId = body.session_id.trim();
    const intentId = body.intent_id.trim();
    const txHash = body.tx_hash.trim();
    const txHashes = (Array.isArray(body.tx_hashes) && body.tx_hashes.length
      ? body.tx_hashes
      : [txHash]
    ).map((hash) => hash.trim()).filter(Boolean);
    const walletAddress = body.wallet_address.trim();

    if (!merchantId || !sessionId || !intentId || !txHashes.length || !walletAddress) {
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

    const transfers = buyerFacing.transfers?.length
      ? buyerFacing.transfers
      : [{ kind: "merchant" as const, destinationAddress: buyerFacing.destinationAddress, amountAtomic: buyerFacing.amountAtomic, amountDisplay: buyerFacing.amountDisplay }];
    if (txHashes.length < transfers.length) {
      throw new BadRequestException("crypto_fee_transfer_required");
    }

    const reservedHashes: string[] = [];
    let verified: { from: string } = { from: walletAddress };
    try {
      for (let index = 0; index < transfers.length; index += 1) {
        const transfer = transfers[index]!;
        const hash = txHashes[index]!;
        const transferKey = { chain: buyerFacing.chain, txHash: hash, merchantId, intentId };
        const reserved = await this.payments.recordCryptoTransfer(transferKey);
        if (!reserved) {
          throw new ConflictException("crypto_tx_already_used");
        }
        reservedHashes.push(hash);
        if (!this.cryptoVerifier) {
          throw new BadRequestException("crypto_verifier_not_configured");
        }
        verified = await this.cryptoVerifier.verifyTransfer({
          txHash: hash,
          walletAddress,
          buyerFacing: {
            ...buyerFacing,
            destinationAddress: transfer.destinationAddress,
            amountAtomic: transfer.amountAtomic,
            amountDisplay: transfer.amountDisplay,
          }
        });
      }

      const intent = PaymentIntentEntity.rehydrate(snap);
      intent.markApproved({
        providerPaymentId: txHashes.join(","),
        approvedAmountCents: snap.amountCents
      });

      await this.payments.saveIntent({ intent });
    } catch (e) {
      for (const hash of reservedHashes) {
        await this.payments.deleteCryptoTransfer({ chain: buyerFacing.chain, txHash: hash });
      }
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
            tx_hash: txHashes[0],
            tx_hashes: txHashes,
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
        externalOrderId: txHashes.join(","),
        orderTotalMajorUnits: Number((snap.amountCents / 100).toFixed(2)),
        currency: snap.currency as CurrencyCode,
        acceptedOfferId: snap.acceptedOfferId
      });
    }

    return { status: "approved", intent_id: intentId };
  }
}
