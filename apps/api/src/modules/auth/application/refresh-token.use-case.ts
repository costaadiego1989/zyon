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
    // Verify signature, accept within grace window (7 days default)
    const principal = this.jwt.verifyForRefresh(token);
    // Build new response using the shared factory
    return toAuthResponse(
      { id: principal.userId, merchantId: principal.merchantId, email: principal.email, role: principal.role },
      this.jwt
    );
  }
}
