/**
 * WebAuthn credential domain entity.
 *
 * Represents a FIDO2 credential bound to a buyer account and an origin
 * (the merchant storefront or canonical app origin). Per WebAuthn §8 (and
 * REQ-WA-005 of the spec), the public key material is stored encrypted at
 * rest by infrastructure implementations; this entity exposes the raw bytes
 * to the domain layer because the verifier needs them in memory.
 *
 * Counter replays (counter_not_incremented) are the server-side defense
 * against credential cloning — if the authenticator's signature counter
 * ever rolls back, the credential must have been duplicated.
 */
export type WebAuthnTransport = "internal" | "usb" | "nfc" | "ble" | "hybrid";

export interface WebAuthnCredentialProps {
  id: string;
  credentialId: string; // base64url
  globalUserId: string;
  publicKey: Uint8Array; // COSE-encoded (raw for ES256 = uncompressed X9.62)
  counter: number;
  transports: WebAuthnTransport[];
  createdAt: Date;
  lastUsedAt: Date | null;
  aaguid: string;
  origin: string;
}

export class WebAuthnCredential {
  readonly id: string;
  readonly credentialId: string;
  readonly globalUserId: string;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: WebAuthnTransport[];
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly aaguid: string;
  readonly origin: string;

  constructor(props: WebAuthnCredentialProps) {
    if (!props.credentialId) throw new Error("webauthn_credential_id_required");
    if (!props.globalUserId) throw new Error("webauthn_credential_owner_required");
    if (!props.publicKey || props.publicKey.length === 0) {
      throw new Error("webauthn_credential_public_key_required");
    }
    if (!props.origin || !props.origin.startsWith("https://")) {
      throw new Error("webauthn_credential_origin_invalid");
    }
    this.id = props.id;
    this.credentialId = props.credentialId;
    this.globalUserId = props.globalUserId;
    this.publicKey = props.publicKey;
    this.counter = props.counter;
    this.transports = props.transports;
    this.createdAt = props.createdAt;
    this.lastUsedAt = props.lastUsedAt;
    this.aaguid = props.aaguid;
    this.origin = props.origin;
  }

  withCounter(counter: number, lastUsedAt: Date): WebAuthnCredential {
    return new WebAuthnCredential({ ...this, counter, lastUsedAt });
  }
}