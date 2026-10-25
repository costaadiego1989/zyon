import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { requireSecret } from "../../../shared/config/secret-config.js";

export const RECOVERY_LINK_TTL_SECONDS = 72 * 3600;
type Claims = { merchantId: string; sessionId: string; issuedAt: number; expiresAt: number };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);

/** The link identifies a purchase. Buyer authentication is still required to resume it. */
export class RecoveryLinkTokenService {
  constructor(private readonly secret?: string) {
    if (secret !== undefined && secret.length < 32) throw new Error("recovery_link_requires_configured_jwt_secret");
  }
  issue(merchantId: string, sessionId: string, now = Math.floor(Date.now() / 1000)): string {
    if (!id(merchantId) || !id(sessionId)) throw new Error("invalid_recovery_resource");
    const payload = Buffer.from(JSON.stringify({ merchantId, sessionId, issuedAt: now, expiresAt: now + RECOVERY_LINK_TTL_SECONDS })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }
  verify(token: unknown, now = Math.floor(Date.now() / 1000)): Claims {
    try {
      if (typeof token !== "string" || token.length > 2048) throw new Error();
      const parts = token.split(".");
      if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      const expected = Buffer.from(this.sign(parts[0]!));
      const actual = Buffer.from(parts[1]!);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
      const claims: Claims = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
      if (!id(claims.merchantId) || !id(claims.sessionId) || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)
        || claims.issuedAt > now || claims.expiresAt <= now || claims.expiresAt <= claims.issuedAt
        || claims.expiresAt - claims.issuedAt > RECOVERY_LINK_TTL_SECONDS) throw new Error();
      return claims;
    } catch { throw new UnauthorizedException("recovery_link_invalid_or_expired"); }
  }
  private sign(payload: string): string {
    const secret = this.secret ?? requireSecret("JWT_SECRET", "");
    if (secret.length < 32) throw new Error("recovery_link_requires_configured_jwt_secret");
    return createHmac("sha256", secret).update(`aacp_cart_recovery_v1:${payload}`).digest("base64url");
  }
}
