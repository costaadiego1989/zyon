import { Injectable } from "@nestjs/common";
import { JwtService } from "../domain/services/jwt.service.js";
import type { AuthResponse } from "../domain/auth.types.js";

@Injectable()
export class RefreshTokenUseCase {
  constructor(private readonly jwt: JwtService) {}
  async execute(token: string): Promise<AuthResponse> {
    const rotated = await this.jwt.rotate(token);
    return { merchant_id: rotated.principal.merchantId, user_id: rotated.principal.userId,
      email: rotated.principal.email, access_token: rotated.token, token_type: "Bearer", expires_in: this.jwt.expiresIn() };
  }
  async logout(token: string): Promise<void> { await this.jwt.revoke(token); }
}
