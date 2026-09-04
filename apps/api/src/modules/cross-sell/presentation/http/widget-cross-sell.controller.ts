import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Cart } from "@zyon/shared-types";
import { ListEligibleCrossSellsUseCase } from "../../application/use-cases/list-eligible-cross-sells.use-case.js";
import { AcceptCrossSellFromWidgetUseCase } from "../../application/use-cases/accept-cross-sell-from-widget.use-case.js";
import { DeclineCrossSellSuggestionUseCase } from "../../application/use-cases/decline-cross-sell-suggestion.use-case.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";

@UseGuards(EmbedAuthGuard)
@Controller("embed/cross-sell")
export class WidgetCrossSellController {
  constructor(
    private readonly listEligible: ListEligibleCrossSellsUseCase,
    private readonly acceptFromWidget: AcceptCrossSellFromWidgetUseCase,
    private readonly decline: DeclineCrossSellSuggestionUseCase,
    private readonly embedGuards: EmbedCheckoutGuardHelper
  ) {}

  @Post("suggest")
  async suggest(@Req() request: EmbedHttpRequest, @Body() body: { session_id: string; cart: Cart; agent_copy?: string }) {
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.listEligible.execute({ ...body, merchant_id: embed.merchantId });
  }

  @Post("accept")
  async acceptSuggestion(
    @Req() request: EmbedHttpRequest,
    @Body() body: { suggestion_id: string; session_id: string; accepted_skus: string[] }
  ) {
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.acceptFromWidget.execute({
      suggestion_id: body.suggestion_id,
      merchant_id: embed.merchantId,
      session_id: body.session_id,
      accepted_skus: body.accepted_skus
    });
  }

  @Post("decline")
  async declineSuggestion(@Req() request: EmbedHttpRequest, @Body() body: { suggestion_id: string; session_id: string }) {
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.decline.execute({ ...body, merchant_id: embed.merchantId });
  }
}
