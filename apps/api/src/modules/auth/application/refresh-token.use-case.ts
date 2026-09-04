import { Injectable , Logger} from "@nestjs/common";
import { JwtService } from "../domain/services/jwt.service.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import type { AuthResponse } from "../domain/auth.types.js";
import { toAuthResponse } from "./auth-response.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

/**
 * H2, M13: Dedicated RefreshTokenUseCase.
 * Constructs AuthResponse consistently via toAuthResponse factory.
 * Token extraction (header vs cookie) remains in the controller (HTTP concern).
 */
@Injectable()
export class RefreshTokenUseCase {
  private readonly logger = new Logger(RefreshTokenUseCase.name);

  constructor(
    private readonly jwt: JwtService
  ) {}

  execute(token: string): AuthResponse {
    // Parse token to extract jti without full verification (we'll verify below)
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("jwt_malformed");
    const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp: number; jti: string };

    // Verify signature, accept within grace window (7 days default)
    const principal = this.jwt.verifyForRefresh(token);

    // Revoke the old refresh token immediately
    this.jwt.revokeToken(decoded.jti, decoded.exp);

    // Build new response using the shared factory
    return toAuthResponse(
      { id: principal.userId, merchantId: principal.merchantId, email: principal.email, role: principal.role },
      this.jwt
    );
  }
}
