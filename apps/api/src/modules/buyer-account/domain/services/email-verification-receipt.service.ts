import { UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../../../../shared/config/secret-config.js";

const PURPOSE = "buyer_registration";
const TTL_MS = 15 * 60 * 1000;

type ReceiptPayload = {
  email: string;
  purpose: typeof PURPOSE;
  exp: number;
};

/**
 * Short-lived proof that an email challenge was completed. It binds a browser
 * registration request to the OTP that the API consumed, instead of trusting a
 * client-side "verified" flag.
 */
export class EmailVerificationReceiptService {
  private readonly signingKey = requireSecret("BUYER_JWT_SECRET", "buyer-dev-secret-change-me");

  issue(email: string, now = Date.now()): string {
    const payload: ReceiptPayload = {
      email: normalizeEmail(email),
      purpose: PURPOSE,
      exp: now + TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${this.sign(encoded)}`;
  }

  assertValid(token: string | undefined, email: string, now = Date.now()): void {
    if (!token) throw new UnauthorizedException("email_verification_required");
    const parts = token.split(".");
    if (parts.length !== 2 || !safeEqual(parts[1], this.sign(parts[0]))) {
      throw new UnauthorizedException("email_verification_invalid");
    }

    let payload: ReceiptPayload;
    try {
      payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as ReceiptPayload;
    } catch {
      throw new UnauthorizedException("email_verification_invalid");
    }

    if (
      payload.purpose !== PURPOSE ||
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      payload.email !== normalizeEmail(email)
    ) {
      throw new UnauthorizedException("email_verification_invalid");
    }
  }

  private sign(value: string): string {
    return createHmac("sha256", this.signingKey).update(value).digest("base64url");
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
