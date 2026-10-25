import { Injectable, Logger } from "@nestjs/common";
import type {
  CaptchaVerificationResult,
  CaptchaVerifier,
} from "../domain/ports/captcha-verifier.port.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare Turnstile siteverify adapter.
 *
 * Required env: TURNSTILE_SECRET_KEY. The use case rejects missing configuration
 * in production. Siteverify validates expiry and single use; expected action and
 * optional TURNSTILE_ALLOWED_HOSTNAMES bind tokens to their intended form/site.
 *
 * Reference: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
@Injectable()
export class CloudflareTurnstileAdapter implements CaptchaVerifier {
  private readonly logger = new Logger(CloudflareTurnstileAdapter.name);

  async verify(input: { token: string; remoteIp?: string; action?: string }): Promise<CaptchaVerificationResult> {
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) {
      return { success: false, reason: "not-configured" };
    }
    if (typeof input.token !== "string" || !input.token.trim()) {
      return { success: false, reason: "missing-token" };
    }
    if (input.token.length > 2048) return { success: false, reason: "invalid-token" };

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
        hostname?: string;
      };

      if (data.success !== true) {
        this.logger.warn(
          `Turnstile verification failed: ${(data["error-codes"] ?? []).join(",") || "no-error-codes"}`,
        );
        return { success: false, reason: "verification-failed" };
      }

      if (input.action && data.action !== input.action) {
        return { success: false, reason: "action-mismatch" };
      }
      const hostnames = (process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
        .split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
      if (hostnames.length && !hostnames.includes(data.hostname?.toLowerCase() ?? "")) {
        return { success: false, reason: "hostname-mismatch" };
      }
      return { success: true };
    } catch (err) {
      this.logger.error(`Turnstile verification error: ${(err as Error).message}`);
      return { success: false, reason: "verification-error" };
    }
  }
}
