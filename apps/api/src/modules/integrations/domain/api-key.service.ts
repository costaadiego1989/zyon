import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

const API_KEY_PREFIX = "aacp_sk";

@Injectable()
export class ApiKeyService {
  generate(): { rawKey: string; keyHash: string; keyPrefix: string } {
    const rawKey = `${API_KEY_PREFIX}_${randomBytes(32).toString("base64url")}`;
    return {
      rawKey,
      keyHash: this.hash(rawKey),
      keyPrefix: this.prefix(rawKey)
    };
  }

  hash(rawKey: string): string {
    return createHash("sha256").update(rawKey).digest("hex");
  }

  prefix(rawKey: string): string {
    return rawKey.slice(0, 18);
  }
}
