import { Injectable } from "@nestjs/common";
import type { AuthResponse, AuthenticatedPrincipal } from "../../auth/domain/auth.types.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { MerchantStoreService } from "./merchant-store.service.js";

@Injectable()
export class ActivateMerchantStoreUseCase {
  constructor(
    private readonly stores: MerchantStoreService,
    private readonly jwt: JwtService,
  ) {}

  async execute(actor: AuthenticatedPrincipal, targetMerchantId: string): Promise<AuthResponse> {
    const active = await this.stores.activate({
      userId: actor.userId,
      merchantId: actor.merchantId,
      role: actor.role,
    }, targetMerchantId);
    const authVersion = actor.authVersion ?? 0;
    return {
      merchant_id: active.merchantId,
      user_id: actor.userId,
      email: actor.email,
      access_token: await this.jwt.issue({
        userId: actor.userId,
        merchantId: active.merchantId,
        email: actor.email,
        role: active.role,
        authVersion,
      }, authVersion),
      token_type: "Bearer",
      expires_in: this.jwt.expiresIn(),
    };
  }
}
