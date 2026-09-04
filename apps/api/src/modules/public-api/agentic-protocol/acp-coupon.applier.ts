import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { DEFAULT_MERCHANT_RULES, type CheckoutSession } from "@zyon/shared-types";
import {
  COUPON_REPOSITORY,
  type CouponRepository,
} from "../../coupons/domain/ports/coupon-repository.port.js";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository,
} from "../../merchant/domain/ports/merchant-rules.repository.port.js";
import { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";

/**
 * Applies a coupon code to the active session via the platform's
 * {@link ApplyCouponUseCase}. Looks up the coupon, fetches the merchant's
 * discount rules (falling back to {@link DEFAULT_MERCHANT_RULES}), and
 * delegates to the use case. Source is reported as `manual`.
 */
@Injectable()
export class AcpCouponApplier {
  constructor(
    private readonly applyCouponUseCase: ApplyCouponUseCase,
    @Optional() @Inject(COUPON_REPOSITORY) private readonly coupons?: CouponRepository,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY)
    private readonly merchantRules?: MerchantRulesRepository,
  ) {}

  async applyCoupon(session: CheckoutSession, code: string): Promise<void> {
    if (!this.coupons) throw new BadRequestException("acp_coupons_unavailable");

    const trimmed = code.trim();
    if (!trimmed) throw new BadRequestException("acp_coupon_code_required");

    const coupon = await this.coupons.findByCode(
      session.merchantId,
      trimmed.toUpperCase(),
    );
    if (!coupon) throw new NotFoundException("acp_coupon_not_found");

    const rules =
      (await this.merchantRules?.getRules(session.merchantId)) ?? DEFAULT_MERCHANT_RULES;

    await this.applyCouponUseCase.execute({
      merchant_id: session.merchantId,
      session_id: session.sessionId,
      code: trimmed,
      cart: session.cart,
      merchantRules: rules,
      buyer_global_user_id: session.globalUserId,
      source: "manual",
    });
  }
}
