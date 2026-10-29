import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { MerchantApiKeyEnvironment } from "./integrations.types.js";

const API_KEY_PREFIXES: Record<MerchantApiKeyEnvironment, string> = {
  test: "aacp_test",
  live: "aacp_live",
};

@Injectable()
export class ApiKeyService {
  generate(
    environment: MerchantApiKeyEnvironment = "test",
  ): { rawKey: string; keyHash: string; keyPrefix: string } {
    const rawKey = `${API_KEY_PREFIXES[environment]}_${randomBytes(32).toString("base64url")}`;
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

  environment(rawKey: string): MerchantApiKeyEnvironment | "legacy" | undefined {
    if (rawKey.startsWith(`${API_KEY_PREFIXES.test}_`)) return "test";
    if (rawKey.startsWith(`${API_KEY_PREFIXES.live}_`)) return "live";
    if (rawKey.startsWith("aacp_sk_")) return "legacy";
    return undefined;
  }
}
