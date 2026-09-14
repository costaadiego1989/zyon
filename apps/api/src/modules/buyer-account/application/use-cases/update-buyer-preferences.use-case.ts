import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";
import type { BuyerPreferencesDto } from "./get-buyer-preferences.use-case.js";

export interface UpdateBuyerPreferencesRequest {
  globalUserId: string;
  emailOptIn?: boolean;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
  pushNotificationsEnabled?: boolean;
  m2mNegotiationEnabled?: boolean;
  language?: string;
  oneBuyClickEnabled?: boolean;
  shippingPreference?: "fastest" | "cheapest";
  paymentPreference?: "pix" | "card";
}

@Injectable()
export class UpdateBuyerPreferencesUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(input: UpdateBuyerPreferencesRequest): Promise<BuyerPreferencesDto> {
    const { globalUserId, ...data } = input;

    const row = await (this.prisma as any).buyerPreference.upsert({
      where: { globalUserId },
      create: { globalUserId, ...data },
      update: data,
    });

    // This is a global buyer preference, so an opt-out applies to every
    // merchant queue that still holds a pending message for this buyer. The
    // per-merchant record is still checked immediately before any dispatch.
    const revokedChannels = [
      ...(data.emailOptIn === false ? ["email"] : []),
      ...(data.whatsappOptIn === false ? ["whatsapp"] : []),
    ];
    const scheduled = (this.prisma as any).postSaleScheduledMessage;
    if (revokedChannels.length > 0 && scheduled?.updateMany) {
      await scheduled.updateMany({
        where: { buyerId: globalUserId, channel: { in: revokedChannels }, status: "pending" },
        data: { status: "cancelled", failureReason: "buyer_global_opt_out" },
      });
    }

    return {
      email_opt_in: row.emailOptIn,
      sms_opt_in: row.smsOptIn,
      whatsapp_opt_in: row.whatsappOptIn,
      push_notifications_enabled: row.pushNotificationsEnabled,
      m2m_negotiation_enabled: row.m2mNegotiationEnabled,
      language: row.language,
      one_buy_click_enabled: row.oneBuyClickEnabled === true,
      shipping_preference: row.shippingPreference === "cheapest" ? "cheapest" : "fastest",
      payment_preference: row.paymentPreference === "card" ? "card" : "pix",
    };
  }
}
