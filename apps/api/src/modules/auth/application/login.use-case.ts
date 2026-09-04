import { Inject, Injectable, UnauthorizedException , Logger} from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { InvalidCredentialsError } from "../domain/errors.js";
import { normalizeEmail } from "../domain/validators.js";
import type { AuthResponse } from "../domain/auth.types.js";
import { toAuthResponse } from "./auth-response.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

/**
 * L13: Throws domain InvalidCredentialsError instead of Nest UnauthorizedException.
 * The controller maps it to HTTP 401.
 */
@Injectable()
export class LoginUseCase {
  private readonly logger = new Logger(LoginUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwt: JwtService
  ) {}

  async execute(input: { email: string; password: string }): Promise<AuthResponse> {
    const user = await this.repository.findUserByEmail(normalizeEmail(input.email));
    if (!user || !user.passwordHash) throw new InvalidCredentialsError();
    const { valid } = await this.passwordHasher.verify(input.password, user.passwordHash);
    if (!valid) throw new InvalidCredentialsError();
    return toAuthResponse(user, this.jwt);
  }
}
