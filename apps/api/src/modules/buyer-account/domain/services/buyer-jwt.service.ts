import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../../../../shared/config/secret-config.js";

export interface BuyerJwtPayload {
  sub: string;
  email: string;
  role: "buyer";
  aud: "buyer";
  iat: number;
  exp: number;
}

export interface BuyerPrincipal {
  globalUserId: string;
  email: string;
}

export class BuyerJwtService {
  constructor(
    private readonly secret = requireSecret("JWT_SECRET", "dev-secret-change-me"),
    private readonly ttlSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600)
  ) {}

  sign(principal: BuyerPrincipal, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const payload: BuyerJwtPayload = {
      sub: principal.globalUserId,
      email: principal.email,
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
    return { globalUserId: decoded.sub, email: decoded.email };
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
