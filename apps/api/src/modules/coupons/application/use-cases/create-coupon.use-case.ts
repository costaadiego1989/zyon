import { Injectable, Inject , Logger} from "@nestjs/common";
import { CouponEntity, type CouponDiscountType } from "../../domain/entities/coupon.entity.js";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export type CreateCouponInput = {
  merchant_id: string;
  code: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_cart_total?: number;
  max_usages?: number;
  max_per_buyer?: number;
  allowed_skus?: string[];
  blocked_skus?: string[];
  allowed_regions?: string[];
  blocked_regions?: string[];
  starts_at: string;
  ends_at?: string;
};

@Injectable()
export class CreateCouponUseCase {
  private readonly logger = new Logger(CreateCouponUseCase.name);

  constructor(@Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository) {}

  async execute(input: CreateCouponInput) {
    const coupon = CouponEntity.create({
      merchant_id: input.merchant_id,
      code: input.code,
      discount_type: input.discount_type,
      discount_value: input.discount_value,
      min_cart_total: input.min_cart_total ?? null,
      max_usages: input.max_usages ?? null,
      max_per_buyer: input.max_per_buyer ?? null,
      allowed_skus: input.allowed_skus ?? [],
      blocked_skus: input.blocked_skus ?? [],
      allowed_regions: input.allowed_regions ?? [],
      blocked_regions: input.blocked_regions ?? [],
      starts_at: input.starts_at,
      ends_at: input.ends_at ?? null
    });
    await this.repo.save(coupon);
    return coupon.snapshot();
  }
}
