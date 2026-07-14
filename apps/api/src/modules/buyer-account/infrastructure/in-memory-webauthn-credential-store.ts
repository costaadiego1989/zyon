import type { WebAuthnCredential } from "../domain/entities/webauthn-credential.entity.js";
import type { WebAuthnCredentialStore } from "../domain/ports/webauthn-credential.port.js";

/**
 * In-memory WebAuthn credential store for unit tests.
 * Implements the WebAuthnCredentialStore port without Prisma.
 *
 * Note: per CLAUDE.md, in-memory repos are test doubles only; the runtime
 * uses Prisma. This class enforces a max-credentials-per-user cap (10) to
 * defend against accumulated-credential attacks.
 */
export class InMemoryWebAuthnCredentialStore implements WebAuthnCredentialStore {
  private readonly records = new Map<string, WebAuthnCredential>();
  private readonly userCredentials = new Map<string, string[]>();
  private readonly maxPerUser = 10;

  async save(credential: WebAuthnCredential): Promise<void> {
    // Validate cap per user
    const userCreds = this.userCredentials.get(credential.globalUserId) ?? [];
    if (!this.records.has(credential.id) && userCreds.length >= this.maxPerUser) {
      throw new Error("webauthn_max_credentials_per_user");
    }

    this.records.set(credential.id, credential);
    if (!userCreds.includes(credential.id)) {
      userCreds.push(credential.id);
      this.userCredentials.set(credential.globalUserId, userCreds);
    }
  }

  async findByCredentialId(credentialId: string): Promise<WebAuthnCredential | null> {
    for (const cred of this.records.values()) {
      if (cred.credentialId === credentialId) {
        return cred;
      }
    }
    return null;
  }

  async listByGlobalUserId(globalUserId: string): Promise<WebAuthnCredential[]> {
    const ids = this.userCredentials.get(globalUserId) ?? [];
    return ids.map((id) => this.records.get(id)!).filter(Boolean);
  }

  async deleteById(id: string): Promise<void> {
    const cred = this.records.get(id);
    if (!cred) return;
    this.records.delete(id);
    const userCreds = this.userCredentials.get(cred.globalUserId) ?? [];
    this.userCredentials.set(
      cred.globalUserId,
      userCreds.filter((x) => x !== id)
    );
  }

  async updateCounter(id: string, newCounter: number, lastUsedAt?: Date): Promise<void> {
    const cred = this.records.get(id);
    if (!cred) return;
    const updated = cred.withCounter(newCounter, lastUsedAt ?? new Date());
    this.records.set(id, updated);
  }

  clear(): void {
    this.records.clear();
    this.userCredentials.clear();
  }
}
