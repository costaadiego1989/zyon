import { createHmac, timingSafeEqual } from "node:crypto";

export type EmbedTokenSecret = { value: Buffer };

export type EmbedTokenClaims = {
  typ: "aacp_embed_v1";
  merchantId: string;
  issuedAtUnix: number;
  expiresAtUnix: number;
  nonce: string;
};

function embedSecret(): Buffer {
  const v = process.env.EMBED_TOKEN_SECRET;
  if (v && v.length >= 16) {
    return Buffer.from(v, "utf8");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("EMBED_TOKEN_SECRET must be set in production");
  }
  return Buffer.from("dev_embed_token_secret_32_characters_min!!", "utf8");
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
    const now = Math.floor(Date.now() / 1000);
    if (now > parsed.expiresAtUnix) {
      throw new Error("embed_token_expired");
    }
    return parsed;
  }
}
