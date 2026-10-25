import { Controller, Post, Body, Inject, Optional } from "@nestjs/common";
import { QuoteShippingUseCase } from "../../application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "../../application/use-cases/select-shipping-method.use-case.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";

/**
 * P0 fix: changed path from "embed/shipping" to "widget/shipping" to eliminate
 * the route collision with the authenticated EmbedShippingController which also
 * registers @Controller("embed/shipping"). The unauthenticated widget controller
 * is @NonProductionRoute (dev/test only) and must not shadow the production
 * embed route.
 */
@NonProductionRoute()
@Controller("widget/shipping")
export class WidgetShippingController {
  constructor(
    private readonly quoteShipping: QuoteShippingUseCase,
    private readonly selectMethod: SelectShippingMethodUseCase,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRulesRepo?: MerchantRulesRepository
  ) {}

  @Post("quote")
  async quote(@Body() body: { session_id: string; merchant_id: string; destination_zip: string; cart_total: number }) {
    const rules = await this.merchantRulesRepo?.getRules(body.merchant_id);
    // P0 fix: free_shipping_threshold is no longer accepted from request body.
    // The use-case derives the threshold from merchant rules via its own
    // MERCHANT_RULES_REPOSITORY injection.
    return this.quoteShipping.execute({ ...body, origin_zip: rules?.originZip ?? "" });
  }

  @Post("select")
  async select(@Body() body: { session_id: string; merchant_id: string; carrier_key: string }) {
    return this.selectMethod.execute(body);
  }
}
