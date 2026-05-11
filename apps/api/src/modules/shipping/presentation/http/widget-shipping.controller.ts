import { Controller, Post, Body } from "@nestjs/common";
import { QuoteShippingUseCase } from "../../application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "../../application/use-cases/select-shipping-method.use-case.js";

@Controller("embed/shipping")
export class WidgetShippingController {
  constructor(
    private readonly quoteShipping: QuoteShippingUseCase,
    private readonly selectMethod: SelectShippingMethodUseCase
  ) {}

  @Post("quote")
  async quote(@Body() body: { session_id: string; merchant_id: string; destination_zip: string; cart_total: number; free_shipping_threshold?: number }) {
    return this.quoteShipping.execute(body);
  }

  @Post("select")
  async select(@Body() body: { session_id: string; merchant_id: string; carrier_key: string }) {
    return this.selectMethod.execute(body);
  }
}
