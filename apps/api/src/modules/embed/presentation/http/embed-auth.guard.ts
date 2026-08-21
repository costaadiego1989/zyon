import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { EmbedScope, EmbedTokenClaims } from "../../domain/embed-token.service.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EMBED_REQUIRED_SCOPE_KEY } from "./embed-scope.decorator.js";
import { setTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";

/**
 * Scopes that handle real monetary operations — origin enforcement is mandatory
 * for these even at the guard level (defense-in-depth on top of issuance check).
 */
const TRANSACTIONAL_SCOPES = new Set<string>([
  "payment:intents:create",
  "payment:intents:confirm",
  "payment:intents:read",
  "offers:apply",
  "coupons:apply",
]);

type EmbedRequest = {
  headers?: Record<string, string | string[] | undefined>;
  embedClaims?: EmbedTokenClaims;
  tenantPrincipal?: unknown;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function readEmbedToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const embed = firstHeader(
    headers["x-aacp-embed-token"] ?? headers["X-AACP-Embed-Token"] ??
    headers["x-embed-session-token"] ?? headers["X-Embed-Session-Token"]
  );
  if (embed) return embed;

  const auth = firstHeader(headers.authorization ?? headers.Authorization);
  if (auth?.startsWith("Bearer ")) {
    const v = auth.slice("Bearer ".length).trim();
    if (v) return v;
  }
  return undefined;
}

function requestOrigin(headers: Record<string, string | string[] | undefined>): string | undefined {
  const origin = firstHeader(headers.origin ?? headers.Origin);
  if (origin) return normalizeOrigin(origin);

  const referer = firstHeader(headers.referer ?? headers.Referer ?? headers.referrer);
  if (referer) return normalizeOrigin(referer);
  return undefined;
}

function normalizeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

@Injectable()
export class EmbedAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: EmbedTokenService,
    @Optional() private readonly reflector?: Reflector
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<EmbedRequest>();
    const headers = (request.headers ?? {}) as Record<string, string | string[] | undefined>;

    // Dev bypass: allow requests with the __dev_bypass__ token when EMBED_DEV_BYPASS=true.
    // Uses x-dev-merchant-id header or falls back to MERCHANT_ID env var.
    if (process.env.EMBED_DEV_BYPASS === "true" && this.isDevBypassToken(headers)) {
      const devMerchantId =
        firstHeader(headers["x-dev-merchant-id"]) ||
        process.env.MERCHANT_ID ||
        "mrc_dev_seed";
      request.embedClaims = {
        typ: "aacp_embed_v1",
        merchantId: devMerchantId,
        issuedAtUnix: Math.floor(Date.now() / 1000),
        expiresAtUnix: Math.floor(Date.now() / 1000) + 86400,
        nonce: "dev_bypass",
        environment: "test",
        scopes: [
          "checkout:start",
          "checkout:track",
          "checkout:chat",
          "offers:apply",
          "coupons:apply",
          "payment:intents:create",
          "payment:intents:confirm",
          "payment:intents:read",
        ],
      };
      setTenantPrincipal(request as Parameters<typeof setTenantPrincipal>[0], {
        kind: "service",
        tenantId: devMerchantId,
        credentialId: "dev_bypass",
        environment: "test",
        scopes: request.embedClaims.scopes ?? [],
      });
      return true;
    }

    const token = readEmbedToken(headers);
    if (!token) {
      throw new UnauthorizedException("missing_embed_session_token");
    }

    let claims: EmbedTokenClaims;
    try {
      claims = this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException("invalid_embed_session_token");
    }

    this.enforceOrigin(claims, headers);
    this.enforceScope(claims, context);

    request.embedClaims = claims;

    // B3 fix: expose a service-type tenantPrincipal so the IdempotencyInterceptor
    // (and any other global interceptor that calls currentTenantPrincipal) can
    // resolve the tenant without throwing missing_tenant_principal.
    setTenantPrincipal(request as Parameters<typeof setTenantPrincipal>[0], {
      kind: "service",
      tenantId: claims.merchantId,
      credentialId: "embed_session",
      environment: claims.environment ?? "test",
      scopes: claims.scopes ?? [],
    });

    return true;
  }

  private isDevBypassToken(headers: Record<string, string | string[] | undefined>): boolean {
    const token = readEmbedToken(headers);
    if (!token) return true; // No token at all in dev → bypass
    return token === "__dev_bypass__";
  }

  private enforceOrigin(claims: EmbedTokenClaims, headers: Record<string, string | string[] | undefined>): void {
    // H4 fix: if no allowedOrigin is set on the token but it carries
    // transactional scopes, fail closed — the token should never have been
    // issued without an origin (C1 prevents this at issuance, but guard is
    // defense-in-depth).
    if (!claims.allowedOrigin) {
      if (claims.scopes?.some((s) => TRANSACTIONAL_SCOPES.has(s))) {
        throw new ForbiddenException("embed_origin_binding_required_for_transactional_scopes");
      }
      return;
    }
    const origin = requestOrigin(headers);
    // H3 fix: if the request provides no Origin/Referer header but the token
    // demands origin binding, reject (fail closed).
    if (!origin || origin !== claims.allowedOrigin) {
      throw new ForbiddenException("embed_origin_not_allowed");
    }
  }

  private enforceScope(claims: EmbedTokenClaims, context: ExecutionContext): void {
    // H1 fix: Only read scope from the handler (route method), not from the
    // controller class. This prevents parent-level scope declarations from
    // being inherited unpredictably by child routes.
    const required = this.reflector?.get<EmbedScope>(EMBED_REQUIRED_SCOPE_KEY, context.getHandler());
    if (!required) return;
    // Backward compat: tokens without explicit scopes field are treated as full-access
    // (v1 tokens issued before scope enforcement was added).
    if (!claims.scopes) return;
    if (!claims.scopes.includes(required)) {
      throw new ForbiddenException("embed_scope_not_granted");
    }
  }
}
