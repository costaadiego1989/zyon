/**
 * Port for verifying bot-protection tokens (currently Cloudflare Turnstile).
 *
 * Returns a result rather than throwing — the auth controller maps invalid /
 * unverifiable results to a single 400 response. The port deliberately does
 * NOT expose the underlying provider's API shape so we can swap providers
 * (hCaptcha, reCAPTCHA) without touching callers.
 */
export const CAPTCHA_VERIFIER = Symbol("CaptchaVerifier");

export interface CaptchaVerificationResult {
  /** True only when the provider confirms the token is valid AND the challenge passed. */
  success: boolean;
  /** Short machine-readable code; e.g. "missing-token", "verification-failed", "timeout". */
  reason?: string;
}

export interface CaptchaVerifier {
  /**
   * Verifies a captcha token. `remoteIp` is optional but recommended — Cloudflare
   * uses it for additional risk signals. The implementation must NOT throw on
   * provider errors; instead it returns { success: false, reason }.
   */
  verify(input: { token: string; remoteIp?: string }): Promise<CaptchaVerificationResult>;
}
