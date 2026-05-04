import { Body, Controller, Get, Put, Req, Query, UseGuards, BadRequestException } from "@nestjs/common";
import type { BuyerNegotiationPreferences } from "@aacp/negotiation-engine";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import {
  GetBuyerAgentPreferencesUseCase,
  UpsertBuyerAgentPreferencesUseCase
} from "../../application/buyer-agent-preferences.use-cases.js";

@UseGuards(AuthGuard)
@Controller("buyer-agent")
export class BuyerAgentNegotiationPreferencesController {
  constructor(
    private readonly getPrefs: GetBuyerAgentPreferencesUseCase,
    private readonly upsertPrefs: UpsertBuyerAgentPreferencesUseCase
  ) {}

  @Get("preferences")
  async get(
    @Req() request: unknown,
    @Query("global_user_id") globalUserId?: string
  ) {
    const user = currentUser(request as { user?: unknown });
    const resolved = await this.getPrefs.executeResolved({
      merchantId: user.merchantId,
      globalUserId: globalUserId ?? undefined
    });
    const hasCustom =
      !!globalUserId?.trim() &&
      (await this.getPrefs.hasStoredPreferences(user.merchantId, globalUserId.trim()));

    return { has_custom_preferences: hasCustom, preferences: resolved };
  }

  @Put("preferences")
  async put(
    @Req() request: unknown,
    @Query("global_user_id") globalUserId: string | undefined,
    @Body() body: BuyerNegotiationPreferences
  ) {
    const user = currentUser(request as { user?: unknown });
    const uid = globalUserId?.trim();
    if (!uid) throw new BadRequestException("global_user_id_query_required");

    await this.upsertPrefs.execute({
      merchantId: user.merchantId,
      globalUserId: uid,
      preferences: body
    });

    const resolved = await this.getPrefs.executeResolved({
      merchantId: user.merchantId,
      globalUserId: uid
    });
    return { preferences: resolved };
  }
}
