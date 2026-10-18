export type PromotionPlan = "starter179" | "growth" | "scale";
export type BillingPromotionDraft = {
  id: string; name: string; code: string; plans: PromotionPlan[];
  discountType: "percent" | "fixed"; discountValue: number;
  duration: "once" | "repeating" | "forever"; durationMonths: number | null;
  startsAt: string; expiresAt: string; maxRedemptions: number | null; firstTimeOnly: boolean;
  autoApply?: boolean;
};
export type BillingPromotion = BillingPromotionDraft & {
  enabled: boolean; provisioned: boolean; status: string; timesRedeemed: number | null;
  stripeActive: boolean | null; livemode: boolean | null; createdAt: string;
};
export type BillingPromotionsPage = {
  items: BillingPromotion[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  plans: Array<{ id: PromotionPlan; name: string; monthlyPriceCents: number }>;
  policy: { maxMonths: number; minChargeCents: number };
};

export type BillingPromotionsQuery = {
  page: number; pageSize: number; search?: string; status?: string; discountType?: string; plan?: string;
};
