import { encryptPii, decryptPii } from "../../../shared/crypto/pii-cipher.service.js";
import type { FiscalCredentialCipherPort } from "../domain/fiscal-configuration.port.js";

/** Reuse the authenticated shared cipher, requiring configured key material for credentials. */
export class FiscalCredentialCipher implements FiscalCredentialCipherPort {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  encrypt(plaintext: string) {
    this.requireKey(); return encryptPii(plaintext, this.env);
  }
  decrypt(ciphertext: string) {
    this.requireKey(); return decryptPii(ciphertext, this.env);
  }
  private requireKey() {
    if (!this.env.AACP_PII_ENC_KEY?.trim()) throw new Error("missing_required_secret:AACP_PII_ENC_KEY");
  }
}
