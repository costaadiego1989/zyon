import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  setTenantPrincipal,
  type TenantPrincipal,
} from "../../../../shared/auth/tenant-principal.js";
import { AuthCookieService } from "../../../auth/domain/services/auth-cookie.service.js";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import type { AuthenticatedPrincipal } from "../../../auth/domain/auth.types.js";
import { AuthenticateMerchantApiKeyService } from "../../../integrations/application/authenticate-merchant-api-key.service.js";
import { hasApiKeyScope } from "../../../integrations/domain/api-key-scope.js";
import type { MerchantApiKeyContext } from "../../../integrations/domain/integrations.types.js";

type IssuerRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: AuthenticatedPrincipal;
  apiKey?: MerchantApiKeyContext;
  tenantPrincipal?: TenantPrincipal;
};

@Injectable()
export class EmbedSessionIssuerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly cookies: AuthCookieService,
    private readonly authenticateApiKey: AuthenticateMerchantApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IssuerRequest>();
    const headers = request.headers ?? {};
    const bearer = readBearer(headers);
    const cookieToken = this.cookies.read(readCookie(headers));
    const jwtToken = bearer ?? cookieToken;

    if (jwtToken) {
      try {
        const user = this.jwt.verify(jwtToken);
        request.user = user;
        setTenantPrincipal(request, {
          kind: "human",
          tenantId: user.merchantId,
          userId: user.userId,
          email: user.email,
          role: user.role,
        });
        return true;
      } catch {
        // Bearer may be a server API key, so keep trying below.
      }
    }

    const rawApiKey = readExplicitApiKey(headers) ?? bearer;
    if (!rawApiKey) throw new UnauthorizedException("missing_embed_issuer_credentials");
    const apiKey = await this.authenticateApiKey.execute(rawApiKey, request.ip);
    if (!hasApiKeyScope(apiKey.scopes, "embed:sessions:create")) {
      throw new UnauthorizedException("invalid_embed_issuer_api_key");
    }
    request.apiKey = apiKey;
    setTenantPrincipal(request, {
      kind: "service",
      tenantId: apiKey.merchantId,
      credentialId: apiKey.id,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
    });
    return true;
  }
}

export function currentEmbedIssuer(request: IssuerRequest): { merchantId: string; type: "dashboard" | "api_key" } {
  if (request.user) return { merchantId: request.user.merchantId, type: "dashboard" };
  if (request.apiKey) return { merchantId: request.apiKey.merchantId, type: "api_key" };
  throw new UnauthorizedException("missing_embed_issuer_context");
}

function readBearer(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : undefined;
}

function readExplicitApiKey(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers["x-aacp-api-key"] ?? headers["X-AACP-API-Key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

function readCookie(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers.cookie ?? headers.Cookie;
  return Array.isArray(raw) ? raw[0] : raw;
}
