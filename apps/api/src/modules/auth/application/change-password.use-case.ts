import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from "../domain/ports/auth-repository.port.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { assertStrongPassword } from "../domain/validators.js";
import { InvalidCredentialsError } from "../domain/errors.js";

export interface ChangePasswordInput {
  merchantId: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * Validates the current password and applies a new hashed password.
 * No OTP — the current password itself is the second factor.
 */
@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: ChangePasswordInput): Promise<{ success: true }> {
    if (!input.currentPassword) throw new BadRequestException("current_password_required");
    assertStrongPassword(input.newPassword);

    const profile = await this.repo.getOwnerProfile(input.merchantId);
    if (!profile) throw new NotFoundException("owner_profile_not_found");

    const user = await this.repo.findUserByEmail(profile.email);
    if (!user || !user.passwordHash) {
      throw new InvalidCredentialsError();
    }

    const verified = await this.hasher.verify(input.currentPassword, user.passwordHash);
    if (!verified.valid) throw new InvalidCredentialsError();

    const newHash = await this.hasher.hash(input.newPassword);
    await this.repo.updatePassword(user.id, newHash);

    return { success: true };
  }
}
