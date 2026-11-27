import { Module } from "@nestjs/common";
import { CashbackCoreModule } from "./cashback.module.js";
import { CampaignConsentModule } from "../campaign-consent/campaign-consent.module.js";
import { WhatsAppTemplatesModule } from "../whatsapp-templates/whatsapp-templates.module.js";
import { CashbackNotificationService } from "./application/cashback-notification.service.js";

@Module({ imports: [CashbackCoreModule, CampaignConsentModule, WhatsAppTemplatesModule], providers: [CashbackNotificationService], exports: [CashbackNotificationService] })
export class CashbackCommunicationsModule {}
