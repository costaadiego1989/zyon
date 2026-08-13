import { Injectable, BadRequestException, UnauthorizedException, Inject } from "@nestjs/common";
import { WebAuthnVerifierService } from "../../domain/services/webauthn-verifier.service.js";
import { WebAuthnChallengeService } from "../../domain/services/webauthn-challenge.service.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import type { WebAuthnCredentialStore } from "../../domain/ports/webauthn-credential.port.js";
import { WEBAUTHN_CREDENTIAL_STORE } from "../../domain/ports/webauthn-credential.port.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY } from "../../domain/ports/buyer-account-repository.port.js";

export interface LoginVerifyRequest {
  challenge: Uint8Array;
  credential: {
    id: string;
    rawId: string;
    authenticatorData: string; // base64url
    clientDataJSON: string; // base64url
    signature: string; // base64url
    type: "public-key";
  };
}

export interface LoginVerifyResponse {
  access_token: string;
  buyer_id: string;
  email: string;
}

export interface WebAuthnLoginVerifyDeps {
  verifier: WebAuthnVerifierService;
  challengeService: WebAuthnChallengeService;
  credentialStore: WebAuthnCredentialStore;
  buyerRepo: BuyerAccountRepository;
  jwt: BuyerJwtService;
}

/**
 * Verify a login assertion and issue a JWT on success.
 * Per spec REQ-WA-002 the entire flow must complete < 3 seconds.
 *
 * Scope key MUST match the options ceremony: `login`.
 * On success returns a JWT (same as password login).
 */
@Injectable()
export class WebAuthnLoginVerifyUseCase {
  private readonly verifier: WebAuthnVerifierService;
  private readonly challengeService: WebAuthnChallengeService;
  private readonly credentialStore: WebAuthnCredentialStore;
  private readonly buyerRepo: BuyerAccountRepository;
  private readonly jwt: BuyerJwtService;

  constructor(
    verifier: WebAuthnVerifierService,
    challengeService: WebAuthnChallengeService,
    credentialStore: WebAuthnCredentialStore,
    buyerRepo: BuyerAccountRepository,
    jwt: BuyerJwtService,
  );
  constructor(deps: WebAuthnLoginVerifyDeps);
  constructor(
    @Inject(WebAuthnVerifierService) verifierOrDeps: WebAuthnVerifierService | WebAuthnLoginVerifyDeps,
    challengeService?: WebAuthnChallengeService,
    @Inject(WEBAUTHN_CREDENTIAL_STORE) credentialStore?: WebAuthnCredentialStore,
    @Inject(BUYER_ACCOUNT_REPOSITORY) buyerRepo?: BuyerAccountRepository,
    jwt?: BuyerJwtService,
  ) {
    if (verifierOrDeps instanceof WebAuthnVerifierService) {
      this.verifier = verifierOrDeps;
      this.challengeService = challengeService!;
      this.credentialStore = credentialStore!;
      this.buyerRepo = buyerRepo!;
      this.jwt = jwt!;
    } else {
      this.verifier = verifierOrDeps.verifier;
      this.challengeService = verifierOrDeps.challengeService;
      this.credentialStore = verifierOrDeps.credentialStore;
      this.buyerRepo = verifierOrDeps.buyerRepo;
      this.jwt = verifierOrDeps.jwt;
    }
  }

  async execute(input: LoginVerifyRequest): Promise<LoginVerifyResponse> {
    // Verify challenge scope
    const challengeB64 = Buffer.from(input.challenge).toString("base64url");
    const consumed = this.challengeService.consume(challengeB64, "login");
    if (!consumed) throw new BadRequestException("webauthn_challenge_invalid_or_expired");

    // Decode assertion response
    const authData = new Uint8Array(
      Buffer.from(input.credential.authenticatorData, "base64url")
    );
    const clientDataJSON = new Uint8Array(
      Buffer.from(input.credential.clientDataJSON, "base64url")
    );
    const signature = new Uint8Array(
      Buffer.from(input.credential.signature, "base64url")
    );

    // Lookup credential by ID
    const credential = await this.credentialStore.findByCredentialId(input.credential.id);
    if (!credential) throw new UnauthorizedException("credential_not_found");

    // Verify assertion
    const result = await this.verifier.verifyAssertion({
      challenge: input.challenge,
      storedPublicKey: credential.publicKey,
      storedCounter: credential.counter,
      credentialId: input.credential.id,
      authenticatorData: authData,
      clientDataJSON,
      signature,
    });
    if (!result.ok) throw new UnauthorizedException(`assertion_verification_failed: ${result.reason}`);

    // Update counter (replay protection)
    await this.credentialStore.updateCounter(credential.id, result.newCounter);

    // Lookup buyer and issue JWT
    const buyer = await this.buyerRepo.findByGlobalUserId(credential.globalUserId);
    if (!buyer) throw new UnauthorizedException("buyer_account_not_found");

    const token = this.jwt.sign({ globalUserId: buyer.globalUserId, email: buyer.email });

    return {
      access_token: token,
      buyer_id: buyer.globalUserId,
      email: buyer.email,
    };
  }
}
