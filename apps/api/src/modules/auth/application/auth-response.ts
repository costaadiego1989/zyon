/**
 * H2: Centralized AuthResponse construction.
 * Used by register, login, and refresh use-cases.
 */
import type { AuthResponse, AuthUser } from "../domain/auth.types.js";
import type { JwtService } from "../domain/services/jwt.service.js";

export async function toAuthResponse(
  user: AuthUser,
  jwt: JwtService
): Promise<AuthResponse> {
  return {
    merchant_id: user.merchantId,
    user_id: user.id,
    email: user.email,
    access_token: await jwt.issue({
      userId: user.id,
      merchantId: user.merchantId,
      email: user.email,
      role: user.role
    }, user.authVersion ?? 0),
    token_type: "Bearer",
    expires_in: jwt.expiresIn()
  };
}
