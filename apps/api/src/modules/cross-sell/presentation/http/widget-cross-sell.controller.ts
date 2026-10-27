import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { normalCheckoutCrossSellHttpQuoteSchema, normalCheckoutCrossSellHttpAcceptanceSchema } from "@zyon/contracts";
import type { Cart } from "@zyon/shared-types";
import { ListEligibleCrossSellsUseCase } from "../../application/use-cases/list-eligible-cross-sells.use-case.js";
import { AcceptCrossSellFromWidgetUseCase } from "../../application/use-cases/accept-cross-sell-from-widget.use-case.js";
import { DeclineCrossSellSuggestionUseCase } from "../../application/use-cases/decline-cross-sell-suggestion.use-case.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { RequireEmbedScope } from "../../../embed/presentation/http/embed-scope.decorator.js";
import { NormalCheckoutCrossSellUseCase } from "../../application/use-cases/normal-checkout-cross-sell.use-case.js";

const legacyId = z.string().min(1).max(191).refine(value => value.trim().length > 0 && !value.includes("\0"));
const legacyAcceptance = z.strictObject({ suggestion_id: legacyId, session_id: legacyId,
  accepted_skus: z.array(legacyId).min(1).max(200).refine(values => new Set(values).size === values.length) });

@UseGuards(EmbedAuthGuard)
@Controller("embed/cross-sell")
export class WidgetCrossSellController {
  constructor(
    private readonly listEligible: ListEligibleCrossSellsUseCase,
    private readonly acceptFromWidget: AcceptCrossSellFromWidgetUseCase,
    private readonly decline: DeclineCrossSellSuggestionUseCase,
    private readonly embedGuards: EmbedCheckoutGuardHelper,
    private readonly normalCrossSell: NormalCheckoutCrossSellUseCase
  ) {}

  @Post("suggest")
  async suggest(@Req() request: EmbedHttpRequest, @Body() body: { session_id: string; cart: Cart; agent_copy?: string }) {
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.listEligible.execute({ ...body, merchant_id: embed.merchantId });
  }

  @Post("quote")
  @RequireEmbedScope("offers:apply")
  async quote(@Req() request: EmbedHttpRequest, @Body() body: unknown) {
    const parsed = normalCheckoutCrossSellHttpQuoteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("cross_sell_quote_payload_invalid");
    const embed = request.embedClaims!;
    const { session_id, ...selection } = parsed.data;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, session_id);
    return this.normalCrossSell.quote({ merchantId: embed.merchantId, sessionId: session_id }, selection);
  }

  @Post("accept")
  @RequireEmbedScope("offers:apply")
  async acceptSuggestion(
    @Req() request: EmbedHttpRequest,
    @Body() body: unknown
  ) {
    const hasQuote = body !== null && typeof body === "object" && Object.hasOwn(body, "expected_quote");
    if (hasQuote) {
      const parsed = normalCheckoutCrossSellHttpAcceptanceSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException("cross_sell_accept_payload_invalid");
      const embed = request.embedClaims!;
      const { session_id, ...acceptance } = parsed.data;
      await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, session_id);
      return this.normalCrossSell.accept({ merchantId: embed.merchantId, sessionId: session_id }, acceptance);
    }
    const parsed = legacyAcceptance.safeParse(body);
    if (!parsed.success) throw new BadRequestException("cross_sell_accept_payload_invalid");
    const input = parsed.data;
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, input.session_id);
    return this.acceptFromWidget.execute({
      suggestion_id: input.suggestion_id,
      merchant_id: embed.merchantId,
      session_id: input.session_id,
      accepted_skus: input.accepted_skus
    });
  }

  @Post("decline")
  async declineSuggestion(@Req() request: EmbedHttpRequest, @Body() body: { suggestion_id: string; session_id: string }) {
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.decline.execute({ ...body, merchant_id: embed.merchantId });
  }
}
