import { Controller, Post, Body, UseGuards, Inject, Optional } from "@nestjs/common";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { BUYER_INTENT_CONSENT_REPOSITORY } from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import type { BuyerIntentConsentRepositoryPort } from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";

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
  async recordConsent(@Body() body: ConsentRecord): Promise<ConsentResponse> {
    if (!body.session_id || !body.global_user_id || body.opted_in === undefined) {
      return {
        success: false,
        message: "Validation error: missing required fields",
      };
    }

    if (!this.consentRepo) {
      // Fallback: repository not wired (should not happen in production).
      return {
        success: false,
        message: "Intent memory repository not available",
      };
    }

    // Extract merchant_id from the embed session token (set by EmbedAuthGuard).
    // For now, we extract from session_id (pattern: sess_{merchantId}_{randomId}).
    // A better approach: store merchant_id in the embed session token payload.
    const sessionParts = body.session_id.split("_");
    const merchantId = sessionParts[1] || "unknown";

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    await this.consentRepo.saveConsent({
      merchant_id: merchantId,
      global_user_id: body.global_user_id,
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
