import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";

export interface UpdateMeInput {
  merchantId: string;
  name: string;
  phone?: string;
}

/**
 * Updates owner profile (name, phone). Email is intentionally NOT in this use case —
 * use the email-change OTP flow instead.
 */
@Injectable()
export class UpdateMeUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
  ) {}

  async execute(input: UpdateMeInput) {
    const name = input.name?.trim();
    if (!name || name.length < 2) throw new BadRequestException("name_too_short");
    if (name.length > 80) throw new BadRequestException("name_too_long");

    const phone = (input.phone ?? "").trim();
    if (phone.length > 20) throw new BadRequestException("phone_too_long");

    const profile = await this.repo.getOwnerProfile(input.merchantId);
    if (!profile) throw new NotFoundException("owner_profile_not_found");

    await this.repo.updateOwnerProfile(profile.userId, input.merchantId, {
      ownerName: name,
      ownerPhone: phone,
    });

    return { name, phone };
  }
}
