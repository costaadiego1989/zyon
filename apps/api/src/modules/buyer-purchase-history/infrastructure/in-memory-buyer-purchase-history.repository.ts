import { Injectable } from "@nestjs/common";
import { BuyerPurchaseHistoryEntity } from "../domain/entities/buyer-purchase-history.entity.js";
import type { BuyerPurchaseHistoryRepository } from "../domain/ports/buyer-purchase-history-repository.port.js";
import type { BuyerPurchaseHistoryContext, PurchaseHistoryIdentity, PurchaseRecord } from "../domain/buyer-purchase-history.types.js";

@Injectable()
export class InMemoryBuyerPurchaseHistoryRepository implements BuyerPurchaseHistoryRepository {
  private histories = new Map<string, BuyerPurchaseHistoryEntity>();
  private orderIndex = new Set<string>();

  async getByBuyer(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryEntity | undefined> {
    return this.histories.get(this.identityKey(identity));
  }

  async getContext(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryContext | undefined> {
    return this.histories.get(this.identityKey(identity))?.toSafeContext();
  }

  async recordPurchase(purchase: PurchaseRecord): Promise<{ ordersCount: number; idempotent: boolean }> {
    const identity = {
      merchantId: purchase.merchantId,
      globalUserId: purchase.globalUserId,
      merchantCustomerId: purchase.merchantCustomerId
    };
    const key = this.identityKey(identity);
    const orderKey = this.orderKey(purchase);
    const current = this.histories.get(key) ?? BuyerPurchaseHistoryEntity.create(identity);
    const next = current.recordPurchase(purchase);
    const idempotent = this.orderIndex.has(orderKey);

    this.histories.set(key, next);
    this.orderIndex.add(orderKey);

    return { ordersCount: next.stats().ordersCount, idempotent };
  }

  async listPurchasesForGlobalUser(globalUserId: string): Promise<PurchaseRecord[]> {
    const purchases: PurchaseRecord[] = [];
    for (const history of this.histories.values()) {
      const snapshot = history.snapshot();
      if (snapshot.globalUserId !== globalUserId) continue;
      purchases.push(...snapshot.purchases);
    }
    return purchases;
  }

  private identityKey(identity: PurchaseHistoryIdentity): string {
    const buyerKey = identity.globalUserId
      ? `global:${identity.globalUserId}`
      : `merchant-customer:${identity.merchantCustomerId}`;
    return `${identity.merchantId}:${buyerKey}`;
  }

  private orderKey(purchase: Pick<PurchaseRecord, "merchantId" | "orderId">): string {
    return `${purchase.merchantId}:${purchase.orderId}`;
  }
}
