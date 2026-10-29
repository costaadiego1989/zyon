import { Module } from "@nestjs/common";
import { CampaignContactConsentService } from "./campaign-contact-consent.service.js";

@Module({ providers: [CampaignContactConsentService], exports: [CampaignContactConsentService] })
export class CampaignConsentModule {}
