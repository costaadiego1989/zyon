import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { BuyerJwtService, type BuyerPrincipal } from "../../domain/services/buyer-jwt.service.js";

@Injectable()
export class BuyerJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: BuyerJwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const header = request.headers?.authorization;
    const token =
      typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!token) throw new UnauthorizedException("missing_bearer_token");
    try {
      request.user = this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException("invalid_bearer_token");
    }
  }
}

export function currentBuyer(request: { user?: unknown }): BuyerPrincipal {
  if (!request.user) throw new UnauthorizedException("missing_authenticated_buyer");
  return request.user as BuyerPrincipal;
}
