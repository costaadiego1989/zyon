import { Inject, Injectable, Optional } from "@nestjs/common";
import type {
  BuyerPurchaseHistoryContext,
  PurchaseHistoryIdentity,
  PurchaseRecord
} from "../domain/buyer-purchase-history.types.js";
import {
  BUYER_PURCHASE_HISTORY_REPOSITORY,
  type BuyerPurchaseHistoryRepository
} from "../domain/ports/buyer-purchase-history-repository.port.js";
import {
  PURCHASE_HISTORY_METERING_PORT,
  type PurchaseHistoryMeteringPort
} from "../domain/ports/purchase-history-metering.port.js";

export interface RecordCompletedPurchaseResponse {
  recorded: true;
  idempotent: boolean;
  orders_count: number;
}

@Injectable()
export class RecordCompletedPurchaseUseCase {
  constructor(
    @Inject(BUYER_PURCHASE_HISTORY_REPOSITORY) private readonly repository: BuyerPurchaseHistoryRepository,
    @Optional() @Inject(PURCHASE_HISTORY_METERING_PORT) private readonly metering?: PurchaseHistoryMeteringPort
  ) {}

  async execute(input: PurchaseRecord): Promise<RecordCompletedPurchaseResponse> {
    const result = await this.repository.recordPurchase(input);
    if (!result.idempotent) {
      await this.metering?.record({
        eventType: "purchase_history.imported_order",
        merchantId: input.merchantId,
        globalUserId: input.globalUserId,
        merchantCustomerId: input.merchantCustomerId,
        units: 1,
        metadata: {
          order_id: input.orderId,
          items_count: input.items.length
        }
      });
    }
    return {
      recorded: true,
      idempotent: result.idempotent,
      orders_count: result.history.stats().ordersCount
    };
  }
}

@Injectable()
export class GetBuyerPurchaseContextUseCase {
  constructor(
    @Inject(BUYER_PURCHASE_HISTORY_REPOSITORY) private readonly repository: BuyerPurchaseHistoryRepository,
    @Optional() @Inject(PURCHASE_HISTORY_METERING_PORT) private readonly metering?: PurchaseHistoryMeteringPort
  ) {}

  async execute(input: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryContext> {
    const history = await this.repository.getByBuyer(input);
    if (history) {
      const context = history.toSafeContext();
      await this.recordContextUsed(input, context.purchase_history.orders_count, context.purchase_history.known_buyer);
      return context;
    }

    const context: BuyerPurchaseHistoryContext = {
      merchant_id: input.merchantId,
      global_user_id: input.globalUserId,
      merchant_customer_id: input.merchantCustomerId,
      purchase_history: {
        known_buyer: false,
        orders_count: 0,
        lifetime_value: 0,
        average_order_value: 0,
        top_categories: [],
        recent_skus: [],
        discount_sensitivity: "unknown",
        returning_customer_copy_hint: "Do not imply the buyer has previous purchases."
      }
    };
    await this.recordContextUsed(input, 0, false);
    return context;
  }

  private async recordContextUsed(
    input: PurchaseHistoryIdentity,
    ordersCount: number,
    knownBuyer: boolean
  ): Promise<void> {
    await this.metering?.record({
      eventType: "purchase_history.context_used",
      merchantId: input.merchantId,
      globalUserId: input.globalUserId,
      merchantCustomerId: input.merchantCustomerId,
      units: 1,
      metadata: {
        known_buyer: knownBuyer,
        orders_count: ordersCount
      }
    });
  }
}
