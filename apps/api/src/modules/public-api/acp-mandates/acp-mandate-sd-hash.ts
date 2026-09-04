/**
 * AP2 selective disclosure digest helpers.
 *
 * SD-JWT (IETF draft-ietf-oauth-selective-disclosure-jwt) computes per-claim
 * digests with SHA-256 over a canonical JSON encoding of each disclosure. The
 * list of digests forms the `delegate_payload` array embedded in the issuer's
 * signed JWT (as `{"...": "<digest>"}` entries). The verifier recomputes the
 * digests from the disclosed plaintext and checks them against the embedded
 * list — that's how a holder proves which claims are issuer-attested without
 * revealing unselected claims.
 *
 * For AP2 payment + checkout mandates the only hidden claim at issuance time
 * is the mandate payload itself. The issuer (this service) signs one JWT per
 * mandate; the holder reveals the payload by appending the matching disclosure
 * to the JWS compact serialization.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Stable JSON serialization across process restarts. Object keys are sorted
 * recursively so the same logical value always produces the same byte string;
 * arrays preserve order (they have semantic position in AP2 mandates).
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * SHA-256 over the canonical encoding of one disclosure (or any value).
 * Returned as lowercase hex — matches the `digest` field in the response and
 * what a holder would embed under `{"...": "<digest>"}` in `delegate_payload`.
 */
export function sha256Hex(input: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(input)).digest("hex");
}

/**
 * Compute the SD-JWT `sd_hash` for a list of per-disclosure digests: SHA-256
 * over the concatenation of each digest (hex-encoded, no separator). This
 * binds the issued JWT to the exact set of digests it discloses, so a holder
 * cannot substitute a different disclosure without invalidating the issuer
 * signature (the issuer signs `sd_hash`; a verifier recomputes it).
 */
export function computeSdHash(digests: string[]): string {
  const hash = createHash("sha256");
  for (const digest of digests) {
    hash.update(digest);
  }
  return hash.digest("hex");
}

/**
 * Base64url-encode a Buffer or string per RFC 7515 §2 (no padding, URL-safe
 * alphabet). Used for JWS compact serialization and the `encoded` field on a
 * disclosure.
 */
export function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Build the `{"...": "<digest>"}` shape used inside `delegate_payload` for
 * each embedded disclosure. The literal key `"..."` is the SD-JWT sentinel
 * value that identifies array entries as hash references.
 */
export function delegatePayloadEntry(digest: string): Record<string, string> {
  return { "...": digest };
}
