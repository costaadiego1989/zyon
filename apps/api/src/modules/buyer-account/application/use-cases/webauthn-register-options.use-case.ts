import { Injectable, NotFoundException } from "@nestjs/common";
import { WebAuthnChallengeService } from "../../domain/services/webauthn-challenge.service.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";

export interface RegisterOptionsRequest {
  buyer_id: string;
}

export interface RegisterOptionsResponse {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  authenticatorSelection: {
    authenticatorAttachment: "platform";
    userVerification: "required";
  };
  timeout: number;
  attestation: "none";
}

export interface WebAuthnRpMetadata {
  rpId: string;
  rpName: string;
}

/**
 * Generate a registration challenge for a logged-in buyer who is about to
 * enroll a new biometric credential. Per spec REQ-WA-001 this happens
 * immediately after email+password login.
 *
 * The challenge scope key is `register:${buyer_id}` so the verify step
 * MUST consume from the same scope.
 */
@Injectable()
export class WebAuthnRegisterOptionsUseCase {
  constructor(
    private readonly challenges: WebAuthnChallengeService,
    private readonly rpMetadata: WebAuthnRpMetadata,
    private readonly buyers: BuyerAccountRepository,
  ) {}

  async execute(input: RegisterOptionsRequest): Promise<RegisterOptionsResponse> {
    if (!input.buyer_id) throw new Error("webauthn_register_missing_buyer_id");
    const buyer = await this.buyers.findByGlobalUserId(input.buyer_id);
    if (!buyer) throw new NotFoundException("buyer_account_not_found");

    const issued = this.challenges.issue(`register:${buyer.globalUserId}`);

    return {
      challenge: issued.challenge,
      rp: { id: this.rpMetadata.rpId, name: this.rpMetadata.rpName },
      user: {
        id: buyer.globalUserId,
        name: buyer.email,
        displayName: buyer.displayName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none",
    };
  }
}
