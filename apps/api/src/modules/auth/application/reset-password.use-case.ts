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

    const reset = await this.repo.findPasswordResetToken(token);
    if (!reset) throw new BadRequestException("invalid_or_expired_token");
    if (reset.expiresAt < new Date()) {
      await this.repo.deletePasswordResetToken(token);
      throw new BadRequestException("token_expired");
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.repo.updatePassword(reset.userId, passwordHash);
    await this.repo.deletePasswordResetToken(token);

    this.logger.log(`Password reset completed for user ${reset.userId}`);
    return { success: true };
  }
}
