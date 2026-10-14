import { Injectable, Inject } from "@nestjs/common";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";

@Injectable()
export class ToggleCouponActiveUseCase {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository,
    private readonly billing: BillingPlanMeteringService,
  ) {}

  async execute(input: { id: string; merchant_id: string; is_active: boolean }): Promise<void> {
    const coupon = await this.repo.findById(input.id, input.merchant_id);
    // Archive is terminal. Apart from preserving the audit trail, this makes
    // sure an archived coupon cannot be revived to bypass a plan downgrade.
    if (!coupon || coupon.status === "archived") return;
    if (input.is_active && coupon.status !== "active") {
      await this.billing.assertAllowed(input.merchant_id, { kind: "limit", key: "activeCoupons" });
    }
    await this.repo.updateActive(input.merchant_id, input.id, input.is_active);
  }
}
