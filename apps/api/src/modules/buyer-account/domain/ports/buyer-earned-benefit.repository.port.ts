import type {
  BuyerBenefitOrigin,
  BuyerBenefitStatus,
  BuyerBenefitType,
  BuyerEarnedBenefitSnapshot,
} from "../entities/buyer-earned-benefit.entity.js";

export const BUYER_EARNED_BENEFIT_REPOSITORY = Symbol("BUYER_EARNED_BENEFIT_REPOSITORY");

export interface CreateBuyerEarnedBenefitInput {
  merchantId: string;
  globalUserId: string;
  benefitType: BuyerBenefitType;
  value: number;
  origin: BuyerBenefitOrigin;
  reason: string;
  status?: BuyerBenefitStatus;
  expiresAt?: Date | string | null;
}

export interface BuyerEarnedBenefitRepositoryPort {
  create(input: CreateBuyerEarnedBenefitInput): Promise<BuyerEarnedBenefitSnapshot>;
  /**
   * Active benefits for a buyer, scoped by merchant_id (tenant boundary, INV-06).
   * Only status="active" and not-yet-expired rows.
   */
  listActive(
    merchantId: string,
    globalUserId: string
  ): Promise<BuyerEarnedBenefitSnapshot[]>;
}
