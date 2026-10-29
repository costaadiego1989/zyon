import { randomUUID } from "node:crypto";

export type SuggestionStatus = "pending" | "accepted" | "declined";

export type CrossSellSuggestionSnapshot = {
  id: string;
  session_id: string;
  merchant_id: string;
  promo_id: string;
  ranked_items: string[];
  agent_copy: string;
  computed_discount: number;
  status: SuggestionStatus;
  suggested_at: string;
  resolved_at: string | null;
};

export class CrossSellSuggestionEntity {
  private constructor(private readonly s: CrossSellSuggestionSnapshot) {}

  static create(input: {
    session_id: string;
    merchant_id: string;
    promo_id: string;
    ranked_items: string[];
    agent_copy: string;
    computed_discount: number;
  }): CrossSellSuggestionEntity {
    return new CrossSellSuggestionEntity({
      id: randomUUID(),
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      promo_id: input.promo_id,
      ranked_items: input.ranked_items,
      agent_copy: input.agent_copy,
      computed_discount: input.computed_discount,
      status: "pending",
      suggested_at: new Date().toISOString(),
      resolved_at: null
    });
  }

  static rehydrate(s: CrossSellSuggestionSnapshot): CrossSellSuggestionEntity {
    return new CrossSellSuggestionEntity(s);
  }

  accept(acceptedSkus: string[]): CrossSellSuggestionEntity {
    if (this.s.status !== "pending") throw new Error("illegal_transition");
    // P1 fix: validate that every accepted SKU belongs to this suggestion's ranked_items
    const allowedSet = new Set(this.s.ranked_items);
    const invalidSkus = acceptedSkus.filter((sku) => !allowedSet.has(sku));
    if (invalidSkus.length > 0) {
      throw new Error(`accepted_skus_not_in_suggestion:${invalidSkus.join(",")}`);
    }
    return new CrossSellSuggestionEntity({
      ...this.s,
      status: "accepted",
      ranked_items: acceptedSkus,
      resolved_at: new Date().toISOString()
    });
  }

  decline(): CrossSellSuggestionEntity {
    if (this.s.status !== "pending") throw new Error("illegal_transition");
    return new CrossSellSuggestionEntity({
      ...this.s,
      status: "declined",
      resolved_at: new Date().toISOString()
    });
  }

  snapshot(): CrossSellSuggestionSnapshot { return { ...this.s }; }
  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
  get session_id(): string { return this.s.session_id; }
  get promo_id(): string { return this.s.promo_id; }
  get status(): SuggestionStatus { return this.s.status; }
}
