import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
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
 * Enforces CAPTCHA on authentication and recovery. Only unconfigured local/CI
 * environments may skip verification; production and configured development
 * environments fail closed on missing, expired, reused or invalid tokens.
 */
@Injectable()
export class VerifyCaptchaUseCase {
  constructor(
    @Optional() @Inject(CAPTCHA_VERIFIER) private readonly verifier?: CaptchaVerifier,
  ) {}

  async execute(input: { token?: string; remoteIp?: string; action?: string }): Promise<VerifyCaptchaResult> {
    if (!this.verifier) {
      return { allowed: process.env.NODE_ENV !== "production", reason: "no-verifier" };
    }

    const result = await this.verifier.verify({
      token: input.token ?? "",
      remoteIp: input.remoteIp,
      action: input.action,
    });

    if (!result.success && result.reason === "not-configured") {
      return { allowed: process.env.NODE_ENV !== "production", reason: "not-configured" };
    }
    return { allowed: result.success, reason: result.reason };
  }

  async assertAllowed(input: { token?: string; remoteIp?: string; action?: string }): Promise<void> {
    const result = await this.execute(input);
    if (result.allowed) return;
    if (["not-configured", "no-verifier", "verification-error", "verification-http-error"].includes(result.reason ?? "")) {
      throw new ServiceUnavailableException({ code: "captcha_unavailable", message: "A verificação de segurança está indisponível. Tente novamente em instantes." });
    }
    throw new BadRequestException({ code: "captcha_invalid", message: "Conclua a verificação de segurança e tente novamente." });
  }
}
