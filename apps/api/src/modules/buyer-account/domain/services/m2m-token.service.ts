import { createHash, randomBytes } from "node:crypto";

export interface M2mTokenPair {
  plain: string;
  hash: string;
}

export class M2mTokenService {
  generate(): M2mTokenPair {
    const plain = "m2m_" + randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(plain).digest("hex");
    return { plain, hash };
  }

  hashToken(plain: string): string {
    return createHash("sha256").update(plain).digest("hex");
  }
}
