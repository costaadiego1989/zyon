import { BadRequestException, Body, Controller, Inject, NotFoundException, Post, Req, UseGuards } from "@nestjs/common";
import type { Cart } from "@zyon/shared-types";
import { ApplyCouponUseCase } from "../../application/use-cases/apply-coupon.use-case.js";
import type { EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { EmbedCheckoutGuardHelper } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../../checkout/domain/checkout-experience.config.js";

@UseGuards(EmbedAuthGuard)
@Controller("embed/coupons")
export class WidgetCouponsController {
  constructor(
    private readonly applyCoupon: ApplyCouponUseCase,
    private readonly embedGuards: EmbedCheckoutGuardHelper,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 }
  ) {}

  @Post("apply")
  async apply(@Req() request: EmbedHttpRequest, @Body() body: {
    session_id: string;
    merchant_id: string;
    code: string;
    cart: Cart;
    buyer_global_user_id?: string;
    buyer_region?: string;
  }) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string" || typeof body.code !== "string") {
      throw new BadRequestException("session_id_and_coupon_code_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);

    // P3 fix: derive merchant_id from embed claims; fetch rules before use-case
    // so the rules-engine can authorize the discount (P0 fix).
    const [session, merchant, rules] = await Promise.all([
      this.sessions.getSession(embed.merchantId, body.session_id.trim()),
      this.merchants.getProfile(embed.merchantId),
      this.merchants.getRules(embed.merchantId),
    ]);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const result = await this.applyCoupon.execute({
      session_id: body.session_id.trim(),
      merchant_id: embed.merchantId, // derived from claims, never body
      code: body.code.trim(),
      cart: body.cart,
      merchantRules: rules, // P0: pass rules so engine can cap/reject discount
      buyer_global_user_id:
        typeof body.buyer_global_user_id === "string" ? body.buyer_global_user_id.trim() : undefined,
      buyer_region: typeof body.buyer_region === "string" ? body.buyer_region.trim() : undefined,
      source: "manual"
    });

    const next = {
      ...session,
      cart: {
        ...session.cart,
        currentDiscount: Math.max(session.cart.currentDiscount ?? 0, result.discount_applied)
      },
      updatedAt: new Date().toISOString()
    };
    await this.sessions.saveSession(next);
    return {
      ...result,
      experience: buildExperienceFromSession(next, {
        merchantName: merchant?.name,
        theme: merchant?.theme,
        couponBoxEnabled: rules.couponBoxEnabled,
        rules,
        serviceFee: this.experienceConfig.platformFeeBrl
      })
    };
  }
}
