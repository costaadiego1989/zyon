import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { WebAuthnVerifierService } from "../../domain/services/webauthn-verifier.service.js";
import { WebAuthnChallengeService } from "../../domain/services/webauthn-challenge.service.js";
import type { WebAuthnCredentialStore } from "../../domain/ports/webauthn-credential.port.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { WebAuthnCredential } from "../../domain/entities/webauthn-credential.entity.js";
import { randomUUID } from "node:crypto";

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

/**
 * Verify a registration attestation and store the credential.
 * Per spec REQ-WA-001 this completes the registration ceremony.
 *
 * Scope key MUST match the options ceremony: `register:${buyer_id}`.
 * On success returns the stored credential ID + timestamp.
 */
@Injectable()
export class WebAuthnRegisterVerifyUseCase {
  private readonly verifier: WebAuthnVerifierService;
  private readonly challengeService: WebAuthnChallengeService;
  private readonly credentialStore: WebAuthnCredentialStore;
  private readonly buyerRepo: BuyerAccountRepository;

  constructor(deps: WebAuthnRegisterVerifyDeps) {
    this.verifier = deps.verifier;
    this.challengeService = deps.challengeService;
    this.credentialStore = deps.credentialStore;
    this.buyerRepo = deps.buyerRepo;
  }

  async execute(input: RegisterVerifyRequest): Promise<RegisterVerifyResponse> {
    if (!input.buyer_id) throw new BadRequestException("webauthn_register_missing_buyer_id");
    const buyer = await this.buyerRepo.findByGlobalUserId(input.buyer_id);
    if (!buyer) throw new NotFoundException("buyer_account_not_found");

    // Verify challenge scope
    const challengeB64 = Buffer.from(input.challenge).toString("base64url");
    const consumed = this.challengeService.consume(challengeB64, `register:${buyer.globalUserId}`);
    if (!consumed) throw new BadRequestException("webauthn_challenge_invalid_or_expired");

    // Decode attestation object
    const authData = new Uint8Array(
      Buffer.from(input.credential.authenticatorData, "base64url")
    );

    // Parse attestation ("none" format)
    const credentialIdBytes = new TextEncoder().encode(input.credential.id);
    const parsed = this.verifier.parseAttestation({
      authenticatorData: authData,
      credentialIdLength: credentialIdBytes.length,
    });
    if (!parsed.ok) throw new BadRequestException(`webauthn_attestation_invalid: ${parsed.reason}`);

    // Extract origin from clientDataJSON
    const clientDataJSON = Buffer.from(input.credential.clientDataJSON, "base64url").toString("utf8");
    let origin: string;
    try {
      origin = JSON.parse(clientDataJSON).origin;
    } catch {
      throw new BadRequestException("webauthn_client_data_malformed");
    }
    if (!origin || !origin.startsWith("https://")) {
      throw new BadRequestException("webauthn_origin_invalid");
    }

    // Store credential
    const now = new Date();
    const credential = new WebAuthnCredential({
      id: `cred_${randomUUID().replace(/-/g, "")}`,
      credentialId: parsed.credentialId,
      globalUserId: buyer.globalUserId,
      publicKey: parsed.publicKey,
      counter: parsed.counter,
      transports: ["internal"],
      createdAt: now,
      lastUsedAt: null,
      aaguid: parsed.aaguid,
      origin,
    });
    await this.credentialStore.save(credential);

    return {
      credential_id: credential.id,
      created_at: now.toISOString(),
    };
  }
}
