import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthenticatedPrincipal, TenantRole } from "../auth.types.js";
import { requireSecret } from "../../../../shared/config/secret-config.js";

export interface JwtPayload {
  sub: string;
  merchant_id: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

/** Valid roles for merchant JWTs. Closes L12: runtime assertion. */
const VALID_ROLES: readonly TenantRole[] = ["owner", "admin"];

function isValidRole(role: string): role is TenantRole {
  return (VALID_ROLES as readonly string[]).includes(role);
}

/**
 * Options for the internal verifyCore method.
 * Closes M2, M3: single core implementation used by both verify and verifyForRefresh.
 */
interface VerifyCoreOptions {
  /** Reject tokens expired longer than this many seconds ago. 0 = strict expiry. */
  graceSeconds: number;
}

/**
 * Parsed + validated JWT structure.
 * Closes M2: extracted parseAndValidate.
 */
interface ParsedJwt {
  header: string;
  payload: string;
  signature: string;
  decoded: JwtPayload & { aud?: string };
}

/**
 * C3: Dev fallback secret. JwtService constructor verifies this is not used in production.
 */
const DEV_SECRET_FALLBACK = "dev-secret-change-me";

export class JwtService {
  constructor(
    private readonly secret = requireSecret("JWT_SECRET", DEV_SECRET_FALLBACK),
    private readonly ttlSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600)
  ) {
    // C3: Fail-safe — refuse to start with the dev fallback in production.
    if (
      process.env.NODE_ENV === "production" &&
      this.secret === DEV_SECRET_FALLBACK
    ) {
      throw new Error("jwt_secret_is_dev_default_in_production");
    }
  }

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
    const signature = hmacSign(`${encodedHeader}.${encodedPayload}`, this.secret);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): AuthenticatedPrincipal {
    return this.verifyCore(token, nowSeconds, { graceSeconds: 0 });
  }

  /**
   * Verifica assinatura mas permite tokens expirados dentro de uma janela de graça.
   * Usado para refresh: aceita tokens expirados há até `graceSeconds` (padrão 7 dias).
   */
  verifyForRefresh(token: string, graceSeconds = 7 * 24 * 3600, nowSeconds = Math.floor(Date.now() / 1000)): AuthenticatedPrincipal {
    return this.verifyCore(token, nowSeconds, { graceSeconds });
  }

  expiresIn(): number {
    return this.ttlSeconds;
  }

  /**
   * M2: Parse token into header/payload/signature + decoded payload.
   * Validates structure, signature, and audience.
   */
  private parseAndValidate(token: string): ParsedJwt {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("jwt_malformed");
    const [header, payload, signature] = parts;
    const expected = hmacSign(`${header}.${payload}`, this.secret);
    if (!safeEqual(signature, expected)) throw new Error("jwt_invalid_signature");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload & { aud?: string };
    // B1 (P0): Reject buyer tokens that share the same signing secret.
    if (decoded.aud === "buyer" || decoded.role === "buyer") {
      throw new Error("jwt_wrong_audience");
    }
    // B1 (P0): Guarantee merchant_id is present and non-empty.
    if (!decoded.merchant_id) throw new Error("jwt_missing_merchant_id");
    // L12: Validate role is a known TenantRole, not arbitrary string.
    if (!isValidRole(decoded.role)) {
      throw new Error("jwt_invalid_role");
    }
    return { header, payload, signature, decoded };
  }

  /**
   * M3: Single core verification with configurable expiry grace.
   */
  private verifyCore(token: string, nowSeconds: number, options: VerifyCoreOptions): AuthenticatedPrincipal {
    const { decoded } = this.parseAndValidate(token);
    if (options.graceSeconds === 0) {
      // Strict expiry check
      if (decoded.exp <= nowSeconds) throw new Error("jwt_expired");
    } else {
      // Grace window: reject if expired longer than graceSeconds ago
      if (decoded.exp + options.graceSeconds <= nowSeconds) throw new Error("jwt_refresh_window_expired");
    }
    return {
      userId: decoded.sub,
      merchantId: decoded.merchant_id,
      email: decoded.email,
      role: decoded.role as TenantRole
    };
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
