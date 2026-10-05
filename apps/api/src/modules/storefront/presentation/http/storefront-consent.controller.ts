import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Put, Req, UseGuards } from "@nestjs/common";
import { BuyerJwtAuthGuard, currentBuyer } from "../../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import { CampaignContactConsentService, type CampaignContactChannel } from "../../../campaign-consent/campaign-contact-consent.service.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";

const POLICY_VERSION = "storefront_privacy_2026_10_05";

@Controller("storefront/stores/:merchantId/contact-consent")
@UseGuards(BuyerJwtAuthGuard)
export class StorefrontConsentController {
  constructor(
    private readonly consent: CampaignContactConsentService,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
  ) {}

  private async buyer(request: { user?: unknown }, merchantId: string) {
    const buyer = currentBuyer(request);
    if (buyer.merchantId && buyer.merchantId !== merchantId) throw new ForbiddenException("consent_merchant_mismatch");
    if (!/^[A-Za-z0-9_-]{1,191}$/.test(merchantId)) throw new BadRequestException("consent_merchant_invalid");
    if (!await this.merchants.getProfile(merchantId)) throw new NotFoundException("store_not_found");
    return buyer;
  }

  @Get()
  async get(@Req() request: { user?: unknown }, @Param("merchantId") merchantId: string) {
    const buyer = await this.buyer(request, merchantId);
    return { success: true, channels: await this.consent.getGrantedChannels({ merchantId, globalUserId: buyer.globalUserId }) };
  }

  @Put()
  async replace(@Req() request: { user?: unknown }, @Param("merchantId") merchantId: string,
    @Body() body: { channels?: unknown; policy_version?: unknown; decided_at?: unknown }) {
    if (!body || !Array.isArray(body.channels) || body.channels.length > 2
      || body.channels.some((channel) => channel !== "email" && channel !== "whatsapp")
      || body.policy_version !== POLICY_VERSION
      || typeof body.decided_at !== "string" || !Number.isFinite(Date.parse(body.decided_at))
      || Date.parse(body.decided_at) > Date.now() + 60_000) throw new BadRequestException("campaign_consent_fields_invalid");
    const buyer = await this.buyer(request, merchantId);
    await this.consent.replace({ merchantId, globalUserId: buyer.globalUserId,
      channels: [...new Set(body.channels)] as CampaignContactChannel[], policyVersion: POLICY_VERSION,
      source: "storefront_consent", evidence: { decidedAt: body.decided_at, recordedAt: new Date().toISOString() },
    });
    return { success: true };
  }
}
