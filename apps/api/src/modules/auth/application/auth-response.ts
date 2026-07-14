/**
 * H2: Centralized AuthResponse construction.
 * Used by register, login, and refresh use-cases.
 */
import type { AuthResponse } from "../domain/auth.types.js";
import type { JwtService } from "../domain/services/jwt.service.js";

export function toAuthResponse(
  user: { id: string; merchantId: string; email: string; role: "owner" | "admin" },
  jwt: JwtService
): AuthResponse {
  return {
    merchant_id: user.merchantId,
    user_id: user.id,
    email: user.email,
    access_token: jwt.sign({
      userId: user.id,
      merchantId: user.merchantId,
      email: user.email,
      role: user.role
    }),
    token_type: "Bearer",
    expires_in: jwt.expiresIn()
  };
}
