import { BadRequestException, Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { normalCheckoutCrossSellScopeSchema, normalCheckoutCrossSellQuoteRequestSchema,
  normalCheckoutCrossSellQuoteSchema, normalCheckoutCrossSellAcceptanceSchema,
  normalCheckoutCrossSellAcknowledgementSchema, normalCheckoutCrossSellHttpAcceptanceResponseSchema,
  type NormalCheckoutCrossSellHttpAcceptanceResponse } from "@zyon/contracts";
import { NORMAL_CHECKOUT_CROSS_SELL, type NormalCheckoutCrossSellPort } from "../../domain/ports/normal-checkout-cross-sell.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { normalCrossSellPublicSession, normalCrossSellPublicTheme, normalCrossSellPublicPoliciesSchema } from "../services/normal-cross-sell-public-projection.js";

@Injectable()
export class NormalCheckoutCrossSellUseCase {
  constructor(@Inject(NORMAL_CHECKOUT_CROSS_SELL) private readonly normal: NormalCheckoutCrossSellPort,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: Pick<MerchantRepository, "getProfile" | "getExistingRules">) {}

  async quote(rawScope: unknown, rawRequest: unknown) {
    const scope = normalCheckoutCrossSellScopeSchema.parse(rawScope);
    const request = normalCheckoutCrossSellQuoteRequestSchema.parse(rawRequest);
    const quote = normalCheckoutCrossSellQuoteSchema.parse(await this.normal.quote(scope, request));
    if (quote.merchantId !== scope.merchantId || quote.sessionId !== scope.sessionId || quote.suggestionId !== request.suggestion_id)
      throw new InternalServerErrorException("cross_sell_quote_scope_invalid");
    const selected = request.targets.map(target => JSON.stringify([target.sku, target.variant_id, target.quantity,
      [...(target.selected_option_item_ids ?? [])].sort()])).sort();
    const quoted = quote.pricing.targets.map(target => JSON.stringify([target.sku, target.variantId, target.acceptedQuantity,
      [...(target.selectedOptionItemIds ?? [])].sort()])).sort();
    if (JSON.stringify(selected) !== JSON.stringify(quoted)) throw new InternalServerErrorException("cross_sell_quote_targets_invalid");
    return quote;
  }

  async accept(rawScope: unknown, rawRequest: unknown): Promise<NormalCheckoutCrossSellHttpAcceptanceResponse> {
    const scope = normalCheckoutCrossSellScopeSchema.parse(rawScope);
    const request = normalCheckoutCrossSellAcceptanceSchema.parse(rawRequest), quote = request.expected_quote;
    if (quote.merchantId !== scope.merchantId || quote.sessionId !== scope.sessionId)
      throw new BadRequestException("cross_sell_quote_scope_invalid");
    // Intentionally outside projection catch: failed/unknown commit must not be
    // rewritten as an available/review response and NEVER auto-retried here.
    const rawAcknowledgement = await this.normal.accept(scope, request);
    const parsed = normalCheckoutCrossSellAcknowledgementSchema.safeParse(rawAcknowledgement);
    const hash = createHash("sha256").update(JSON.stringify(quote)).digest("hex");
    if (!parsed.success || parsed.data.merchantId !== scope.merchantId || parsed.data.sessionId !== scope.sessionId
      || parsed.data.suggestionId !== request.suggestion_id || parsed.data.persistenceVersion !== quote.sessionVersion + 1
      || parsed.data.quoteHash !== hash) throw new InternalServerErrorException("cross_sell_acknowledgement_invalid");
    const acknowledgement = parsed.data;
    try {
      const session = normalCrossSellPublicSession(await this.normal.read(scope), quote, acknowledgement.persistenceVersion);
      const merchant = await this.merchants.getProfile(scope.merchantId);
      const rules = await this.merchants.getExistingRules?.(scope.merchantId);
      if (!merchant || merchant.id !== scope.merchantId || !rules) throw new Error("cross_sell_projection_policy_missing");
      const policies = rules.policies === undefined ? undefined : normalCrossSellPublicPoliciesSchema.parse(rules.policies);
      const experience = buildExperienceFromSession(session, { merchantName: merchant.name,
        theme: normalCrossSellPublicTheme(merchant.theme), couponBoxEnabled: rules.couponBoxEnabled,
        rules: { ...rules, policies, cryptoPayments: undefined }, policies });
      return normalCheckoutCrossSellHttpAcceptanceResponseSchema.parse({ acknowledgement, projection_status: "available", experience, cart: session.cart });
    } catch {
      // Durable ACK remains authoritative. No writes, retries, synthetic agent
      // success messages or raw exception details are emitted after commit.
      return { acknowledgement, projection_status: "requires_review" };
    }
  }
}
