import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import {
  setTenantPrincipal,
  type TenantPrincipalRequest
} from "../../../shared/auth/tenant-principal.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { JwtService } from "../domain/services/jwt.service.js";

const logger = new Logger("AuthGuard");

/**
 * H3: Populated both request.user and tenantPrincipal.
 * M4: Preserve JWT error codes in structured logging.
 * L1: Narrow authorization header type (handle array).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly cookies: AuthCookieService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // L1: Narrow header type — handle array case
    const header = request.headers?.authorization;
    const authHeader = Array.isArray(header) ? header[0] : header;
    const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : this.cookies.read(request.headers?.cookie);
    if (!token) {
      throw new UnauthorizedException("missing_bearer_token");
    }
    try {
      const user = this.jwt.verify(token);
      // B1 (P0): Guarantee tenantId is non-empty before any query
      if (!user.merchantId) {
        throw new UnauthorizedException("invalid_bearer_token");
      }
      request.user = user;
      setTenantPrincipal(request as TenantPrincipalRequest, {
        kind: "human",
        tenantId: user.merchantId,
        userId: user.userId,
        email: user.email,
        role: user.role
      });
      return true;
    } catch (err: unknown) {
      // M4: Preserve JWT error code in structured log
      const errorCode = err instanceof Error ? err.message : String(err);
      logger.debug(`JWT verification failed: ${errorCode}`);
      throw new UnauthorizedException("invalid_bearer_token");
    }
  }
}

/**
 * H3, L11: Deprecated — use currentTenantPrincipal from shared/auth/tenant-principal.js instead.
 * Kept for backward compatibility during migration.
 * @deprecated Use currentTenantPrincipal from shared/auth instead.
 */
export function currentUser(request: { user?: unknown }) {
  if (!request.user) throw new UnauthorizedException("missing_authenticated_user");
  return request.user as { userId: string; merchantId: string; email: string; role: "owner" | "admin" };
}
