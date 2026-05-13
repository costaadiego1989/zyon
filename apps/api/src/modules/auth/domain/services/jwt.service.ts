import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthenticatedPrincipal } from "../auth.types.js";

export interface JwtPayload {
  sub: string;
  merchant_id: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export class JwtService {
  constructor(
    private readonly secret = process.env.JWT_SECRET ?? "dev-secret-change-me",
    private readonly ttlSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600)
  ) {}

  sign(principal: AuthenticatedPrincipal, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const payload: JwtPayload = {
      sub: principal.userId,
      merchant_id: principal.merchantId,
      email: principal.email,
      role: principal.role,
      iat: nowSeconds,
      exp: nowSeconds + this.ttlSeconds
    };
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = base64UrlJson(header);
    const encodedPayload = base64UrlJson(payload);
    const signature = sign(`${encodedHeader}.${encodedPayload}`, this.secret);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): AuthenticatedPrincipal {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("jwt_malformed");
    const [header, payload, signature] = parts;
    const expected = sign(`${header}.${payload}`, this.secret);
    if (!safeEqual(signature, expected)) throw new Error("jwt_invalid_signature");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload;
    if (decoded.exp <= nowSeconds) throw new Error("jwt_expired");
    return {
      userId: decoded.sub,
      merchantId: decoded.merchant_id,
      email: decoded.email,
      role: decoded.role as AuthenticatedPrincipal["role"]
    };
  }

  /**
   * Verifica assinatura mas permite tokens expirados dentro de uma janela de graça.
   * Usado para refresh: aceita tokens expirados há até `graceSeconds` (padrão 7 dias).
   */
  verifyForRefresh(token: string, graceSeconds = 7 * 24 * 3600, nowSeconds = Math.floor(Date.now() / 1000)): AuthenticatedPrincipal {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("jwt_malformed");
    const [header, payload, signature] = parts;
    const expected = sign(`${header}.${payload}`, this.secret);
    if (!safeEqual(signature, expected)) throw new Error("jwt_invalid_signature");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload;
    // Rejeita se expirou há mais tempo que a janela de graça
    if (decoded.exp + graceSeconds <= nowSeconds) throw new Error("jwt_refresh_window_expired");
    return {
      userId: decoded.sub,
      merchantId: decoded.merchant_id,
      email: decoded.email,
      role: decoded.role as AuthenticatedPrincipal["role"]
    };
  }

  expiresIn(): number {
    return this.ttlSeconds;
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
