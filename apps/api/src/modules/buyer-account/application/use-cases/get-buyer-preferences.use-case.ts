import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";

export interface BuyerPreferencesDto {
  email_opt_in: boolean;
  sms_opt_in: boolean;
  whatsapp_opt_in: boolean;
  push_notifications_enabled: boolean;
  m2m_negotiation_enabled: boolean;
  language: string;
}

const DEFAULTS: BuyerPreferencesDto = {
  email_opt_in: true,
  sms_opt_in: true,
  whatsapp_opt_in: true,
  push_notifications_enabled: false,
  m2m_negotiation_enabled: false,
  language: "pt-BR",
};

@Injectable()
export class GetBuyerPreferencesUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(globalUserId: string): Promise<BuyerPreferencesDto> {
    const row = await (this.prisma as any).buyerPreference.findUnique({
      where: { globalUserId },
    });
    if (!row) return DEFAULTS;
    return {
      email_opt_in: row.emailOptIn,
      sms_opt_in: row.smsOptIn,
      whatsapp_opt_in: row.whatsappOptIn,
      push_notifications_enabled: row.pushNotificationsEnabled,
      m2m_negotiation_enabled: row.m2mNegotiationEnabled,
      language: row.language,
    };
  }
}
