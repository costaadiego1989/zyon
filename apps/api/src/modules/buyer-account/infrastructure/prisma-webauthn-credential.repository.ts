import type { PrismaClient } from "@prisma/client";
import { WebAuthnCredential, type WebAuthnTransport } from "../domain/entities/webauthn-credential.entity.js";
import type { WebAuthnCredentialStore } from "../domain/ports/webauthn-credential.port.js";

/** Persists COSE public keys; private keys stay on the authenticator. */
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
    const result = await this.prisma.webAuthnCredential.updateMany({
      where: { id, counter: newCounter === 0 ? 0 : { lt: newCounter } },
      data: { counter: newCounter, lastUsedAt: lastUsedAt ?? new Date() },
    });
    if (result.count !== 1) throw new Error("webauthn_counter_replayed");
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
