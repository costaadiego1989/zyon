import { Controller, Post, Body } from "@nestjs/common";
import type { Cart } from "@aacp/shared-types";
import { ListEligibleCrossSellsUseCase } from "../../application/use-cases/list-eligible-cross-sells.use-case.js";
import { AcceptCrossSellSuggestionUseCase } from "../../application/use-cases/accept-cross-sell-suggestion.use-case.js";
import { DeclineCrossSellSuggestionUseCase } from "../../application/use-cases/decline-cross-sell-suggestion.use-case.js";

@Controller("embed/cross-sell")
export class WidgetCrossSellController {
  constructor(
    private readonly listEligible: ListEligibleCrossSellsUseCase,
    private readonly accept: AcceptCrossSellSuggestionUseCase,
    private readonly decline: DeclineCrossSellSuggestionUseCase
  ) {}

  @Post("suggest")
  async suggest(@Body() body: { session_id: string; merchant_id: string; cart: Cart; agent_copy?: string }) {
    return this.listEligible.execute(body);
  }

  @Post("accept")
  async acceptSuggestion(@Body() body: { suggestion_id: string; merchant_id: string; session_id: string; accepted_skus: string[] }) {
    return this.accept.execute(body);
  }

  @Post("decline")
  async declineSuggestion(@Body() body: { suggestion_id: string; merchant_id: string; session_id: string }) {
    return this.decline.execute(body);
  }
}
