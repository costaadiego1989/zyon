import { verifyAuthenticationResponse, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";

export interface WebAuthnVerifierConfig {
  rpId: string;
  origin: string;
}

export interface VerifyAssertionInput {
  challenge: Uint8Array;
  storedPublicKey: Uint8Array;
  storedCounter: number;
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}

export type VerifyAssertionResult =
  | { ok: true; newCounter: number }
  | { ok: false; reason: string };

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** Verifies browser CBOR attestation, COSE keys and signed WebAuthn assertions. */
export class WebAuthnVerifierService {
  constructor(private readonly config: WebAuthnVerifierConfig) {
    if (!config.rpId || !config.origin) throw new Error("webauthn_config_required");
  }

  async verifyRegistration(challenge: string, response: RegistrationResponseJSON) {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpId,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
    if (!result.verified || !result.registrationInfo) throw new Error("webauthn_registration_invalid");
    if (result.registrationInfo.credential.id !== response.id) throw new Error("webauthn_credential_id_mismatch");
    return result.registrationInfo;
  }

  async verifyAssertion(input: VerifyAssertionInput): Promise<VerifyAssertionResult> {
    try {
      const result = await verifyAuthenticationResponse({
        response: {
          id: input.credentialId, rawId: input.credentialId, type: "public-key",
          clientExtensionResults: {},
          response: {
            authenticatorData: encode(input.authenticatorData),
            clientDataJSON: encode(input.clientDataJSON),
            signature: encode(input.signature),
          },
        },
        credential: {
          id: input.credentialId,
          publicKey: new Uint8Array(input.storedPublicKey),
          counter: input.storedCounter,
        },
        expectedChallenge: encode(input.challenge),
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      });
      return result.verified
        ? { ok: true, newCounter: result.authenticationInfo.newCounter }
        : { ok: false, reason: "assertion_verification_failed" };
    } catch {
      return { ok: false, reason: "assertion_verification_failed" };
    }
  }
}
