import { Injectable } from "@nestjs/common";
import { EmbedTokenService, type EmbedScope, type EmbedTokenClaims } from "../domain/embed-token.service.js";

const EMBED_SCOPES: readonly EmbedScope[] = [
  "checkout:start",
  "checkout:track",
  "checkout:chat",
  "offers:apply",
  "coupons:apply",
  "payment:intents:create"
];

@Injectable()
export class IssueEmbedSessionUseCase {
  constructor(private readonly tokens: EmbedTokenService) {}

  execute(input: { merchantId: string; ttlSeconds: number; allowedOrigin?: string; scopes?: string[]; cartRef?: string }): {
    embed_session_token: string;
    expires_at_unix: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const expiresAtUnix = now + Math.min(Math.max(input.ttlSeconds, 60), 86400);

    const claims: EmbedTokenClaims = {
      typ: "aacp_embed_v1",
      merchantId: input.merchantId,
      issuedAtUnix: now,
      expiresAtUnix,
      nonce: crypto.randomUUID(),
      allowedOrigin: validateAllowedOrigin(input.allowedOrigin),
      scopes: sanitizeScopes(input.scopes),
      cartRef: sanitizeCartRef(input.cartRef)
    };

    return {
      embed_session_token: this.tokens.sign(claims),
      expires_at_unix: expiresAtUnix
    };
  }
}

function validateAllowedOrigin(origin: string | undefined): string | undefined {
  const trimmed = origin?.trim();
  if (!trimmed) return undefined;
  const url = new URL(trimmed);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("embed_allowed_origin_invalid");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("embed_allowed_origin_must_be_https");
  }
  return url.origin;
}

function sanitizeScopes(scopes: string[] | undefined): EmbedScope[] | undefined {
  if (!scopes?.length) return undefined;
  const allowed = new Set<string>(EMBED_SCOPES);
  const clean = Array.from(new Set(scopes.filter((scope): scope is EmbedScope => allowed.has(scope))));
  return clean.length ? clean : undefined;
}

function sanitizeCartRef(cartRef: string | undefined): string | undefined {
  const trimmed = cartRef?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}
