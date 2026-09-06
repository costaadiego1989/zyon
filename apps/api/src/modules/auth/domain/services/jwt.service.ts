import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { AuthRepository } from "../ports/auth-repository.port.js";
import type { AuthenticatedPrincipal, TenantRole } from "../auth.types.js";
import { requireSecret } from "../../../../shared/config/secret-config.js";

export interface JwtPayload {
  sub: string;
  merchant_id: string;
  email: string;
  role: string;
  jti: string; // JWT ID for revocation tracking
  iat: number;
  exp: number;
}

/** Valid roles for merchant JWTs. Closes L12: runtime assertion. */
const VALID_ROLES: readonly TenantRole[] = ["owner", "admin", "staff"];
function normalizeRoleForValidation(role: string): TenantRole | null {
  if (role === "owner" || role === "OWNER") return "owner";
  if (role === "admin" || role === "ADMIN") return "admin";
  if (role === "staff" || role === "STAFF") return "staff";
  return null;
}

function isValidRole(role: string): role is TenantRole {
  return normalizeRoleForValidation(role) !== null;
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
    private readonly ttlSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600),
    private readonly sessions?: AuthRepository,
  ) {
    if (process.env.NODE_ENV === "production" && secret === DEV_SECRET_FALLBACK) throw new Error("jwt_secret_is_dev_default_in_production");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error("jwt_invalid_ttl");
  }

  private store(): AuthRepository {
    if (!this.sessions) throw new Error("jwt_session_store_required");
    return this.sessions;
  }

  async issue(principal: AuthenticatedPrincipal, authVersion = 0): Promise<string> {
    const token = this.sign(principal);
    const { decoded } = this.parseAndValidate(token);
    const created = await this.store().createSession({ id: decoded.jti, familyId: randomUUID(),
      ...principal, authVersion, refreshExpiresAt: new Date((decoded.exp + 7 * 24 * 3600) * 1000) });
    if (!created) throw new Error("jwt_membership_changed");
    return token;
  }

  async authenticate(token: string): Promise<AuthenticatedPrincipal> {
    const principal = this.verify(token);
    const { decoded } = this.parseAndValidate(token);
    const session = await this.store().findActiveSession(decoded.jti, new Date());
    if (!session || session.userId !== principal.userId || session.merchantId !== principal.merchantId ||
      session.email !== principal.email || session.role !== principal.role) throw new Error("jwt_session_invalid");
    return principal;
  }

  async rotate(token: string): Promise<{ token: string; principal: AuthenticatedPrincipal }> {
    const principal = this.verifyForRefresh(token);
    const { decoded } = this.parseAndValidate(token);
    const now = new Date();
    const current = await this.store().findActiveSession(decoded.jti, now);
    if (!current || current.userId !== principal.userId || current.merchantId !== principal.merchantId ||
      current.role !== principal.role || current.email !== principal.email) throw new Error("jwt_session_invalid");
    const nextToken = this.sign(principal);
    const next = this.parseAndValidate(nextToken).decoded;
    const rotated = await this.store().rotateSession(decoded.jti, { ...current, id: next.jti }, now);
    if (!rotated) throw new Error("jwt_refresh_replayed");
    return { token: nextToken, principal };
  }

  async revoke(token: string): Promise<void> {
    // Verify signature, but allow expired or consumed tokens to revoke
    // their family when logout races a successful refresh.
    const { decoded } = this.parseAndValidate(token);
    await this.store().revokeSessionFamily(decoded.jti, decoded.sub, new Date());
  }

  sign(principal: AuthenticatedPrincipal, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const payload: JwtPayload = {
      sub: principal.userId,
      merchant_id: principal.merchantId,
      email: principal.email,
      role: principal.role,
      jti: randomUUID(), // Unique token ID for revocation
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
  verifyForRefresh(token: string, graceSeconds = 30 * 24 * 3600, nowSeconds = Math.floor(Date.now() / 1000)): AuthenticatedPrincipal {
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
    const decodedHeader = parseJsonPart(header);
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") throw new Error("jwt_invalid_header");
    const decoded = parseJsonPart(payload) as JwtPayload & { aud?: string };
    // B1 (P0): Reject buyer tokens that share the same signing secret.
    if (decoded.aud === "buyer" || decoded.role === "buyer") {
      throw new Error("jwt_wrong_audience");
    }
    if (!decoded || typeof decoded.sub !== "string" || !decoded.sub.trim() ||
      typeof decoded.jti !== "string" || !decoded.jti.trim() || typeof decoded.email !== "string" ||
      typeof decoded.merchant_id !== "string" || !Number.isSafeInteger(decoded.exp) ||
      !Number.isSafeInteger(decoded.iat) || decoded.exp <= decoded.iat) throw new Error("jwt_invalid_claims");
    // B1 (P0): Guarantee merchant_id is present and non-empty.
    if (!decoded.merchant_id) throw new Error("jwt_missing_merchant_id");
    // L12: Validate role is a known TenantRole, not arbitrary string.
    if (!isValidRole(decoded.role)) {
      throw new Error("jwt_invalid_role");
    }
    // Normalize role casing so downstream code (auth guard, tenant principal,
    // TenantRoleGuard) sees the canonical lowercase form regardless of how
    // the DB row was inserted.
    const normalized = normalizeRoleForValidation(decoded.role);
    if (normalized) {
      (decoded as { role: TenantRole }).role = normalized;
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

function parseJsonPart(value: string): any {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("jwt_invalid_claims");
  }
}

function hmacSign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
