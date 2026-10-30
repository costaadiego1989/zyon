import { Inject, Injectable } from "@nestjs/common";
import { PAID_ORDER_RECEIPT_READER, type PaidOrderReceiptReader } from "../ports/paid-order-receipt-reader.port.js";
import { SendOrderConfirmationUseCase } from "./send-order-confirmation.use-case.js";
import { SendMerchantOrderNotificationUseCase } from "./send-merchant-order-notification.use-case.js";

/** Internal, explicit receipt correction. No order/payment/inventory commands or event replay. */
@Injectable()
export class SendPaidOrderReceiptCorrectionUseCase {
  constructor(@Inject(PAID_ORDER_RECEIPT_READER) private readonly receipts: PaidOrderReceiptReader,
    private readonly buyer: SendOrderConfirmationUseCase, private readonly merchant: SendMerchantOrderNotificationUseCase) {}

  async execute(input: { merchantId: string; externalOrderId: string; idempotencyPurpose: string }): Promise<void> {
    if (!/^[a-z0-9][a-z0-9:_-]{7,159}$/.test(input.idempotencyPurpose)
      || !input.idempotencyPurpose.endsWith(`:${input.externalOrderId}`)) throw new Error("receipt_correction_purpose_invalid");
    const event = await this.receipts.read(input);
    if (!event || event.merchantId !== input.merchantId || event.orderId !== input.externalOrderId
      || event.paidReceipt?.status !== "itemized") throw new Error("receipt_correction_canonical_payment_required");
    const options = { idempotencyPurpose: input.idempotencyPurpose, skipDashboard: true };
    const results = await Promise.allSettled([this.buyer.execute(event, options), this.merchant.execute(event, options)]);
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
