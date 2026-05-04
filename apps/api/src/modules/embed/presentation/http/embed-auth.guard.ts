import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { EmbedTokenClaims } from "../../domain/embed-token.service.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";

function readEmbedToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const rawEmbed = headers["x-aacp-embed-token"] ?? headers["X-AACP-Embed-Token"];
  const embedFirst = Array.isArray(rawEmbed) ? rawEmbed[0] : rawEmbed;
  if (embedFirst?.trim()) return embedFirst.trim();

  const rawAuth = headers.authorization ?? headers.Authorization;
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const v = auth.slice("Bearer ".length).trim();
    if (v) return v;
  }
  return undefined;
}

@Injectable()
export class EmbedAuthGuard implements CanActivate {
  constructor(private readonly tokens: EmbedTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers?: unknown; embedClaims?: EmbedTokenClaims }>();
    const headers = (request.headers ?? {}) as Record<string, string | string[] | undefined>;
    const tok = readEmbedToken(headers);
    if (!tok) {
      throw new UnauthorizedException("missing_embed_session_token");
    }
    try {
      request.embedClaims = this.tokens.verify(tok);
      return true;
    } catch {
      throw new UnauthorizedException("invalid_embed_session_token");
    }
  }
}
