import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import {
  BuyerJwtService,
  type BuyerPrincipal,
} from "../../domain/services/buyer-jwt.service.js";

/**
 * Optional variant of BuyerJwtAuthGuard. Used by anonymous-friendly storefront
 * flows (e.g. testimonial/video submissions) where a buyer's identity is a
 * nice-to-have but the endpoint stays open.
 *
 * Behavior:
 *  - No Authorization header → request.user stays undefined; canActivate
 *    returns true.
 *  - Bearer token present + valid → request.user = BuyerPrincipal; returns
 *    true.
 *  - Bearer token present + malformed/expired/wrong audience → returns true
 *    with request.user = undefined. We deliberately do NOT 401 here: the
 *    endpoint is public, and a malformed token must not turn into a denial.
 *    Downstream code reads request.user and uses globalUserId only when
 *    present.
 *
 * The strict variant in `buyer-jwt-auth.guard.ts` continues to enforce 401
 * for endpoints that genuinely require a buyer session.
 */
@Injectable()
export class OptionalBuyerJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: BuyerJwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: BuyerPrincipal }>();
    const header = request.headers?.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      return true;
    }
    const token = header.slice("Bearer ".length);
    if (!token) return true;
    try {
      const principal = this.jwt.verify(token);
      request.user = principal;
    } catch {
      request.user = undefined;
    }
    return true;
  }
}
