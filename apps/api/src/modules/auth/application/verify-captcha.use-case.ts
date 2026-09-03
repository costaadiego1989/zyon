import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  CAPTCHA_VERIFIER,
  type CaptchaVerifier,
} from "../domain/ports/captcha-verifier.port.js";

export interface VerifyCaptchaResult {
  /** True when the request may proceed (verified OR captcha disabled). */
  allowed: boolean;
  reason?: string;
}

/**
 * Verifies a captcha token for auth flows (login + register).
 *
 * Policy:
 * - When TURNSTILE_SECRET_KEY is unset (adapter returns "not-configured"), the
 *   use-case ALLOWS the request. This keeps local dev and CI working without a
 *   Cloudflare account. In production the secret MUST be set, which flips this
 *   to enforcing.
 * - When configured, a missing or invalid token is BLOCKED.
 *
 * The verifier port is @Optional so the module still boots (and tests that
 * don't wire a verifier still pass) — a missing verifier is treated as
 * "captcha disabled".
 */
@Injectable()
export class VerifyCaptchaUseCase {
  constructor(
    @Optional() @Inject(CAPTCHA_VERIFIER) private readonly verifier?: CaptchaVerifier,
  ) {}

  async execute(input: { token?: string; remoteIp?: string }): Promise<VerifyCaptchaResult> {
    if (!this.verifier) {
      return { allowed: true, reason: "no-verifier" };
    }

    const result = await this.verifier.verify({
      token: input.token ?? "",
      remoteIp: input.remoteIp,
    });

    // Captcha not configured on the server → allow (paired with front-end that
    // also has no site key). Any other failure → block.
    if (!result.success && result.reason === "not-configured") {
      return { allowed: true, reason: "not-configured" };
    }
    return { allowed: result.success, reason: result.reason };
  }
}
