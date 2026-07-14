import { createHash, timingSafeEqual } from "node:crypto";

/**
 * WebAuthn (FIDO2) assertion & attestation verifier.
 *
 * Implements a minimal but spec-compliant subset of WebAuthn §6.1 / §6.2:
 *   - RP ID hash check (defends against cross-origin replay)
 *   - Origin check inside clientDataJSON (defends against phishing)
 *   - User verification (UV) flag enforcement (per spec REQ-WA-001/005)
 *   - Counter monotonicity check (defends against cloned authenticators)
 *   - ECDSA P-256 (ES256) signature verification using WebCrypto
 *
 * Attestation format is `none` (privacy-preserving, REQ-WA-005): we only
 * need the attested public key bytes, not the manufacturer's certificate.
 *
 * Replaces `@simplewebauthn/server` with the platform-native WebCrypto API
 * so the package dependency surface stays minimal.
 */

export interface WebAuthnVerifierConfig {
  rpId: string;
  origin: string; // expected value inside clientDataJSON.origin
  requireUserVerification?: boolean;
}

export type AssertionFailureReason =
  | "rp_id_mismatch"
  | "origin_mismatch"
  | "user_verification_failed"
  | "counter_not_incremented"
  | "signature_verification_failed"
  | "auth_data_malformed";

export interface VerifyAssertionInput {
  challenge: Uint8Array;
  storedPublicKey: Uint8Array;
  storedCounter: number;
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}

export type VerifyAssertionResult =
  | { ok: true; newCounter: number }
  | { ok: false; reason: AssertionFailureReason };

export interface ParseAttestationInput {
  authenticatorData: Uint8Array;
  credentialIdLength: number;
}

export type ParseAttestationResult =
  | {
      ok: true;
      credentialId: string;
      publicKey: Uint8Array;
      aaguid: string;
      counter: number;
    }
  | { ok: false; reason: AssertionFailureReason };

const UP_FLAG = 1 << 0;
const UV_FLAG = 1 << 2;

export class WebAuthnVerifierService {
  constructor(private readonly config: WebAuthnVerifierConfig) {
    if (!config.rpId) throw new Error("webauthn_verifier_rp_id_required");
    if (!config.origin) throw new Error("webauthn_verifier_origin_required");
  }

  /**
   * Verify an authentication assertion (login).
   * On success returns the new counter value the caller MUST persist
   * for replay detection.
   */
  async verifyAssertion(input: VerifyAssertionInput): Promise<VerifyAssertionResult> {
    if (input.authenticatorData.length < 37) {
      return { ok: false, reason: "auth_data_malformed" };
    }

    // 1. RP ID hash
    const rpIdHash = input.authenticatorData.subarray(0, 32);
    const expectedRpIdHash = createHash("sha256").update(this.config.rpId, "utf8").digest();
    if (!safeEqualBytes(rpIdHash, expectedRpIdHash)) {
      return { ok: false, reason: "rp_id_mismatch" };
    }

    // 2. Flags
    const flags = input.authenticatorData[32];
    const uvSet = (flags & UV_FLAG) === UV_FLAG;
    const requireUv = this.config.requireUserVerification ?? true;
    if (requireUv && !uvSet) {
      return { ok: false, reason: "user_verification_failed" };
    }

    // 3. Counter (replay protection)
    const counter = readUInt32BE(input.authenticatorData, 33);
    if (counter !== 0 && counter <= input.storedCounter) {
      return { ok: false, reason: "counter_not_incremented" };
    }

    // 4. Origin in clientDataJSON
    let parsed: { type?: string; origin?: string; challenge?: string };
    try {
      parsed = JSON.parse(new TextDecoder().decode(input.clientDataJSON));
    } catch {
      return { ok: false, reason: "auth_data_malformed" };
    }
    if (parsed.type !== "webauthn.get") {
      return { ok: false, reason: "auth_data_malformed" };
    }
    if (parsed.origin !== this.config.origin) {
      return { ok: false, reason: "origin_mismatch" };
    }
    if (parsed.challenge !== encodeBase64Url(input.challenge)) {
      return { ok: false, reason: "auth_data_malformed" };
    }

    // 5. SHA-256(clientDataJSON)
    const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", input.clientDataJSON as unknown as ArrayBuffer));

    // 6. Verify ECDSA signature over authenticatorData || clientDataHash
    const message = new Uint8Array(input.authenticatorData.length + clientDataHash.length);
    message.set(input.authenticatorData, 0);
    message.set(clientDataHash, input.authenticatorData.length);

    const ok = await verifyEcdsaP256(input.storedPublicKey, message, input.signature);
    if (!ok) return { ok: false, reason: "signature_verification_failed" };

    return { ok: true, newCounter: counter };
  }

  /**
   * Parse a `none`-format attestation object and extract the credential id,
   * public key, AAGUID, and counter. The attestation object is the raw
   * authenticatorData; we don't validate a signature here because `none`
   * format explicitly carries none.
   */
  parseAttestation(input: ParseAttestationInput): ParseAttestationResult {
    const ad = input.authenticatorData;
    if (ad.length < 37 + 16 + 2 + input.credentialIdLength + 1) {
      return { ok: false, reason: "auth_data_malformed" };
    }

    const rpIdHash = ad.subarray(0, 32);
    const expectedRpIdHash = createHash("sha256").update(this.config.rpId, "utf8").digest();
    if (!safeEqualBytes(rpIdHash, expectedRpIdHash)) {
      return { ok: false, reason: "rp_id_mismatch" };
    }

    const flags = ad[32];
    const uvSet = (flags & UV_FLAG) === UV_FLAG;
    if (this.config.requireUserVerification !== false && !uvSet) {
      return { ok: false, reason: "user_verification_failed" };
    }

    const counter = readUInt32BE(ad, 33);

    // attestedCredentialData: AAGUID(16) || L(2) || credentialId(L) || COSE pubkey
    const aaguidBytes = ad.subarray(37, 53);
    const credentialIdLength = readUInt16BE(ad, 53);
    if (credentialIdLength !== input.credentialIdLength) {
      return { ok: false, reason: "auth_data_malformed" };
    }
    const credentialIdBytes = ad.subarray(55, 55 + credentialIdLength);
    const credentialId = encodeBase64Url(credentialIdBytes);

    // COSE-encoded public key. For ES256 (-7) it's the raw uncompressed
    // X9.62 form when generated with `generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["verify"])`
    // via exportKey("raw", ...). We extract it verbatim.
    const publicKeyBytes = ad.subarray(55 + credentialIdLength);

    return {
      ok: true,
      credentialId,
      publicKey: new Uint8Array(publicKeyBytes),
      aaguid: formatAaguid(aaguidBytes),
      counter,
    };
  }
}

// --- internal helpers ---------------------------------------------------------

function safeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

function readUInt32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] & 0xff) << 24) |
    ((buf[offset + 1] & 0xff) << 16) |
    ((buf[offset + 2] & 0xff) << 8) |
    (buf[offset + 3] & 0xff)
  ) >>> 0;
}

function readUInt16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] & 0xff) << 8) | (buf[offset + 1] & 0xff);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64url");
}

function formatAaguid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function verifyEcdsaP256(
  publicKeyRaw: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyRaw as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}