import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";

export interface ChangeBuyerPasswordRequest {
  globalUserId: string;
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class ChangeBuyerPasswordUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    private readonly hasher: PasswordHasher
  ) {}

  async execute(input: ChangeBuyerPasswordRequest): Promise<void> {
    if (!input.newPassword || input.newPassword.length < 8) {
      throw new Error("buyer_password_too_short");
    }
    const account = await this.repo.findByGlobalUserId(input.globalUserId);
    if (!account) throw new NotFoundException("buyer_account_not_found");
    const valid = await this.hasher.verify(input.currentPassword, account.passwordHash);
    if (!valid) throw new UnauthorizedException("invalid_current_password");
    const newHash = await this.hasher.hash(input.newPassword);
    const updated = account.withNewPasswordHash(newHash);
    await this.repo.save(updated);
  }
}
