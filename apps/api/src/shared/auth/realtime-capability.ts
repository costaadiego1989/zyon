import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../config/secret-config.js";
import { resolveCorsConfig } from "../config/cors-config.js";

export type RealtimePurpose = "storefront-conversation" | "support-ticket";
export interface RealtimeCapability {
  typ: "aacp_realtime_v1";
  purpose: RealtimePurpose;
  merchantId: string;
  resourceId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  origin?: string;
}

const MAX_LIFETIME_SECONDS = 3600;

/** Bearer capability issued only when the server creates a new resource. */
export class RealtimeCapabilityService {
  private readonly secret: string;

  constructor(secret = requireSecret("JWT_SECRET", "")) {
    if (secret.length < 32 || secret === "dev-secret-change-me") {
      throw new Error("realtime_requires_configured_jwt_secret_at_least_32_characters");
    }
    this.secret = secret;
  }

  issue(input: { purpose: RealtimePurpose; merchantId: string; resourceId: string; origin?: string }, now = Math.floor(Date.now() / 1000)) {
    const claims: RealtimeCapability = {
      typ: "aacp_realtime_v1", ...input, issuedAt: now,
      expiresAt: now + MAX_LIFETIME_SECONDS, nonce: randomUUID(),
    };
    this.validate(claims, input.purpose, input.origin, now);
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return { token: `${payload}.${this.signature(payload)}`, expiresAt: claims.expiresAt };
  }

  verify(token: unknown, purpose: RealtimePurpose, origin?: string, now = Math.floor(Date.now() / 1000)): RealtimeCapability {
    if (typeof token !== "string" || token.length > 4096) throw new Error("invalid_realtime_token");
    const parts = token.split(".");
    if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("invalid_realtime_token");
    const [payload, signature] = parts;
    const expected = Buffer.from(this.signature(payload!));
    const actual = Buffer.from(signature!);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("invalid_realtime_token");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as RealtimeCapability;
    this.validate(claims, purpose, origin, now);
    return claims;
  }

  private signature(payload: string): string {
    return createHmac("sha256", this.secret).update(`aacp_realtime_v1:${payload}`).digest("base64url");
  }

  private validate(claims: RealtimeCapability, purpose: RealtimePurpose, origin: string | undefined, now: number): void {
    if (!claims || claims.typ !== "aacp_realtime_v1" || claims.purpose !== purpose ||
      !isRealtimeId(claims.merchantId) || !isRealtimeId(claims.resourceId) || !isRealtimeId(claims.nonce) ||
      !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) ||
      claims.issuedAt > now || claims.expiresAt <= now ||
      claims.expiresAt <= claims.issuedAt || claims.expiresAt - claims.issuedAt > MAX_LIFETIME_SECONDS) {
      throw new Error("invalid_or_expired_realtime_token");
    }
    if (claims.origin !== undefined && (!isHttpOrigin(claims.origin) || claims.origin !== origin)) {
      throw new Error("realtime_origin_not_allowed");
    }
  }
}

export function isRealtimeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function isHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value;
  } catch { return false; }
}

/** WebSocket upgrades do not enforce browser CORS; validate Origin explicitly. */
export function isRealtimeOriginAllowed(origin: unknown): boolean {
  if (!isHttpOrigin(origin)) return false;
  const allowed = resolveCorsConfig().origin;
  return Array.isArray(allowed) ? allowed.includes(origin) : allowed instanceof RegExp && allowed.test(origin);
}

export function realtimeRoom(kind: string, merchantId: string, resourceId?: string): string {
  return JSON.stringify([kind, merchantId, resourceId ?? null]);
}
