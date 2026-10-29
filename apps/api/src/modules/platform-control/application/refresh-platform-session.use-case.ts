import { Injectable } from "@nestjs/common";
import { PlatformJwtService } from "../domain/services/platform-jwt.service.js";

@Injectable()
export class RefreshPlatformSessionUseCase {
  constructor(private readonly jwt: PlatformJwtService) {}

  async execute(token: string) {
    const refreshed = await this.jwt.rotate(token);
    return {
      operator_id: refreshed.principal.operatorId,
      email: refreshed.principal.email,
      role: refreshed.principal.role,
      access_token: refreshed.token,
      token_type: "Bearer" as const,
      expires_in: this.jwt.expiresIn(),
    };
  }

  async logout(token: string): Promise<void> {
    await this.jwt.revoke(token);
  }
}
