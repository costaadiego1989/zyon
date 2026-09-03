import { Injectable, Logger } from "@nestjs/common";
import type {
  CaptchaVerificationResult,
  CaptchaVerifier,
} from "../domain/ports/captcha-verifier.port.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare Turnstile siteverify adapter.
 *
 * Required env: TURNSTILE_SECRET_KEY. When unset the adapter is in DISABLED
 * mode — `verify` returns `{ success: false, reason: "not-configured" }` so
 * the caller can decide whether to allow or block the request. The auth
 * controller treats "not-configured" as "captcha not required" (skips) when
 * the front-end also has no site key (paired behaviour for local dev).
 *
 * Reference: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
@Injectable()
export class CloudflareTurnstileAdapter implements CaptchaVerifier {
  private readonly logger = new Logger(CloudflareTurnstileAdapter.name);

  async verify(input: { token: string; remoteIp?: string }): Promise<CaptchaVerificationResult> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      return { success: false, reason: "not-configured" };
    }
    if (!input.token) {
      return { success: false, reason: "missing-token" };
    }

    try {
      const body = new URLSearchParams();
      body.set("secret", secret);
      body.set("response", input.token);
      if (input.remoteIp) body.set("remoteip", input.remoteIp);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(SITEVERIFY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        this.logger.warn(`Turnstile siteverify HTTP ${res.status}`);
        return { success: false, reason: "verification-http-error" };
      }

      const data = (await res.json()) as {
        success?: boolean;
        "error-codes"?: string[];
        action?: string;
        cdata?: string;
      };

      if (data.success !== true) {
        this.logger.warn(
          `Turnstile verification failed: ${(data["error-codes"] ?? []).join(",") || "no-error-codes"}`,
        );
        return { success: false, reason: "verification-failed" };
      }

      return { success: true };
    } catch (err) {
      this.logger.error(`Turnstile verification error: ${(err as Error).message}`);
      return { success: false, reason: "verification-error" };
    }
  }
}
