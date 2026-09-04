import { randomBytes } from "node:crypto";

/**
 * Single-use, time-bounded challenge store for WebAuthn ceremonies.
 *
 * Spec REQ-WA-005:
 *   - Challenge is 32 random bytes
 *   - Expires 5 minutes after issue
 *   - Single-use: consume() removes the entry
 *
 * In production this is backed by Redis / Prisma. Tests use the in-process
 * implementation directly (CLAUDE.md: in-memory is test-only).
 *
 * The store is keyed by `${scopeKey}:${challenge}` so challenges issued
 * to one buyer (or one ceremony kind) cannot be cross-consumed.
 */
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface IssuedChallenge {
  challenge: string; // base64url
  scopeKey: string;
  expiresAt: number; // ms epoch
}

interface StoredChallenge {
  scopeKey: string;
  expiresAt: number;
}

export class WebAuthnChallengeService {
  private readonly records = new Map<string, StoredChallenge>();

  /**
   * Issue a new 32-byte challenge bound to the given scope key. The challenge
   * is returned base64url-encoded, ready to be passed to navigator.credentials.
   */
  issue(scopeKey: string, ttlMs: number = WEBAUTHN_CHALLENGE_TTL_MS): IssuedChallenge {
    if (!scopeKey) throw new Error("webauthn_challenge_scope_required");
    const bytes = randomBytes(32);
    const challenge = bytes.toString("base64url");
    const expiresAt = Date.now() + ttlMs;
    this.records.set(`${scopeKey}:${challenge}`, { scopeKey, expiresAt });
    return { challenge, scopeKey, expiresAt };
  }

  /**
   * Validate and remove a previously-issued challenge. Returns the issued
   * record on success, or null on:
   *   - unknown challenge
   *   - scope mismatch
   *   - expired challenge
   *   - already consumed
   *
   * This implements the single-use and 5-minute expiry invariants.
   */
  consume(challenge: string, scopeKey: string, nowMs: number = Date.now()): IssuedChallenge | null {
    if (!challenge || !scopeKey) return null;
    const key = `${scopeKey}:${challenge}`;
    const stored = this.records.get(key);
    if (!stored) return null;
    this.records.delete(key);
    if (stored.scopeKey !== scopeKey) return null;
    if (stored.expiresAt <= nowMs) return null;
    return { challenge, scopeKey, expiresAt: stored.expiresAt };
  }

  /** Test helper. */
  clear(): void {
    this.records.clear();
  }
}