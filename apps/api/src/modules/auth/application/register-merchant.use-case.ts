import { BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException, Logger, Optional } from "@nestjs/common";
import { RECOVERY_TEMPLATE_INITIALIZER, type RecoveryTemplateInitializer } from "../../whatsapp-templates/domain/ports/recovery-template-lifecycle.port.js";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import type { MerchantIdGenerator } from "../domain/ports/merchant-id-generator.port.js";
import { MERCHANT_ID_GENERATOR } from "../domain/ports/merchant-id-generator.port.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { EmailAlreadyRegisteredError, MerchantOwnerNotCreatedError, MerchantSlugAlreadyTakenError, WeakPasswordError, InvalidEmailError } from "../domain/errors.js";
import { assertValidEmail, assertStrongPassword, normalizeEmail } from "../domain/validators.js";
import type { AuthResponse } from "../domain/auth.types.js";
import { toAuthResponse } from "./auth-response.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { generateUniqueSlug } from "../../../shared/utils/slugify.js";

export interface RegisterMerchantRequest {
  merchant_name: string;
  email: string;
  password: string;
  turnstile_token?: string;
}

export type { AuthResponse };

export { normalizeEmail };

export { toAuthResponse };

@Injectable()
export class RegisterMerchantUseCase {
  private readonly logger = new Logger(RegisterMerchantUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwt: JwtService,
    @Inject(MERCHANT_ID_GENERATOR) private readonly idGenerator: MerchantIdGenerator,
    @Optional() @Inject(RECOVERY_TEMPLATE_INITIALIZER) private readonly recoveryTemplates?: RecoveryTemplateInitializer,
  ) {}

  async execute(input: RegisterMerchantRequest): Promise<AuthResponse> {
    try {
      assertValidEmail(input.email);
      assertStrongPassword(input.password);

      if (!input.merchant_name?.trim()) {
        throw new BadRequestException("merchant_name_required");
      }

      const email = normalizeEmail(input.email);
      const existing = await this.repository.findUserByEmail(email);
      if (existing) throw new ConflictException("email_already_registered");

      const passwordHash = await this.passwordHasher.hash(input.password);
      const merchantId = this.idGenerator.generate();
      let created: Awaited<ReturnType<AuthRepository["createMerchantWithOwner"]>> | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const slug = await generateUniqueSlug(
          input.merchant_name.trim(),
          async (candidate) => !(await this.repository.isSlugTaken(candidate)),
        );
        try {
          created = await this.repository.createMerchantWithOwner({
            merchantId,
            merchantName: input.merchant_name.trim(),
            storeSlug: slug,
            email,
            passwordHash,
          });
          break;
        } catch (err: unknown) {
          if (!(err instanceof MerchantSlugAlreadyTakenError) || attempt === 2) throw err;
        }
      }
      if (!created) throw new InternalServerErrorException("merchant_creation_failed");

      await this.recoveryTemplates?.ensure(merchantId).catch(() => {
        this.logger.warn("Recovery template initialization deferred to monitor");
      });

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
