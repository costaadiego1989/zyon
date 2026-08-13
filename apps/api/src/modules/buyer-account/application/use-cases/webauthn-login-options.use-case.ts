import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { WebAuthnChallengeService } from "../../domain/services/webauthn-challenge.service.js";
import type { WebAuthnCredentialStore } from "../../domain/ports/webauthn-credential.port.js";
import { WEBAUTHN_CREDENTIAL_STORE } from "../../domain/ports/webauthn-credential.port.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY } from "../../domain/ports/buyer-account-repository.port.js";

export interface LoginOptionsRequest {
  email?: string;
}

export interface LoginOptionsResponse {
  challenge: string;
  allowCredentials: Array<{ id: string; type: "public-key" }>;
  timeout: number;
  userVerification: "required";
}

export interface WebAuthnLoginOptionsDeps {
  challengeService: WebAuthnChallengeService;
  credentialStore: WebAuthnCredentialStore;
  rpId: string;
  buyerRepo?: BuyerAccountRepository;
}

/**
 * Generate a login challenge for a buyer who wants to authenticate via biometric.
 * If email is provided, we pre-populate allowCredentials with all credentials
 * linked to that buyer. If not, the client uses conditional UI.
 *
 * Scope key is `login` so verify MUST consume from the same scope.
 */
@Injectable()
export class WebAuthnLoginOptionsUseCase {
  private readonly challengeService: WebAuthnChallengeService;
  private readonly credentialStore: WebAuthnCredentialStore;
  private readonly rpId: string;
  private readonly buyerRepo?: BuyerAccountRepository;

  constructor(
    challengeService: WebAuthnChallengeService,
    credentialStore: WebAuthnCredentialStore,
    rpMetadata: { rpId: string },
    buyerRepo?: BuyerAccountRepository,
  );
  constructor(deps: WebAuthnLoginOptionsDeps);
  constructor(
    @Inject(WebAuthnChallengeService) depsOrChallengeService: WebAuthnLoginOptionsDeps | WebAuthnChallengeService,
    @Inject(WEBAUTHN_CREDENTIAL_STORE) credentialStore?: WebAuthnCredentialStore,
    @Inject("WebAuthnRpMetadata") rpMetadata?: { rpId: string },
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) buyerRepo?: BuyerAccountRepository,
  ) {
    if (depsOrChallengeService instanceof WebAuthnChallengeService) {
      this.challengeService = depsOrChallengeService;
      this.credentialStore = credentialStore!;
      this.rpId = rpMetadata!.rpId;
      this.buyerRepo = buyerRepo;
    } else {
      this.challengeService = depsOrChallengeService.challengeService;
      this.credentialStore = depsOrChallengeService.credentialStore;
      this.rpId = depsOrChallengeService.rpId;
      this.buyerRepo = depsOrChallengeService.buyerRepo;
    }
  }

  async execute(input: LoginOptionsRequest): Promise<LoginOptionsResponse> {
    let allowCredentials: Array<{ id: string; type: "public-key" }> = [];

    if (input.email) {
      if (this.buyerRepo) {
        const buyer = await this.buyerRepo.findByEmail(input.email.toLowerCase().trim());
        if (buyer) {
          const creds = await this.credentialStore.listByGlobalUserId(buyer.globalUserId);
          allowCredentials = creds.map((c) => ({ id: c.credentialId, type: "public-key" as const }));
        }
      } else if (this.credentialStore.listAll) {
        // Fallback for tests: list all credentials when buyerRepo is unavailable
        const creds = await this.credentialStore.listAll();
        allowCredentials = creds.map((c) => ({ id: c.credentialId, type: "public-key" as const }));
      }

      if (allowCredentials.length === 0) {
        throw new NotFoundException("no_registered_credentials");
      }
    }

    const issued = this.challengeService.issue("login");

    return {
      challenge: issued.challenge,
      allowCredentials,
      timeout: 60_000,
      userVerification: "required",
    };
  }
}
