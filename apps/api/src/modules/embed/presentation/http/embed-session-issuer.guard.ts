import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthCookieService } from "../../../auth/domain/services/auth-cookie.service.js";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import type { AuthenticatedPrincipal } from "../../../auth/domain/auth.types.js";
import { ApiKeyService } from "../../../integrations/domain/api-key.service.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../integrations/domain/ports/integrations.repository.port.js";
import type { MerchantApiKeyContext } from "../../../integrations/domain/integrations.types.js";

type IssuerRequest = {
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthenticatedPrincipal;
  apiKey?: MerchantApiKeyContext;
};

@Injectable()
export class EmbedSessionIssuerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly cookies: AuthCookieService,
    @Inject(INTEGRATIONS_REPOSITORY) private readonly integrations: IntegrationsRepository,
    private readonly apiKeys: ApiKeyService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IssuerRequest>();
    const headers = request.headers ?? {};
    const bearer = readBearer(headers);
    const cookieToken = this.cookies.read(readCookie(headers));
    const jwtToken = bearer ?? cookieToken;

    if (jwtToken) {
      try {
        request.user = this.jwt.verify(jwtToken);
        return true;
      } catch {
        // Bearer may be a server API key, so keep trying below.
      }
    }

    const rawApiKey = readExplicitApiKey(headers) ?? bearer;
    if (!rawApiKey) throw new UnauthorizedException("missing_embed_issuer_credentials");
    const apiKey = await this.integrations.findActiveApiKeyByHash(this.apiKeys.hash(rawApiKey));
    if (!apiKey || !apiKey.scopes.includes("embed:sessions:create")) {
      throw new UnauthorizedException("invalid_embed_issuer_api_key");
    }
    await this.integrations.touchApiKeyLastUsed(apiKey.id, new Date().toISOString());
    request.apiKey = {
      id: apiKey.id,
      merchantId: apiKey.merchantId,
      scopes: apiKey.scopes
    };
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
