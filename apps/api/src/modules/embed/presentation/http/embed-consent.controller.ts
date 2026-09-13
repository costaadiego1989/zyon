import { BadRequestException, Controller, Post, Put, Get, Body, Query, UseGuards, Inject, Optional, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { BUYER_INTENT_CONSENT_REPOSITORY } from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import type { BuyerIntentConsentRepositoryPort } from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "./embed-checkout.controller.js";
import { RequireEmbedScope } from "./embed-scope.decorator.js";
import { CampaignContactConsentService, type CampaignContactChannel } from "../../../campaign-consent/campaign-contact-consent.service.js";

/**
 * ConsentRecord — LGPD Art. 8 explicit consent for intent memory.
 * Feature 4: Customer Intent Memory
 */
interface ConsentRecord {
  session_id: string;
  global_user_id: string;
  opted_in: boolean;
}

interface ConsentResponse {
  success: boolean;
  message: string;
}

interface CampaignConsentRecord {
  session_id: string;
  opted_in: boolean;
  channels: CampaignContactChannel[];
  policy_version: string;
}

interface CampaignConsentResponse extends ConsentResponse {
  channels: CampaignContactChannel[];
}

interface CampaignConsentReplace {
  session_id: string;
  channels: CampaignContactChannel[];
  policy_version: string;
}

@Controller("embed/checkout/consent")
export class EmbedConsentController {
  constructor(
    @Optional()
    @Inject(BUYER_INTENT_CONSENT_REPOSITORY)
    private readonly consentRepo?: BuyerIntentConsentRepositoryPort,
    @Optional() private readonly checkout?: EmbedCheckoutGuardHelper,
    @Optional() private readonly campaignConsent?: CampaignContactConsentService,
  ) {}

  /**
   * POST /embed/checkout/consent
   *
   * Record buyer consent for intent memory (LGPD Art. 8).
   * Consent expires after 1 year (LGPD Art. 8 best practice).
   * No polling — widget calls this once per buyer when they click "Aceitar".
   */
  @Post()
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  async recordConsent(@Req() request: EmbedHttpRequest, @Body() body: ConsentRecord): Promise<ConsentResponse> {
    if (typeof body.session_id !== "string" || !body.session_id.trim() || typeof body.opted_in !== "boolean") {
      throw new BadRequestException("consent_fields_invalid");
    }
    if (!request.embedClaims || !this.checkout) throw new UnauthorizedException("consent_checkout_context_required");
    await this.checkout.assertSessionBelongsToEmbedMerchant(request.embedClaims, body.session_id);
    const session = await this.checkout.loadSession(request.embedClaims.merchantId, body.session_id);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    if (body.global_user_id !== undefined && body.global_user_id !== session.globalUserId) {
      throw new UnauthorizedException("consent_buyer_mismatch");
    }

    if (!this.consentRepo) {
      // Fallback: repository not wired (should not happen in production).
      return {
        success: false,
        message: "Intent memory repository not available",
      };
    }

    if (!body.opted_in) {
      // This is an idempotent erasure request. The database relation cascades
      // to the buyer's intent records for this merchant.
      await this.consentRepo.deleteConsent(session.merchantId, session.globalUserId);
    } else {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      await this.consentRepo.saveConsent({
        merchant_id: session.merchantId,
        global_user_id: session.globalUserId,
        opted_in: true,
        expires_at: expiresAt.toISOString(),
        updated_at: now.toISOString(),
      });
    }

    return {
      success: true,
      message: body.opted_in
        ? "Consentimento registrado com sucesso"
        : "Consentimento removido",
    };
  }

  @Post("campaigns")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  async recordCampaignConsent(@Req() request: EmbedHttpRequest, @Body() body: CampaignConsentRecord): Promise<ConsentResponse> {
    if (typeof body.session_id !== "string" || !body.session_id.trim()
      || typeof body.opted_in !== "boolean"
      || !Array.isArray(body.channels) || body.channels.length === 0
      || body.channels.some((channel) => channel !== "email" && channel !== "whatsapp")
      || typeof body.policy_version !== "string" || !body.policy_version.trim() || body.policy_version.length > 80) {
      throw new BadRequestException("campaign_consent_fields_invalid");
    }
    if (!request.embedClaims || !this.checkout) throw new UnauthorizedException("consent_checkout_context_required");
    if (!this.campaignConsent) throw new ServiceUnavailableException("campaign_consent_unavailable");
    await this.checkout.assertSessionBelongsToEmbedMerchant(request.embedClaims, body.session_id);
    const session = await this.checkout.loadSession(request.embedClaims.merchantId, body.session_id);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    const input = {
      merchantId: session.merchantId,
      globalUserId: session.globalUserId,
      channels: [...new Set(body.channels)],
      policyVersion: body.policy_version.trim(),
      source: "embedded_checkout",
      evidence: { checkoutSessionId: session.sessionId, embedNonce: request.embedClaims.nonce },
    };
    if (body.opted_in) await this.campaignConsent.grant(input);
    else await this.campaignConsent.revoke(input);
    return { success: true, message: body.opted_in ? "AutorizaÃ§Ã£o de contato registrada" : "AutorizaÃ§Ã£o de contato removida" };
  }

  @Put("campaigns")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  async replaceCampaignConsent(@Req() request: EmbedHttpRequest, @Body() body: CampaignConsentReplace): Promise<ConsentResponse> {
    if (typeof body.session_id !== "string" || !body.session_id.trim()
      || !Array.isArray(body.channels)
      || body.channels.some((channel) => channel !== "email" && channel !== "whatsapp")
      || typeof body.policy_version !== "string" || !body.policy_version.trim() || body.policy_version.length > 80) {
      throw new BadRequestException("campaign_consent_fields_invalid");
    }
    if (!request.embedClaims || !this.checkout) throw new UnauthorizedException("consent_checkout_context_required");
    if (!this.campaignConsent) throw new ServiceUnavailableException("campaign_consent_unavailable");
    await this.checkout.assertSessionBelongsToEmbedMerchant(request.embedClaims, body.session_id);
    const session = await this.checkout.loadSession(request.embedClaims.merchantId, body.session_id);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    await this.campaignConsent.replace({
      merchantId: session.merchantId,
      globalUserId: session.globalUserId,
      channels: [...new Set(body.channels)],
      policyVersion: body.policy_version.trim(),
      source: "embedded_checkout",
      evidence: { checkoutSessionId: session.sessionId, embedNonce: request.embedClaims.nonce },
    });
    return { success: true, message: "Preferências de contato atualizadas" };
  }

  @Get("campaigns")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  async getCampaignConsent(@Req() request: EmbedHttpRequest, @Query("session_id") sessionId: string): Promise<CampaignConsentResponse> {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new BadRequestException("campaign_consent_session_invalid");
    }
    if (!request.embedClaims || !this.checkout) throw new UnauthorizedException("consent_checkout_context_required");
    if (!this.campaignConsent) throw new ServiceUnavailableException("campaign_consent_unavailable");
    await this.checkout.assertSessionBelongsToEmbedMerchant(request.embedClaims, sessionId);
    const session = await this.checkout.loadSession(request.embedClaims.merchantId, sessionId);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    const channels = await this.campaignConsent.getGrantedChannels({
      merchantId: session.merchantId,
      globalUserId: session.globalUserId,
    });
    return { success: true, message: "Autorizações de contato carregadas", channels };
  }
}
