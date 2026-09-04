import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";

/**
 * Loads the account settings profile (name, email, phone) for the
 * authenticated merchant owner.
 */
@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
  ) {}

  async execute(merchantId: string) {
    const profile = await this.repo.getOwnerProfile(merchantId);
    if (!profile) throw new NotFoundException("owner_profile_not_found");
    return {
      user_id: profile.userId,
      merchant_id: profile.merchantId,
      name: profile.ownerName,
      email: profile.email,
      phone: profile.ownerPhone,
      role: profile.role,
    };
  }
}
