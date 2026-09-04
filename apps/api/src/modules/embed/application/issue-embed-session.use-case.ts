import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { EmbedTokenService, type EmbedScope, type EmbedTokenClaims } from "../domain/embed-token.service.js";

const EMBED_SCOPES: readonly EmbedScope[] = [
  "checkout:start",
  "checkout:track",
  "checkout:chat",
  "offers:apply",
  "coupons:apply",
  "payment:intents:create",
  "payment:intents:confirm",
  "payment:intents:read",
];

/**
 * Scopes that handle real monetary operations: an `allowedOrigin` is required
 * for these when the environment is `live`, so that a leaked token cannot be
 * replayed from an arbitrary origin.
 */
const TRANSACTIONAL_SCOPES = new Set<EmbedScope>([
  "payment:intents:create",
  "payment:intents:confirm",
  "payment:intents:read",
  "offers:apply",
  "coupons:apply",
]);

@Injectable()
export class IssueEmbedSessionUseCase {
  private readonly logger = new Logger(IssueEmbedSessionUseCase.name);

  constructor(private readonly tokens: EmbedTokenService) {}

  execute(input: {
    merchantId: string;
    ttlSeconds: number;
    installationId?: string;
    environment?: "test" | "live";
    widgetVersion?: string;
    allowedOrigin?: string;
    scopes?: string[];
    cartRef?: string;
  }): {
    embed_session_token: string;
    expires_at_unix: number;
    installation_id: string | null;
    environment: "test" | "live" | null;
    widget_version: string | null;
  } {
    const now = Math.floor(Date.now() / 1000);
    const expiresAtUnix = now + Math.min(Math.max(input.ttlSeconds, 60), 86400);

    const allowedOrigin = validateAllowedOrigin(input.allowedOrigin);
    const scopes = sanitizeScopes(input.scopes);

    if (!allowedOrigin && scopes?.some((s) => TRANSACTIONAL_SCOPES.has(s))) {
      throw new BadRequestException("embed_allowed_origin_required_for_transactional_scopes");
    }

    const claims: EmbedTokenClaims = {
      typ: "aacp_embed_v1",
      merchantId: input.merchantId,
      installationId: input.installationId,
      environment: input.environment,
      widgetVersion: input.widgetVersion,
      issuedAtUnix: now,
      expiresAtUnix,
      nonce: crypto.randomUUID(),
      allowedOrigin,
      scopes,
      cartRef: sanitizeCartRef(input.cartRef)
    };

    const token = this.tokens.sign(claims);

    // M4: audit log for token issuance
    this.logger.log({
      event: "embed.token.issued",
      merchantId: input.merchantId,
      installationId: input.installationId ?? null,
      ttlSeconds: expiresAtUnix - now,
      scopes: scopes ?? [],
      allowedOrigin: allowedOrigin ?? null,
      environment: input.environment ?? null,
    });

    return {
      embed_session_token: token,
      expires_at_unix: expiresAtUnix,
      installation_id: input.installationId ?? null,
      environment: input.environment ?? null,
      widget_version: input.widgetVersion ?? null,
    };
  }
}

function validateAllowedOrigin(origin: string | undefined): string | undefined {
  const trimmed = origin?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestException("embed_allowed_origin_invalid");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new BadRequestException("embed_allowed_origin_invalid");
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new BadRequestException("embed_allowed_origin_must_be_https");
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
  if (!trimmed) return undefined;
  // L3 fix: reject oversized refs with 400 instead of silently truncating.
  if (trimmed.length > 120) {
    throw new BadRequestException("embed_cart_ref_too_long");
  }
  return trimmed;
}
