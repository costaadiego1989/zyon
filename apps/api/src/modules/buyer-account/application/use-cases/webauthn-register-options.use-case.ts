import { Injectable, NotFoundException, Inject } from "@nestjs/common";
import { WebAuthnChallengeService } from "../../domain/services/webauthn-challenge.service.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY } from "../../domain/ports/buyer-account-repository.port.js";

export interface RegisterOptionsRequest {
  buyer_id: string;
  origin_hostname?: string;
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
    @Inject("WebAuthnRpMetadata") private readonly rpMetadata: WebAuthnRpMetadata,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
  ) {}

  async execute(input: RegisterOptionsRequest): Promise<RegisterOptionsResponse> {
    if (!input.buyer_id) throw new Error("webauthn_register_missing_buyer_id");
    const buyer = await this.buyers.findByGlobalUserId(input.buyer_id);
    if (!buyer) throw new NotFoundException("buyer_account_not_found");

    const issued = this.challenges.issue(`register:${buyer.globalUserId}`);

    // Use provided origin_hostname if available (for Web Component embedding),
    // otherwise fall back to configured RP ID
    let rpId = this.rpMetadata.rpId;
    if (input.origin_hostname && this.isValidRpId(input.origin_hostname)) {
      rpId = input.origin_hostname;
    }

    return {
      challenge: issued.challenge,
      rp: { id: rpId, name: this.rpMetadata.rpName },
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

  private isValidRpId(hostname: string): boolean {
    // Basic validation: must be a valid hostname (no special chars except dots and hyphens)
    // Reject localhost and common private IPs when used as a Web Component
    if (!hostname || hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return false;
    }
    return /^[\w.-]+$/.test(hostname);
  }
}
