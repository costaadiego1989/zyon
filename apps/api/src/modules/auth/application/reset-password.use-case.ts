import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { assertStrongPassword } from "../domain/validators.js";

/**
 * Validates a reset token and updates the merchant password.
 */
@Injectable()
export class ResetPasswordUseCase {
  private readonly logger = new Logger(ResetPasswordUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(token: string, newPassword: string): Promise<{ success: true }> {
    if (!token?.trim()) throw new BadRequestException("token_required");
    assertStrongPassword(newPassword);

    const passwordHash = await this.passwordHasher.hash(newPassword);
    const consumed = await this.repo.consumePasswordReset(token, passwordHash, new Date());
    if (!consumed) throw new BadRequestException("invalid_or_expired_token");
    return { success: true };
  }
}
