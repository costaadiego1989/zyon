import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import { JwtService } from "../domain/services/jwt.service.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly cookies: AuthCookieService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : this.cookies.read(request.headers?.cookie);
    if (!token) {
      throw new UnauthorizedException("missing_bearer_token");
    }
    try {
      request.user = this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException("invalid_bearer_token");
    }
  }
}

export function currentUser(request: { user?: unknown }) {
  if (!request.user) throw new UnauthorizedException("missing_authenticated_user");
  return request.user as { userId: string; merchantId: string; email: string; role: "owner" | "admin" };
}
