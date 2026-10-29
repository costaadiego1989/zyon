import { HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DistributedRateLimitStore } from "./rate-limit.store.js";
import { RealtimeCapabilityService } from "../auth/realtime-capability.js";

export const AI_USER_MESSAGES_PER_MINUTE = 10;
export const AI_USER_WINDOW_MS = 60_000;

/** Dedicated Redis namespace: HTTP, sockets and voice share one user bucket. Kong/global buckets are untouched. */
@Injectable()
export class AiUserRateLimitService {
  constructor(@Inject(DistributedRateLimitStore) private readonly store: DistributedRateLimitStore) {}

  async consume(userId: string) {
    if (!userId || userId.length > 250) throw new UnauthorizedException("ai_user_identity_required");
    try {
      const key = createHash("sha256").update(userId).digest("hex");
      return { ...await this.store.hit(`ai:user:${key}`, AI_USER_MESSAGES_PER_MINUTE, AI_USER_WINDOW_MS), limit: AI_USER_MESSAGES_PER_MINUTE };
    } catch { throw new ServiceUnavailableException({ code: "ai_rate_limit_unavailable" }); }
  }

  async assertAllowed(userId: string) {
    const decision = await this.consume(userId);
    if (!decision.allowed) throw new HttpException({ code: "ai_interaction_rate_limited", scope: "user", retry_after_seconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)) }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Automatic suggestions get their own small bucket and cannot spend the buyer's ten messages. */
  async assertNudgeAllowed(userId: string) {
    if (!userId || userId.length > 250) throw new UnauthorizedException("ai_user_identity_required");
    let decision;
    try { decision = await this.store.hit(`ai:nudge:${createHash("sha256").update(userId).digest("hex")}`, 2, AI_USER_WINDOW_MS); }
    catch { throw new ServiceUnavailableException({ code: "ai_rate_limit_unavailable" }); }
    if (!decision.allowed) throw new HttpException({ code: "ai_nudge_rate_limited", retry_after_seconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)) }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** A voice handoff reuses its admitted turn exactly once; the browser cannot exempt a new message. */
  async consumeVoicePermit(token: unknown, input: { userId: string; merchantId: string; resourceId: string; origin?: string }) {
    if (!token) return false;
    let claims;
    try {
      claims = new RealtimeCapabilityService().verify(token, "ai-voice-turn", input.origin);
      if (claims.aiUserId !== input.userId || claims.merchantId !== input.merchantId || claims.resourceId !== input.resourceId) throw new Error();
    } catch { throw new UnauthorizedException("invalid_voice_turn_token"); }
    let decision;
    try { decision = await this.store.hit(`ai:voice-permit:${claims.nonce}`, 1, 3600_000); }
    catch { throw new ServiceUnavailableException({ code: "ai_rate_limit_unavailable" }); }
    if (!decision.allowed) throw new UnauthorizedException("voice_turn_already_consumed");
    return true;
  }
}
