import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { M2mHmacGuard } from "./m2m-hmac.guard.js";

/**
 * M2mDualAuthGuard — Accepts EITHER:
 * 1. JWT/Cookie auth (merchant using dashboard or API key)
 * 2. HMAC auth (external buyer agent with m2m secret)
 *
 * Tries JWT first. If it fails (no token/invalid), tries HMAC.
 * At least one must succeed or request is rejected.
 */
@Injectable()
export class M2mDualAuthGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: AuthGuard,
    @Optional() private readonly hmacGuard?: M2mHmacGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Try JWT/cookie first (merchant auth)
    try {
      const result = await this.jwtGuard.canActivate(context);
      if (result) return true;
    } catch {
      // JWT failed — try HMAC
    }

    // Try HMAC (M2M agent auth)
    if (this.hmacGuard) {
      return this.hmacGuard.canActivate(context);
    }

    // Neither worked
    throw new (await import("@nestjs/common")).UnauthorizedException("missing_credentials");
  }
}
