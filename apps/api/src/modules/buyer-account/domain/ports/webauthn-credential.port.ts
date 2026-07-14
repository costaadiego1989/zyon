import type { WebAuthnCredential } from "../entities/webauthn-credential.entity.js";

/**
 * Storage port for WebAuthn credentials.
 *
 * Two implementations:
 *   - InMemoryWebAuthnCredentialStore (tests only)
 *   - PrismaWebAuthnCredentialRepository (runtime)
 *
 * Implementations MUST encrypt the public-key bytes at rest. The decryption
 * happens inside the `findByCredentialId` method so the domain layer never
 * sees encrypted buffers.
 */
export interface WebAuthnCredentialStore {
  save(credential: WebAuthnCredential): Promise<void>;
  findByCredentialId(credentialId: string): Promise<WebAuthnCredential | null>;
  listByGlobalUserId(globalUserId: string): Promise<WebAuthnCredential[]>;
  deleteById(id: string): Promise<void>;
  updateCounter(id: string, newCounter: number, lastUsedAt?: Date): Promise<void>;
}

export const WEBAUTHN_CREDENTIAL_STORE = Symbol("WEBAUTHN_CREDENTIAL_STORE");
