import { Injectable, BadRequestException, NotFoundException, Inject, Optional , Logger} from "@nestjs/common";
import { WebAuthnVerifierService } from "../../domain/services/webauthn-verifier.service.js";
import { WebAuthnChallengeService } from "../../domain/services/webauthn-challenge.service.js";
import type { WebAuthnCredentialStore } from "../../domain/ports/webauthn-credential.port.js";
import { WEBAUTHN_CREDENTIAL_STORE } from "../../domain/ports/webauthn-credential.port.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY } from "../../domain/ports/buyer-account-repository.port.js";
import { WebAuthnCredential } from "../../domain/entities/webauthn-credential.entity.js";
import { randomUUID } from "node:crypto";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface RegisterVerifyRequest {
  buyer_id: string;
  credential: {
    id: string;
    rawId: string;
    authenticatorData: string; // base64url
    clientDataJSON: string; // base64url
    type: "public-key";
  };
  challenge: Uint8Array;
}

export interface RegisterVerifyResponse {
  credential_id: string;
  created_at: string;
}

export interface WebAuthnRegisterVerifyDeps {
  verifier: WebAuthnVerifierService;
  challengeService: WebAuthnChallengeService;
  credentialStore: WebAuthnCredentialStore;
  buyerRepo: BuyerAccountRepository;
}

@Injectable()
export class WebAuthnRegisterVerifyUseCase {
  private readonly logger = new Logger(WebAuthnRegisterVerifyUseCase.name);

  private readonly verifier: WebAuthnVerifierService;
  private readonly challengeService: WebAuthnChallengeService;
  private readonly credentialStore: WebAuthnCredentialStore;
  private readonly buyerRepo: BuyerAccountRepository;

  constructor(
    verifier: WebAuthnVerifierService,
    challengeService: WebAuthnChallengeService,
    credentialStore: WebAuthnCredentialStore,
    buyerRepo: BuyerAccountRepository,
  );
  constructor(deps: WebAuthnRegisterVerifyDeps);
  constructor(
    @Inject(WebAuthnVerifierService) verifierOrDeps: WebAuthnVerifierService | WebAuthnRegisterVerifyDeps,
    challengeService?: WebAuthnChallengeService,
    @Inject(WEBAUTHN_CREDENTIAL_STORE) credentialStore?: WebAuthnCredentialStore,
    @Inject(BUYER_ACCOUNT_REPOSITORY) buyerRepo?: BuyerAccountRepository,
  ) {
    if (verifierOrDeps instanceof WebAuthnVerifierService) {
      this.verifier = verifierOrDeps;
      this.challengeService = challengeService!;
      this.credentialStore = credentialStore!;
      this.buyerRepo = buyerRepo!;
    } else {
      this.verifier = verifierOrDeps.verifier;
      this.challengeService = verifierOrDeps.challengeService;
      this.credentialStore = verifierOrDeps.credentialStore;
      this.buyerRepo = verifierOrDeps.buyerRepo;
    }
  }

  async execute(input: RegisterVerifyRequest): Promise<RegisterVerifyResponse> {
    if (!input.buyer_id) throw new BadRequestException("webauthn_register_missing_buyer_id");
    const buyer = await this.buyerRepo.findByGlobalUserId(input.buyer_id);
    if (!buyer) throw new NotFoundException("buyer_account_not_found");

    // Verify challenge scope
    const challengeB64 = Buffer.from(input.challenge).toString("base64url");
    const consumed = await this.challengeService.consume(challengeB64, `register:${buyer.globalUserId}`);
    if (!consumed) throw new BadRequestException("webauthn_challenge_invalid_or_expired");

    if (input.credential.id !== input.credential.rawId) {
      throw new BadRequestException("webauthn_credential_id_mismatch");
    }
    let verified: Awaited<ReturnType<WebAuthnVerifierService["verifyRegistration"]>>;
    try {
      verified = await this.verifier.verifyRegistration(challengeB64, {
        id: input.credential.id, rawId: input.credential.rawId,
        type: input.credential.type, clientExtensionResults: {},
        response: {
          attestationObject: input.credential.authenticatorData,
          clientDataJSON: input.credential.clientDataJSON,
        },
      });
    } catch {
      throw new BadRequestException("webauthn_registration_invalid");
    }
    if (await this.credentialStore.findByCredentialId(verified.credential.id)) {
      throw new BadRequestException("webauthn_credential_already_registered");
    }

    // Store credential
    const now = new Date();
    const credential = new WebAuthnCredential({
      id: `cred_${randomUUID().replace(/-/g, "")}`,
      credentialId: verified.credential.id,
      globalUserId: buyer.globalUserId,
      publicKey: verified.credential.publicKey,
      counter: verified.credential.counter,
      transports: ["internal"],
      createdAt: now,
      lastUsedAt: null,
      aaguid: verified.aaguid,
      origin: verified.origin,
    });
    await this.credentialStore.save(credential);

    return {
      credential_id: credential.id,
      created_at: now.toISOString(),
    };
  }
}
