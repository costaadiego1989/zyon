import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { BILLING_PLANS } from "@zyon/shared-types";
import { BillingPlanMeteringService } from "../../payment/infrastructure/billing/billing-plan-guard.js";
import {
  VOICE_SESSION_QUOTA_REPOSITORY,
  type VoiceSessionQuotaRepository,
  type VoiceSessionReservation,
} from "../domain/ports/voice-session-quota.repository.port.js";

export const VOICE_SESSION_QUOTA_CLOCK = Symbol("VOICE_SESSION_QUOTA_CLOCK");

export type VoiceSessionAdmission = VoiceSessionReservation & {
  alreadyReserved: boolean;
};

@Injectable()
export class VoiceSessionQuotaService {
  constructor(
    @Inject(VOICE_SESSION_QUOTA_REPOSITORY) private readonly repository: VoiceSessionQuotaRepository,
    private readonly billing: BillingPlanMeteringService,
    @Inject(VOICE_SESSION_QUOTA_CLOCK) private readonly clock: () => Date,
  ) {}

  async reserve(input: {
    merchantId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<VoiceSessionAdmission> {
    const merchantId = required(input.merchantId, "voice_session_merchant_required");
    const idempotencyKey = required(input.idempotencyKey, "voice_session_idempotency_key_required");
    const requestFingerprint = required(input.requestFingerprint, "voice_session_request_fingerprint_required");
    const now = this.clock();

    await this.billing.assertAllowed(merchantId, { kind: "feature", key: "voiceCheckout" });
    const billingAccountMerchantId = await this.billing.resolveBillingAccountMerchantId(merchantId);
    const plan = await this.billing.getEffectivePlan(billingAccountMerchantId, now);
    const limit = BILLING_PLANS[plan].limits.voiceSessionsPerMonth;
    const result = await this.repository.reserve({
      merchantId: billingAccountMerchantId,
      idempotencyKey: `${merchantId}:${idempotencyKey}`,
      requestFingerprint,
      limit,
      period: voiceSessionPeriod(now),
    });

    if (result.status === "reserved") return { ...result.reservation, alreadyReserved: false };
    if (result.status === "already_reserved") return { ...result.reservation, alreadyReserved: true };
    if (result.status === "idempotency_conflict") {
      throw new ForbiddenException({ code: "voice_session_idempotency_conflict" });
    }
    throw new ForbiddenException({
      code: "voice_session_limit_exceeded",
      plan,
      current: result.used,
      attempted: result.used + 1,
      limit,
      required_plan: plan === "growth" ? "scale" : "contact_support",
      usage_period_start: voiceSessionPeriod(now).start.toISOString(),
    });
  }

  markProviderCallCreated(sessionId: string): Promise<void> {
    return this.repository.markProviderCallCreated(required(sessionId, "voice_session_id_required"));
  }

  markProviderCallUnknown(sessionId: string): Promise<void> {
    return this.repository.markProviderCallUnknown(required(sessionId, "voice_session_id_required"));
  }

  releaseBeforeProviderCall(sessionId: string): Promise<void> {
    return this.repository.releaseBeforeProviderCall(required(sessionId, "voice_session_id_required"));
  }
}

export function voiceSessionPeriod(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
