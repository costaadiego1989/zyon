import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";

/** Shares the atomic checkout coupon path with the widget. */
@Injectable()
export class AcpCouponApplier {
  constructor(@Inject(ApplyCouponUseCase) private readonly applyCouponUseCase: Pick<ApplyCouponUseCase, "executeForCheckout">) {}

  async applyCoupon(session: CheckoutSession, code: string): Promise<void> {
    const trimmed = code.trim();
    if (!trimmed) throw new BadRequestException("acp_coupon_code_required");
    await this.applyCouponUseCase.executeForCheckout({
      merchant_id: session.merchantId, session_id: session.sessionId,
      code: trimmed, expectedVersion: session.persistenceVersion,
    });
  }
}
