export type BuyerBenefitType = "discount_percent" | "free_shipping" | "coupon";
export type BuyerBenefitOrigin = "loyalty_milestone" | "intent_based";
export type BuyerBenefitStatus = "active" | "redeemed" | "expired";

export interface BuyerEarnedBenefitSnapshot {
  id: string;
  merchantId: string;
  globalUserId: string;
  benefitType: BuyerBenefitType;
  value: number;
  origin: BuyerBenefitOrigin;
  reason: string;
  status: BuyerBenefitStatus;
  expiresAt?: string | null;
  createdAt: string;
}

const VALID_BENEFIT_TYPES: BuyerBenefitType[] = ["discount_percent", "free_shipping", "coupon"];
const VALID_ORIGINS: BuyerBenefitOrigin[] = ["loyalty_milestone", "intent_based"];
const VALID_STATUSES: BuyerBenefitStatus[] = ["active", "redeemed", "expired"];

export class BuyerEarnedBenefitEntity {
  private constructor(private readonly props: BuyerEarnedBenefitSnapshot) {}

  static create(input: {
    id?: string;
    merchantId: string;
    globalUserId: string;
    benefitType: BuyerBenefitType;
    value: number;
    origin: BuyerBenefitOrigin;
    reason: string;
    status?: BuyerBenefitStatus;
    expiresAt?: Date | string | null;
    createdAt?: Date;
  }): BuyerEarnedBenefitEntity {
    if (!input.merchantId) {
      throw new Error("buyer_earned_benefit_missing_merchant");
    }
    if (!input.globalUserId) {
      throw new Error("buyer_earned_benefit_missing_global_user");
    }
    if (!VALID_BENEFIT_TYPES.includes(input.benefitType)) {
      throw new Error("buyer_earned_benefit_invalid_type");
    }
    if (!VALID_ORIGINS.includes(input.origin)) {
      throw new Error("buyer_earned_benefit_invalid_origin");
    }
    if (typeof input.value !== "number" || Number.isNaN(input.value) || input.value < 0) {
      throw new Error("buyer_earned_benefit_invalid_value");
    }
    const status = input.status ?? "active";
    if (!VALID_STATUSES.includes(status)) {
      throw new Error("buyer_earned_benefit_invalid_status");
    }

    const createdAt = input.createdAt ?? new Date();

    return new BuyerEarnedBenefitEntity({
      id: input.id ?? "",
      merchantId: input.merchantId,
      globalUserId: input.globalUserId,
      benefitType: input.benefitType,
      value: input.value,
      origin: input.origin,
      reason: input.reason,
      status,
      expiresAt: toIso(input.expiresAt),
      createdAt: createdAt.toISOString(),
    });
  }

  static rehydrate(snapshot: BuyerEarnedBenefitSnapshot): BuyerEarnedBenefitEntity {
    if (!VALID_BENEFIT_TYPES.includes(snapshot.benefitType)) {
      throw new Error("buyer_earned_benefit_invalid_type");
    }
    if (!VALID_STATUSES.includes(snapshot.status)) {
      throw new Error("buyer_earned_benefit_invalid_status");
    }
    return new BuyerEarnedBenefitEntity({ ...snapshot });
  }

  snapshot(): BuyerEarnedBenefitSnapshot {
    return { ...this.props };
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}
