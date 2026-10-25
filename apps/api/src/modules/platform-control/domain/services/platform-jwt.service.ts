import { Inject, Injectable, Optional } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PlatformOperatorRole, PlatformPrincipal } from "../platform-operator.js";
import { isPlatformOperatorRole } from "../platform-operator.js";
import { PLATFORM_OPERATOR_REPOSITORY } from "../ports/platform-operator-repository.port.js";
import type {
  PlatformOperatorRepository,
  PlatformSessionRecord,
} from "../ports/platform-operator-repository.port.js";

const PLATFORM_AUDIENCE = "platform-control";
const MINIMUM_SECRET_LENGTH = 32;

type PlatformJwtPayload = {
  sub: string;
  email: string;
  role: PlatformOperatorRole;
  jti: string;
  aud: typeof PLATFORM_AUDIENCE;
  iat: number;
  exp: number;
};

type ParsedPlatformJwt = {
  header: string;
  payload: string;
  signature: string;
  decoded: PlatformJwtPayload;
};

type VerificationOptions = {
  graceSeconds: number;
};

@Injectable()
export class PlatformJwtService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(PLATFORM_OPERATOR_REPOSITORY) private readonly sessions: PlatformOperatorRepository,
    @Optional() private readonly secret = process.env.PLATFORM_CONTROL_JWT_SECRET,
    @Optional() ttlSeconds = Number(process.env.PLATFORM_CONTROL_JWT_EXPIRES_IN_SECONDS ?? 900),
  ) {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error("platform_jwt_invalid_ttl");
    this.ttlSeconds = ttlSeconds;
  }

  async issue(principal: PlatformPrincipal, authVersion: number): Promise<string> {
    const token = this.sign(principal);
    const decoded = this.parseAndValidate(token).decoded;
    const created = await this.sessions.createSession({
      ...principal,
      id: decoded.jti,
      familyId: randomUUID(),
      authVersion,
      refreshExpiresAt: new Date((decoded.exp + 7 * 24 * 60 * 60) * 1000),
    });
    if (!created) throw new Error("platform_membership_changed");
    return token;
  }

  async authenticate(token: string): Promise<PlatformPrincipal> {
    const principal = this.verify(token);
    const decoded = this.parseAndValidate(token).decoded;
    const session = await this.sessions.findActiveSession(decoded.jti, new Date());
    if (!session || !samePrincipal(session, principal)) throw new Error("platform_session_invalid");
    return principal;
  }

  async rotate(token: string): Promise<{ token: string; principal: PlatformPrincipal }> {
    const principal = this.verifyForRefresh(token);
    const decoded = this.parseAndValidate(token).decoded;
    const now = new Date();
    const current = await this.sessions.findActiveSession(decoded.jti, now);
    if (!current || !samePrincipal(current, principal)) throw new Error("platform_session_invalid");

    const nextToken = this.sign(principal);
    const next = this.parseAndValidate(nextToken).decoded;
    const rotated = await this.sessions.rotateSession(decoded.jti, {
      ...principal,
      id: next.jti,
      familyId: current.familyId,
      authVersion: current.authVersion,
      refreshExpiresAt: current.refreshExpiresAt,
    }, now);
    if (!rotated) throw new Error("platform_refresh_replayed");
    return { token: nextToken, principal };
  }

  async revoke(token: string): Promise<void> {
    const decoded = this.parseAndValidate(token).decoded;
    await this.sessions.revokeSessionFamily(decoded.jti, new Date());
  }

  expiresIn(): number {
    return this.ttlSeconds;
  }

  private sign(principal: PlatformPrincipal, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const payload: PlatformJwtPayload = {
      sub: principal.operatorId,
      email: principal.email,
      role: principal.role,
      jti: randomUUID(),
      aud: PLATFORM_AUDIENCE,
      iat: nowSeconds,
      exp: nowSeconds + this.ttlSeconds,
    };
    const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
    const body = base64UrlJson(payload);
    return `${header}.${body}.${this.signatureFor(`${header}.${body}`)}`;
  }

  private verify(token: string): PlatformPrincipal {
    return this.verifyCore(token, Math.floor(Date.now() / 1000), { graceSeconds: 0 });
  }

  private verifyForRefresh(token: string): PlatformPrincipal {
    return this.verifyCore(token, Math.floor(Date.now() / 1000), { graceSeconds: 30 * 24 * 60 * 60 });
  }

  private verifyCore(token: string, nowSeconds: number, options: VerificationOptions): PlatformPrincipal {
    const decoded = this.parseAndValidate(token).decoded;
    if (decoded.exp + options.graceSeconds <= nowSeconds) throw new Error("platform_jwt_expired");
    return { operatorId: decoded.sub, email: decoded.email, role: decoded.role };
  }

  private parseAndValidate(token: string): ParsedPlatformJwt {
    const [header, payload, signature, ...remaining] = token.split(".");
    if (remaining.length || !header || !payload || !signature) throw new Error("platform_jwt_malformed");
    const expected = this.signatureFor(`${header}.${payload}`);
    if (!safeEqual(signature, expected)) throw new Error("platform_jwt_invalid_signature");

    const decodedHeader = parseJsonPart(header);
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") throw new Error("platform_jwt_invalid_header");

    const decoded = parseJsonPart(payload) as Partial<PlatformJwtPayload>;
    if (decoded.aud !== PLATFORM_AUDIENCE) throw new Error("platform_jwt_wrong_audience");
    if (typeof decoded.sub !== "string" || !decoded.sub.trim() ||
      typeof decoded.email !== "string" || !decoded.email.trim() ||
      typeof decoded.jti !== "string" || !decoded.jti.trim() ||
      typeof decoded.role !== "string" || !isPlatformOperatorRole(decoded.role) ||
      typeof decoded.iat !== "number" || !Number.isSafeInteger(decoded.iat) ||
      typeof decoded.exp !== "number" || !Number.isSafeInteger(decoded.exp) || decoded.exp <= decoded.iat) {
      throw new Error("platform_jwt_invalid_claims");
    }
    return { header, payload, signature, decoded: decoded as PlatformJwtPayload };
  }

  private signatureFor(value: string): string {
    const secret = this.configuredSecret();
    return createHmac("sha256", secret).update(value).digest("base64url");
  }

  private configuredSecret(): string {
    if (!this.secret || this.secret.length < MINIMUM_SECRET_LENGTH) throw new Error("platform_jwt_secret_unconfigured");
    if (process.env.JWT_SECRET && this.secret === process.env.JWT_SECRET) {
      throw new Error("platform_jwt_secret_must_differ_from_tenant");
    }
    return this.secret;
  }
}

function samePrincipal(session: PlatformSessionRecord, principal: PlatformPrincipal): boolean {
  return session.operatorId === principal.operatorId &&
    session.email === principal.email &&
    session.role === principal.role;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseJsonPart(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_an_object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("platform_jwt_invalid_claims");
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
