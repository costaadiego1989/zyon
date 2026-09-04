import { Inject, Injectable, BadRequestException , Logger} from "@nestjs/common";
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

@Injectable()
export class OAuthCallbackUseCase {
  private readonly logger = new Logger(OAuthCallbackUseCase.name);

  constructor(
    @Inject(OAUTH_PROVIDER_PORT) private readonly oauthProvider: OAuthProviderPort,
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(MERCHANT_ID_GENERATOR) private readonly idGenerator: MerchantIdGenerator,
    private readonly jwt: JwtService
  ) {}

  async execute(input: OAuthCallbackRequest): Promise<AuthResponse> {
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

    if (existingUser) {
      // Link OAuth provider if not already linked
      if (!existingUser.oauthProvider) {
        await this.repository.linkOAuthToUser(existingUser.id, input.provider, profile.providerId);
      }
      return toAuthResponse(existingUser, this.jwt);
    }

    // 3. New user — create merchant with OAuth owner
    const merchantId = this.idGenerator.generate();
    const merchantName = profile.name || email.split("@")[0]!;

    const created = await this.repository.createMerchantWithOAuthOwner({
      merchantId,
      merchantName,
      email,
      oauthProvider: input.provider,
      oauthProviderId: profile.providerId,
    });

    return toAuthResponse(created.user, this.jwt);
  }
}
