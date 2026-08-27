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
