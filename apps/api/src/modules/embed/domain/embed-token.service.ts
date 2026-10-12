import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../../../shared/config/secret-config.js";

export type EmbedTokenSecret = { value: Buffer };

export type EmbedScope =
  | "checkout:start"
  | "checkout:track"
  | "checkout:chat"
  | "offers:apply"
  | "coupons:apply"
  | "payment:intents:create"
  | "payment:intents:confirm"
  | "payment:intents:resume"
  | "payment:intents:read";

export type EmbedTokenClaims = {
  typ: "aacp_embed_v1";
  merchantId: string;
  installationId?: string;
  environment?: "test" | "live";
  widgetVersion?: string;
  issuedAtUnix: number;
  expiresAtUnix: number;
  nonce: string;
  allowedOrigin?: string;
  scopes?: EmbedScope[];
  cartRef?: string;
  storefrontCartRef?: string;
  aiUserId?: string;
  /** Issued only by verified storefront continuation; never accepted from issuer request data. */
  paymentResume?: import("../../payment/domain/marketplace-payment-resume.js").MarketplacePaymentResumeBinding;
  recoveredCheckoutSessionId?: string;
};

const EMBED_TOKEN_SECRET_DEV_FALLBACK = "dev_embed_token_secret_32_characters_min!!";

function embedSecret(): Buffer {
  const value = requireSecret("EMBED_TOKEN_SECRET", EMBED_TOKEN_SECRET_DEV_FALLBACK);
  if (value.length < 16) {
    throw new Error("EMBED_TOKEN_SECRET must be at least 16 characters");
  }
  return Buffer.from(value, "utf8");
}

export class EmbedTokenService {
  private readonly secret: EmbedTokenSecret;

  constructor(secret?: EmbedTokenSecret) {
    this.secret = secret ?? { value: embedSecret() };
  }

  sign(claims: EmbedTokenClaims): string {
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.secret.value).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  verify(token: string): EmbedTokenClaims {
    const parsed = this.readSignedClaims(token);
    const now = Math.floor(Date.now() / 1000);
    if (now > parsed.expiresAtUnix) {
      throw new Error("embed_token_expired");
    }
    return parsed;
  }

  /** Only the issuer may use this proof, alongside current cart ownership.
   * Keeping the first issuedAtUnix prevents renewal chains past one day. */
  verifyForStorefrontContinuation(token: unknown): EmbedTokenClaims {
    if (typeof token !== "string" || token.length > 8192) throw new Error("embed_token_malformed");
    const parsed = this.readSignedClaims(token);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(parsed.issuedAtUnix) || !Number.isSafeInteger(parsed.expiresAtUnix) ||
      parsed.issuedAtUnix > now || parsed.issuedAtUnix + 86400 <= now ||
      parsed.expiresAtUnix <= parsed.issuedAtUnix || parsed.expiresAtUnix - parsed.issuedAtUnix > 86400 ||
      typeof parsed.merchantId !== "string" || !parsed.merchantId.trim() || parsed.merchantId.length > 120 ||
      typeof parsed.nonce !== "string" || !parsed.nonce.trim() || parsed.nonce.length > 200 ||
      typeof parsed.storefrontCartRef !== "string" || !parsed.storefrontCartRef.trim() || parsed.storefrontCartRef.length > 120 ||
      parsed.cartRef !== undefined || !["test", "live"].includes(parsed.environment ?? "") ||
      typeof parsed.allowedOrigin !== "string" || !Array.isArray(parsed.scopes) || !parsed.scopes.length ||
      parsed.scopes.some(scope => typeof scope !== "string")) throw new Error("embed_continuation_invalid");
    const origin = new URL(parsed.allowedOrigin);
    if (origin.origin !== parsed.allowedOrigin || !["https:", "http:"].includes(origin.protocol)) throw new Error("embed_continuation_invalid");
    return parsed;
  }

  private readSignedClaims(token: string): EmbedTokenClaims {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error("embed_token_malformed");
    }
    const [payloadB64, sigB64] = parts;
    const expected = createHmac("sha256", this.secret.value).update(payloadB64).digest();
    const actual = Buffer.from(sigB64!, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("embed_token_invalid_signature");
    }
    const parsed = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8")) as EmbedTokenClaims;
    if (parsed.typ !== "aacp_embed_v1") {
      throw new Error("embed_token_wrong_type");
    }
    return parsed;
  }
}
