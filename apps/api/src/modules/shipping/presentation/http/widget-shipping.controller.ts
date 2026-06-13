import { Controller, Post, Body, Inject, Optional } from "@nestjs/common";
import { QuoteShippingUseCase } from "../../application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "../../application/use-cases/select-shipping-method.use-case.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";

@NonProductionRoute()
@Controller("embed/shipping")
export class WidgetShippingController {
  constructor(
    private readonly quoteShipping: QuoteShippingUseCase,
    private readonly selectMethod: SelectShippingMethodUseCase,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRulesRepo?: MerchantRulesRepository
  ) {}

  @Post("quote")
  async quote(@Body() body: { session_id: string; merchant_id: string; destination_zip: string; cart_total: number; free_shipping_threshold?: number }) {
    const rules = await this.merchantRulesRepo?.getRules(body.merchant_id);
    return this.quoteShipping.execute({ ...body, origin_zip: rules?.originZip ?? "" });
  }

  @Post("select")
  async select(@Body() body: { session_id: string; merchant_id: string; carrier_key: string }) {
    return this.selectMethod.execute(body);
  }
}
