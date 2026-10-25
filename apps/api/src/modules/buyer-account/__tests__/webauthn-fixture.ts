import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { InMemoryBuyerAccountRepository } from "../infrastructure/in-memory-buyer-account.repository.js";
import { InMemoryWebAuthnCredentialStore } from "../infrastructure/in-memory-webauthn-credential-store.js";
import { BuyerAccount } from "../domain/entities/buyer-account.entity.js";
import { BuyerJwtService } from "../domain/services/buyer-jwt.service.js";
import { WebAuthnChallengeService } from "../domain/services/webauthn-challenge.service.js";
import { WebAuthnVerifierService } from "../domain/services/webauthn-verifier.service.js";

export const rpId = "shop.example.com";
export const origin = "https://" + rpId;
export const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest();
export const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
export function authenticator() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  const publicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")],
  ]));
  const rawId = randomBytes(32);
  const id = b64(rawId);
  function authData(counter: number, flags: number, rp = rpId) {
    const data = Buffer.alloc(37);
    hash(rp).copy(data);
    data[32] = flags;
    data.writeUInt32BE(counter, 33);
    return data;
  }
  function clientData(challenge: string, type: string, expectedOrigin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: expectedOrigin, crossOrigin: false }));
  }
  return {
    id, publicKey,
    registration(challenge: string, options: { flags?: number; type?: string; origin?: string; rp?: string } = {}) {
      const length = Buffer.alloc(2); length.writeUInt16BE(rawId.length);
      const data = Buffer.concat([authData(0, options.flags ?? 0x45, options.rp), Buffer.alloc(16), length, rawId, publicKey]);
      return {
        id, rawId: id, type: "public-key" as const, clientExtensionResults: {},
        response: {
          attestationObject: b64(isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([
            ["fmt", "none"], ["attStmt", new Map()], ["authData", data],
          ]))),
          clientDataJSON: b64(clientData(challenge, options.type ?? "webauthn.create", options.origin ?? origin)),
        },
      };
    },
    assertion(challenge: string, counter = 1, options: { flags?: number; type?: string; origin?: string; rp?: string } = {}) {
      const data = authData(counter, options.flags ?? 5, options.rp);
      const client = clientData(challenge, options.type ?? "webauthn.get", options.origin ?? origin);
      return {
        challenge: Buffer.from(challenge, "base64url"), storedPublicKey: publicKey, storedCounter: 0, credentialId: id,
        authenticatorData: data, clientDataJSON: client,
        signature: sign("sha256", Buffer.concat([data, hash(client)]), keys.privateKey),
      };
    },
  };
}
export async function dependencies() {
  const buyerRepo = new InMemoryBuyerAccountRepository();
  const buyer = new BuyerAccount({ globalUserId: "guser_test", email: "buyer@example.com", displayName: "Buyer",
    passwordHash: "test-hash", createdAt: new Date(), updatedAt: new Date() });
  await buyerRepo.save(buyer);
  return { buyer, buyerRepo, credentialStore: new InMemoryWebAuthnCredentialStore(),
    challengeService: new WebAuthnChallengeService(), verifier: new WebAuthnVerifierService({ rpId, origin }),
    jwt: new BuyerJwtService("test-webauthn-secret-at-least-32-characters", 3600) };
}
