import { Inject, Injectable, BadRequestException, Logger, Optional } from "@nestjs/common";
import { RECOVERY_TEMPLATE_INITIALIZER, type RecoveryTemplateInitializer } from "../../whatsapp-templates/domain/ports/recovery-template-lifecycle.port.js";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import { OAUTH_PROVIDER_PORT, type OAuthProviderPort } from "../domain/ports/oauth-provider.port.js";
import type { MerchantIdGenerator } from "../domain/ports/merchant-id-generator.port.js";
import { MERCHANT_ID_GENERATOR } from "../domain/ports/merchant-id-generator.port.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { normalizeEmail } from "../domain/validators.js";
import type { AuthResponse } from "../domain/auth.types.js";
import { toAuthResponse } from "./auth-response.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

export interface OAuthCallbackRequest {
  provider: "github" | "google";
  code: string;
  state: string;
}

export interface OAuthAuthResponse extends AuthResponse {
  onboarding_required: boolean;
  profile: { name: string; email: string };
}

@Injectable()
export class OAuthCallbackUseCase {
  private readonly logger = new Logger(OAuthCallbackUseCase.name);

  constructor(
    @Inject(OAUTH_PROVIDER_PORT) private readonly oauthProvider: OAuthProviderPort,
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(MERCHANT_ID_GENERATOR) private readonly idGenerator: MerchantIdGenerator,
    private readonly jwt: JwtService,
    @Optional() @Inject(RECOVERY_TEMPLATE_INITIALIZER) private readonly recoveryTemplates?: RecoveryTemplateInitializer,
  ) {}

  async execute(input: OAuthCallbackRequest): Promise<OAuthAuthResponse> {
    if (!input.provider || !input.code) {
      throw new BadRequestException("provider and code are required");
    }

    if (input.provider !== "github" && input.provider !== "google") {
      throw new BadRequestException("unsupported_oauth_provider");
    }

    // 1. Exchange code for profile
    const profile = await this.oauthProvider.exchangeCodeForProfile(input.provider, input.code);
    const email = normalizeEmail(profile.email);

    // 2. Check if user already exists by email
    const existingUser = await this.repository.findUserByEmail(email);

    if (existingUser?.disabledAt) throw new BadRequestException("account_disabled");
    if (existingUser) {
      // Link OAuth provider if not already linked
      if (!existingUser.oauthProvider) {
        await this.repository.linkOAuthToUser(existingUser.id, input.provider, profile.providerId);
      }
      const merchant = await this.repository.findMerchantById(existingUser.merchantId);
      return {
        ...(await toAuthResponse(existingUser, this.jwt)),
        onboarding_required: merchant?.oauthRegistrationPending === true,
        profile: { name: merchant?.ownerName || profile.name || "", email },
      };
    }

    // 3. New user — create merchant with OAuth owner
    const merchantId = this.idGenerator.generate();
    const merchantName = profile.name || email.split("@")[0]!;

    const created = await this.repository.createMerchantWithOAuthOwner({
      merchantId,
      merchantName,
      ownerName: profile.name || "",
      email,
      oauthProvider: input.provider,
      oauthProviderId: profile.providerId,
    });

    await this.recoveryTemplates?.ensure(merchantId).catch(() => {
      this.logger.warn("Recovery template initialization deferred to monitor");
    });

    return {
      ...(await toAuthResponse(created.user, this.jwt)),
      onboarding_required: true,
      profile: { name: profile.name || "", email },
    };
  }
}
