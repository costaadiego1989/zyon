import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { EmbedScope, EmbedTokenClaims } from "../../domain/embed-token.service.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EMBED_REQUIRED_SCOPE_KEY } from "./embed-scope.decorator.js";
import { setTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";

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
  const embed = firstHeader(headers["x-aacp-embed-token"] ?? headers["X-AACP-Embed-Token"]);
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

  private enforceOrigin(claims: EmbedTokenClaims, headers: Record<string, string | string[] | undefined>): void {
    if (!claims.allowedOrigin) return;
    const origin = requestOrigin(headers);
    if (!origin || origin !== claims.allowedOrigin) {
      throw new ForbiddenException("embed_origin_not_allowed");
    }
  }

  private enforceScope(claims: EmbedTokenClaims, context: ExecutionContext): void {
    const required = this.reflector?.getAllAndOverride<EmbedScope>(EMBED_REQUIRED_SCOPE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required) return;
    if (!claims.scopes || !claims.scopes.includes(required)) {
      throw new ForbiddenException("embed_scope_not_granted");
    }
  }
}
