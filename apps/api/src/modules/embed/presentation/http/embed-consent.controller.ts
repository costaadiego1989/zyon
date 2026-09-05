import { BadRequestException, Controller, Post, Body, UseGuards, Inject, Optional, Req, UnauthorizedException } from "@nestjs/common";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { BUYER_INTENT_CONSENT_REPOSITORY } from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import type { BuyerIntentConsentRepositoryPort } from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "./embed-checkout.controller.js";
import { RequireEmbedScope } from "./embed-scope.decorator.js";

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

@Controller("embed/checkout/consent")
export class EmbedConsentController {
  constructor(
    @Optional()
    @Inject(BUYER_INTENT_CONSENT_REPOSITORY)
    private readonly consentRepo?: BuyerIntentConsentRepositoryPort,
    @Optional() private readonly checkout?: EmbedCheckoutGuardHelper,
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

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    await this.consentRepo.saveConsent({
      merchant_id: session.merchantId,
      global_user_id: session.globalUserId,
      opted_in: body.opted_in,
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    });

    return {
      success: true,
      message: body.opted_in
        ? "Consentimento registrado com sucesso"
        : "Consentimento rejeitado",
    };
  }
}
