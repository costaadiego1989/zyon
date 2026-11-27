import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MetaAdsError, type CredentialCodecPort } from "../domain/types.js";
import { requireIdentifier } from "../domain/offer.js";

export class CredentialCodec implements CredentialCodecPort {
  private readonly key: Buffer | null;
  constructor(encodedKey: string | undefined) {
    if (encodedKey === undefined) { this.key = null; return; }
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32 || key.toString("base64") !== encodedKey) throw new MetaAdsError("meta_credential_key_invalid", 503);
    this.key = key;
  }
  encrypt(merchantId: string, plaintext: string): string {
    requireIdentifier(merchantId);
    if (!this.key) throw new MetaAdsError("meta_credential_key_missing", 503);
    if (!plaintext || plaintext.length > 16000) throw new MetaAdsError("meta_credential_invalid", 400);
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`mga1:${merchantId}`));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["mga1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }
  decrypt(merchantId: string, ciphertext: string): string {
    requireIdentifier(merchantId);
    if (!this.key) throw new MetaAdsError("meta_credential_key_missing", 503);
    try {
      const parts = ciphertext.split(".");
      if (parts.length !== 4 || parts[0] !== "mga1" || ciphertext.length > 24000 || parts.slice(1).some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
      const iv = Buffer.from(parts[1], "base64url"); const tag = Buffer.from(parts[2], "base64url");
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const cipher = createDecipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(Buffer.from(`mga1:${merchantId}`)); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(Buffer.from(parts[3], "base64url")), cipher.final()]).toString("utf8");
    } catch { throw new MetaAdsError("meta_credential_invalid", 503); }
  }
}
