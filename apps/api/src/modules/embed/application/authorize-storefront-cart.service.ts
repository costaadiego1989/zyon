import { Injectable, UnauthorizedException } from "@nestjs/common";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";

@Injectable()
export class AuthorizeStorefrontCartService {
  constructor(private readonly capabilities: RealtimeCapabilityService) {}

  authorize(input: { token: unknown; merchantId: string; cartRef: string; origin: string }): string {
    try {
      const claims = this.capabilities.verify(input.token, "storefront-conversation", input.origin);
      if (claims.origin !== input.origin || claims.merchantId !== input.merchantId || claims.resourceId !== input.cartRef) {
        throw new Error("cart_binding_mismatch");
      }
      return claims.resourceId;
    } catch {
      throw new UnauthorizedException("public_embed_cart_ownership_required");
    }
  }
}
