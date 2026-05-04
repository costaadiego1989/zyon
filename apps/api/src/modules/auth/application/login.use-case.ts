import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { normalizeEmail, toAuthResponse, type AuthResponse } from "./register-merchant.use-case.js";

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwt: JwtService
  ) {}

  async execute(input: { email: string; password: string }): Promise<AuthResponse> {
    const user = await this.repository.findUserByEmail(normalizeEmail(input.email));
    if (!user) throw new UnauthorizedException("invalid_credentials");
    const valid = await this.passwordHasher.verify(input.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("invalid_credentials");
    return toAuthResponse(user, this.jwt);
  }
}
