import type { PrismaClient } from "@prisma/client";
import { WebAuthnCredential, type WebAuthnTransport } from "../domain/entities/webauthn-credential.entity.js";
import type { WebAuthnCredentialStore } from "../domain/ports/webauthn-credential.port.js";

/**
 * Prisma-backed WebAuthn credential repository (runtime).
 *
 * Public keys are stored encrypted per spec REQ-WA-005 ("credential public
 * key stored encrypted at rest"). The encryption/decryption is opaque to
 * this class: the Prisma schema defines encrypted blob columns and a field
 * encoder, so the database layer handles key derivation and crypto.
 */
export class PrismaWebAuthnCredentialRepository implements WebAuthnCredentialStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(credential: WebAuthnCredential): Promise<void> {
    await (this.prisma as any).webAuthnCredential.upsert({
      where: { id: credential.id },
      create: {
        id: credential.id,
        credentialId: credential.credentialId,
        globalUserId: credential.globalUserId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
        createdAt: credential.createdAt,
        lastUsedAt: credential.lastUsedAt,
        aaguid: credential.aaguid,
        origin: credential.origin,
      },
      update: {
        counter: credential.counter,
        lastUsedAt: credential.lastUsedAt,
      },
    });
  }

  async findByCredentialId(credentialId: string): Promise<WebAuthnCredential | null> {
    const row = await (this.prisma as any).webAuthnCredential.findUnique({
      where: { credentialId },
    });
    return row ? toDomain(row) : null;
  }

  async listByGlobalUserId(globalUserId: string): Promise<WebAuthnCredential[]> {
    const rows = await (this.prisma as any).webAuthnCredential.findMany({
      where: { globalUserId },
    });
    return rows.map(toDomain);
  }

  async deleteById(id: string): Promise<void> {
    await (this.prisma as any).webAuthnCredential.delete({
      where: { id },
    });
  }

  async updateCounter(id: string, newCounter: number, lastUsedAt?: Date): Promise<void> {
    await (this.prisma as any).webAuthnCredential.update({
      where: { id },
      data: {
        counter: newCounter,
        lastUsedAt: lastUsedAt ?? new Date(),
      },
    });
  }
}

type CredentialRow = {
  id: string;
  credentialId: string;
  globalUserId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  aaguid: string;
  origin: string;
};

function toDomain(row: CredentialRow): WebAuthnCredential {
  return new WebAuthnCredential({
    id: row.id,
    credentialId: row.credentialId,
    globalUserId: row.globalUserId,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: row.transports as WebAuthnTransport[],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    aaguid: row.aaguid,
    origin: row.origin,
  });
}
