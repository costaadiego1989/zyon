import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../../../../shared/config/secret-config.js";

/** The signature is scoped to digital delivery and includes the persisted expiry. */
export class DigitalDownloadLinkService {
  constructor(private readonly secret = requireSecret("JWT_SECRET", ""), private readonly baseUrl = process.env.API_PUBLIC_URL) {}

  issue(input: { id: string; merchantId: string; expiresAt: Date }): string {
    if (!this.baseUrl || this.secret.length < 32) throw new Error("digital_delivery_configuration_missing");
    const base = new URL(this.baseUrl);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error("digital_delivery_configuration_invalid");
    const payload = Buffer.from(JSON.stringify({ id: input.id, merchantId: input.merchantId, exp: input.expiresAt.getTime() })).toString("base64url");
    return `${base.origin}/v1/digital-downloads?token=${payload}.${this.signature(payload)}`;
  }

  verify(token: unknown, now = Date.now()): { id: string; merchantId: string; exp: number } {
    if (this.secret.length < 32 || typeof token !== "string" || token.length > 2048) throw new Error("digital_access_denied");
    const [payload, signature, extra] = token.split(".");
    if (extra !== undefined || !payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) throw new Error("digital_access_denied");
    const expected = Buffer.from(this.signature(payload)); const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("digital_access_denied");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!claims || typeof claims.id !== "string" || !claims.id || typeof claims.merchantId !== "string" || !claims.merchantId || !Number.isSafeInteger(claims.exp) || claims.exp <= now) throw new Error("digital_access_denied");
    return claims;
  }

  private signature(payload: string): string { return createHmac("sha256", this.secret).update(`zyon_digital_download_v1:${payload}`).digest("base64url"); }
}
