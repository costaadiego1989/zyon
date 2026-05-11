import { randomUUID } from "node:crypto";

export type PromotionStatus = "active" | "archived";

export type PromotionTrigger = {
  sku_in_cart?: string[];
  category_in_cart?: string[];
  cart_total_above?: number;
};

export type CrossSellPromotionSnapshot = {
  id: string;
  merchant_id: string;
  name: string;
  trigger: PromotionTrigger;
  recommended_skus: string[];
  discount_percent: number;
  max_discount_percent: number;
  status: PromotionStatus;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export class CrossSellPromotionEntity {
  private constructor(private readonly s: CrossSellPromotionSnapshot) {}

  static create(input: {
    merchant_id: string;
    name: string;
    trigger: PromotionTrigger;
    recommended_skus: string[];
    discount_percent: number;
    max_discount_percent: number;
    starts_at: Date;
    ends_at?: Date;
  }): CrossSellPromotionEntity {
    if (!input.merchant_id.trim()) throw new Error("cross_sell_promotion_merchant_required");
    if (!input.name.trim()) throw new Error("cross_sell_promotion_name_required");
    if (input.recommended_skus.length === 0) throw new Error("cross_sell_promotion_skus_required");
    if (input.discount_percent < 0 || input.discount_percent > 100) throw new Error("cross_sell_promotion_discount_invalid");
    const now = new Date().toISOString();
    return new CrossSellPromotionEntity({
      id: randomUUID(),
      merchant_id: input.merchant_id.trim(),
      name: input.name.trim(),
      trigger: input.trigger,
      recommended_skus: input.recommended_skus,
      discount_percent: input.discount_percent,
      max_discount_percent: input.max_discount_percent,
      status: "active",
      starts_at: input.starts_at.toISOString(),
      ends_at: input.ends_at?.toISOString() ?? null,
      created_at: now,
      updated_at: now
    });
  }

  static rehydrate(s: CrossSellPromotionSnapshot): CrossSellPromotionEntity {
    return new CrossSellPromotionEntity(s);
  }

  archive(): CrossSellPromotionEntity {
    return new CrossSellPromotionEntity({ ...this.s, status: "archived", updated_at: new Date().toISOString() });
  }

  update(patch: Partial<Pick<CrossSellPromotionSnapshot, "name" | "trigger" | "recommended_skus" | "discount_percent" | "max_discount_percent" | "starts_at" | "ends_at">>): CrossSellPromotionEntity {
    return new CrossSellPromotionEntity({ ...this.s, ...patch, updated_at: new Date().toISOString() });
  }

  isActive(): boolean {
    return this.s.status === "active";
  }

  snapshot(): CrossSellPromotionSnapshot {
    return { ...this.s };
  }

  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
}
