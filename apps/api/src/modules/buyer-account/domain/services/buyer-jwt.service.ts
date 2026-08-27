import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../../../../shared/config/secret-config.js";

export interface BuyerJwtPayload {
  sub: string;
  email: string;
  merchantId?: string; // H3 fix: bind buyer to merchant when issued via session
  role: "buyer";
  aud: "buyer";
  iat: number;
  exp: number;
}

export interface BuyerPrincipal {
  globalUserId: string;
  email: string;
  merchantId?: string; // H3 fix: present when JWT was issued for a specific merchant
}

export class BuyerJwtService {
  constructor(
    // B1 (P0): Use dedicated BUYER_JWT_SECRET so buyer tokens cannot be accepted
    // by the merchant AuthGuard (which uses JWT_SECRET). The two secrets are
    // cryptographically independent, preventing audience confusion attacks.
    private readonly secret = requireSecret("BUYER_JWT_SECRET", "buyer-dev-secret-change-me"),
    private readonly ttlSeconds = Number(process.env.BUYER_JWT_EXPIRES_SECONDS ?? 604800) // 7 days default
  ) {}

  sign(principal: BuyerPrincipal, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const payload: BuyerJwtPayload = {
      sub: principal.globalUserId,
      email: principal.email,
      ...(principal.merchantId ? { merchantId: principal.merchantId } : {}), // H3 fix
      role: "buyer",
      aud: "buyer",
      iat: nowSeconds,
      exp: nowSeconds + this.ttlSeconds,
    };
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = base64UrlJson(header);
    const encodedPayload = base64UrlJson(payload);
    const signature = hmacSign(`${encodedHeader}.${encodedPayload}`, this.secret);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): BuyerPrincipal {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("jwt_malformed");
    const [header, payload, signature] = parts;
    const expected = hmacSign(`${header}.${payload}`, this.secret);
    if (!safeEqual(signature, expected)) throw new Error("jwt_invalid_signature");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as BuyerJwtPayload;
    if (decoded.exp <= nowSeconds) throw new Error("jwt_expired");
    if (decoded.aud !== "buyer" || decoded.role !== "buyer") throw new Error("jwt_wrong_audience");
    // H3 fix: include merchantId if present in claims
    return { globalUserId: decoded.sub, email: decoded.email, merchantId: decoded.merchantId };
  }

  expiresIn(): number {
    return this.ttlSeconds;
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function hmacSign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
