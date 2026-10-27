import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  EmbedScope,
  EmbedTokenClaims,
  EmbedTokenService,
} from "../../embed/domain/embed-token.service.js";

export const ACP_REQUIRED_SCOPES_KEY = "acpRequiredScopes";

export const RequireAcpScopes = (
  scopes: ReadonlyArray<EmbedScope>,
): MethodDecorator => SetMetadata(ACP_REQUIRED_SCOPES_KEY, [...scopes]);

type AcpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  acpClaims?: EmbedTokenClaims;
};

type AcpAuthError = {
  status: 401 | 403;
  code: string;
  reason: string;
};

function bearerToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers["authorization"] ?? headers["Authorization"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return undefined;
  const token = trimmed.slice("bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

function classifyTokenError(message: string): AcpAuthError {
  if (message === "embed_token_malformed") {
    return { status: 401, code: "token_malformed", reason: "Authorization bearer token is malformed" };
  }
  if (message === "embed_token_invalid_signature") {
    return { status: 401, code: "token_invalid_signature", reason: "Authorization bearer signature is invalid" };
  }
  if (message === "embed_token_wrong_type") {
    return { status: 401, code: "token_wrong_type", reason: "Authorization bearer is not an aacp_embed_v1 token" };
  }
  if (message === "embed_token_expired") {
    return { status: 401, code: "token_expired", reason: "Authorization bearer has expired" };
  }
  return { status: 401, code: "token_invalid", reason: "Authorization bearer is invalid" };
}

@Injectable()
export class AcpBearerGuard implements CanActivate {
  constructor(
    private readonly tokens: EmbedTokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AcpRequest>();
    const headers = (request.headers ?? {}) as Record<string, string | string[] | undefined>;

    const token = bearerToken(headers);
    if (!token) {
      throw new UnauthorizedException("missing_authorization_bearer");
    }

    let claims: EmbedTokenClaims;
    try {
      claims = this.tokens.verify(token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "token_invalid";
      const classified = classifyTokenError(message);
      const exception =
        classified.status === 403
          ? new ForbiddenException(classified.code)
          : new UnauthorizedException(classified.code);
      (exception as Error & { reason?: string }).reason = classified.reason;
      throw exception;
    }

    const requiredScopes = this.reflector.getAllAndOverride<EmbedScope[]>(
      ACP_REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredScopes && requiredScopes.length > 0) {
      const tokenScopes = claims.scopes ?? [];
      const missing = requiredScopes.filter((scope) => !tokenScopes.includes(scope));
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: "token_scope_not_granted",
          missing_scopes: missing,
        });
      }
    }

    request.acpClaims = claims;
    return true;
  }
}
