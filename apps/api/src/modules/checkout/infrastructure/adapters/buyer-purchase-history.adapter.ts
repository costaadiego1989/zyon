import { Injectable } from "@nestjs/common";
import { RecordCompletedPurchaseUseCase } from "../../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";
import type {
  PurchaseHistoryPort,
  RecordCheckoutPurchaseInput
} from "../../domain/ports/purchase-history.port.js";

@Injectable()
export class BuyerPurchaseHistoryAdapter implements PurchaseHistoryPort {
  constructor(private readonly recordPurchase: RecordCompletedPurchaseUseCase) {}

  async recordCheckoutPurchase(input: RecordCheckoutPurchaseInput): Promise<void> {
    await this.recordPurchase.execute({
      merchantId: input.merchantId,
      orderId: input.orderId,
      globalUserId: input.globalUserId,
      currency: input.currency,
      totalAmount: input.totalAmount,
      discountAmount: input.discountAmount,
      completedAt: input.completedAt,
      items: input.items
    });
  }
}
