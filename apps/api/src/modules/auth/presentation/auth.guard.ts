import { ForbiddenException } from "@nestjs/common";
import { requireStaffAccess } from "./staff-access.js";
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      const user = await this.jwt.authenticate(token);
      // B1 (P0): Guarantee tenantId is non-empty before any query
      if (!user.merchantId) {
        throw new UnauthorizedException("invalid_bearer_token");
      }
      requireStaffAccess(context, user.role);
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
      if (err instanceof ForbiddenException) throw err;
      // M4: Preserve JWT error code in structured log
      const knownErrors = new Set(["jwt_expired", "jwt_invalid_signature", "jwt_invalid_claims", "jwt_invalid_header",
        "jwt_invalid_role", "jwt_malformed", "jwt_wrong_audience", "jwt_missing_merchant_id", "jwt_session_invalid"]);
      const errorCode = err instanceof Error && knownErrors.has(err.message) ? err.message : "auth_session_lookup_failed";
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
  return request.user as { userId: string; merchantId: string; email: string; role: "owner" | "admin" | "staff" };
}
