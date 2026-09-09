import type { WebAuthnCredential } from "../entities/webauthn-credential.entity.js";

/**
 * Storage port for WebAuthn credentials.
 *
 * Two implementations:
 *   - InMemoryWebAuthnCredentialStore (tests only)
 *   - PrismaWebAuthnCredentialRepository (runtime)
 *
 * updateCounter must reject counter rollback atomically; zero-only passkeys are supported.
 */
export interface WebAuthnCredentialStore {
  save(credential: WebAuthnCredential): Promise<void>;
  findByCredentialId(credentialId: string): Promise<WebAuthnCredential | null>;
  listByGlobalUserId(globalUserId: string): Promise<WebAuthnCredential[]>;
  listAll?(): Promise<WebAuthnCredential[]>;
  deleteById(id: string): Promise<void>;
  updateCounter(id: string, newCounter: number, lastUsedAt?: Date): Promise<void>;
}

export const WEBAUTHN_CREDENTIAL_STORE = Symbol("WEBAUTHN_CREDENTIAL_STORE");
