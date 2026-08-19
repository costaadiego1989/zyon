import { BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException , Logger} from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import type { MerchantIdGenerator } from "../domain/ports/merchant-id-generator.port.js";
import { MERCHANT_ID_GENERATOR } from "../domain/ports/merchant-id-generator.port.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { EmailAlreadyRegisteredError, MerchantOwnerNotCreatedError, WeakPasswordError, InvalidEmailError } from "../domain/errors.js";
import { assertValidEmail, assertStrongPassword, normalizeEmail } from "../domain/validators.js";
import type { AuthResponse } from "../domain/auth.types.js";
import { toAuthResponse } from "./auth-response.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { generateUniqueSlug } from "../../../shared/utils/slugify.js";

/**
 * H6: Removed merchant_id from request — always server-generated.
 * H5: Added input validation (email format + password strength).
 * M11: MerchantIdGenerator injected via port.
 * M1: EmailAlreadyRegisteredError mapped to 409 without string sniffing.
 */
export interface RegisterMerchantRequest {
  merchant_name: string;
  email: string;
  password: string;
}

export type { AuthResponse };

/**
 * @deprecated — import from application/auth-response.ts or domain/auth.types.ts
 */
export { normalizeEmail };

/**
 * @deprecated — import from application/auth-response.ts
 */
export { toAuthResponse };

@Injectable()
export class RegisterMerchantUseCase {
  private readonly logger = new Logger(RegisterMerchantUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwt: JwtService,
    @Inject(MERCHANT_ID_GENERATOR) private readonly idGenerator: MerchantIdGenerator
  ) {}

  async execute(input: RegisterMerchantRequest): Promise<AuthResponse> {
    try {
      // H5: Validate inputs at use-case boundary
      assertValidEmail(input.email);
      assertStrongPassword(input.password);

      if (!input.merchant_name?.trim()) {
        throw new BadRequestException("merchant_name_required");
      }

      const email = normalizeEmail(input.email);
      const existing = await this.repository.findUserByEmail(email);
      if (existing) throw new ConflictException("email_already_registered");

      const passwordHash = await this.passwordHasher.hash(input.password);
      // M11: Generate merchantId via the port
      const merchantId = this.idGenerator.generate();

      const created = await this.repository.createMerchantWithOwner({
        merchantId,
        merchantName: input.merchant_name.trim(),
        email,
        passwordHash
      });

      // Auto-generate slug from merchant name
      const slug = await generateUniqueSlug(
        input.merchant_name.trim(),
        async (candidate) => {
          const taken = await this.repository.isSlugTaken(candidate);
          return !taken;
        },
      );

      // Persist slug in storeSettings
      await this.repository.setStoreSettings(merchantId, { slug });

      return toAuthResponse(created.user, this.jwt);
    } catch (err: unknown) {
      if (err instanceof EmailAlreadyRegisteredError) {
        throw new ConflictException("email_already_registered");
      }
      if (err instanceof MerchantOwnerNotCreatedError) {
        throw new InternalServerErrorException(err.code);
      }
      if (err instanceof WeakPasswordError || err instanceof InvalidEmailError) {
        throw new BadRequestException(err.code);
      }
      throw err;
    }
  }
}
