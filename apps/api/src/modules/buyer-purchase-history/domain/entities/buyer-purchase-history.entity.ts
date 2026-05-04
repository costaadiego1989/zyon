import type {
  BuyerMerchantStats,
  BuyerPurchaseHistoryContext,
  BuyerPurchaseHistorySnapshot,
  PurchaseHistoryIdentity,
  PurchaseRecord
} from "../buyer-purchase-history.types.js";

export class BuyerPurchaseHistoryEntity {
  private constructor(private readonly props: BuyerPurchaseHistorySnapshot) {
    if (!props.merchantId) throw new Error("merchant_id_required");
    if (!props.globalUserId && !props.merchantCustomerId) throw new Error("buyer_identity_required");
  }

  static create(input: PurchaseHistoryIdentity): BuyerPurchaseHistoryEntity {
    return new BuyerPurchaseHistoryEntity({
      merchantId: input.merchantId,
      globalUserId: input.globalUserId,
      merchantCustomerId: input.merchantCustomerId,
      purchases: []
    });
  }

  static rehydrate(snapshot: BuyerPurchaseHistorySnapshot): BuyerPurchaseHistoryEntity {
    return new BuyerPurchaseHistoryEntity({
      ...snapshot,
      purchases: snapshot.purchases.map((purchase) => clonePurchase(purchase))
    });
  }

  recordPurchase(purchase: PurchaseRecord): BuyerPurchaseHistoryEntity {
    if (purchase.merchantId !== this.props.merchantId) throw new Error("merchant_mismatch");
    if (this.props.globalUserId && purchase.globalUserId && purchase.globalUserId !== this.props.globalUserId) {
      throw new Error("buyer_identity_mismatch");
    }
    if (
      this.props.merchantCustomerId &&
      purchase.merchantCustomerId &&
      purchase.merchantCustomerId !== this.props.merchantCustomerId
    ) {
      throw new Error("buyer_identity_mismatch");
    }
    if (this.props.purchases.some((existing) => existing.orderId === purchase.orderId)) {
      return this;
    }

    return new BuyerPurchaseHistoryEntity({
      ...this.props,
      globalUserId: this.props.globalUserId ?? purchase.globalUserId,
      merchantCustomerId: this.props.merchantCustomerId ?? purchase.merchantCustomerId,
      purchases: [...this.props.purchases, clonePurchase(purchase)].sort((a, b) =>
        a.completedAt.localeCompare(b.completedAt)
      )
    });
  }

  stats(): BuyerMerchantStats {
    const ordersCount = this.props.purchases.length;
    const lifetimeValue = roundMoney(this.props.purchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0));

    return {
      merchantId: this.props.merchantId,
      globalUserId: this.props.globalUserId,
      merchantCustomerId: this.props.merchantCustomerId,
      ordersCount,
      lifetimeValue,
      averageOrderValue: ordersCount ? roundMoney(lifetimeValue / ordersCount) : 0,
      lastOrderAt: this.props.purchases.at(-1)?.completedAt,
      topCategories: topKeys(
        this.props.purchases.flatMap((purchase) =>
          purchase.items.flatMap((item) => (item.categoryId ? Array(item.quantity).fill(item.categoryId) : []))
        )
      ),
      topSkus: topKeys(
        this.props.purchases.flatMap((purchase) => purchase.items.flatMap((item) => Array(item.quantity).fill(item.sku)))
      ),
      discountSensitivity: discountSensitivity(this.props.purchases)
    };
  }

  toSafeContext(): BuyerPurchaseHistoryContext {
    const stats = this.stats();
    return {
      merchant_id: this.props.merchantId,
      global_user_id: this.props.globalUserId,
      merchant_customer_id: this.props.merchantCustomerId,
      purchase_history: {
        known_buyer: stats.ordersCount > 0,
        orders_count: stats.ordersCount,
        lifetime_value: stats.lifetimeValue,
        average_order_value: stats.averageOrderValue,
        last_order_at: stats.lastOrderAt,
        top_categories: stats.topCategories.slice(0, 5),
        recent_skus: recentSkus(this.props.purchases, 5),
        discount_sensitivity: stats.discountSensitivity,
        returning_customer_copy_hint:
          stats.ordersCount > 0
            ? "Thank the buyer for coming back without mentioning private details."
            : "Do not imply the buyer has previous purchases."
      }
    };
  }

  snapshot(): BuyerPurchaseHistorySnapshot {
    return {
      merchantId: this.props.merchantId,
      globalUserId: this.props.globalUserId,
      merchantCustomerId: this.props.merchantCustomerId,
      purchases: this.props.purchases.map((purchase) => clonePurchase(purchase))
    };
  }
}

function topKeys(values: string[], limit = 5): string[] {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
    if (!firstSeen.has(value)) firstSeen.set(value, index);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))
    .slice(0, limit)
    .map(([value]) => value);
}

function recentSkus(purchases: PurchaseRecord[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const purchase of [...purchases].reverse()) {
    for (const item of purchase.items) {
      if (seen.has(item.sku)) continue;
      seen.add(item.sku);
      result.push(item.sku);
      if (result.length === limit) return result;
    }
  }
  return result;
}

function discountSensitivity(purchases: PurchaseRecord[]): BuyerMerchantStats["discountSensitivity"] {
  if (purchases.length < 2) return "unknown";
  const discounted = purchases.filter((purchase) => purchase.discountAmount > 0).length;
  const ratio = discounted / purchases.length;
  if (ratio < 0.25) return "low";
  if (ratio <= 0.6) return "medium";
  return "high";
}

function clonePurchase(purchase: PurchaseRecord): PurchaseRecord {
  return {
    ...purchase,
    items: purchase.items.map((item) => ({ ...item }))
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
