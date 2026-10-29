import { BadRequestException } from "@nestjs/common";
import {
  TENANT_API_SCOPES,
} from "../../../../../shared/auth/tenant-principal.js";
import type {
  MerchantApiKey,
  MerchantApiKeyPublic,
  MerchantApiKeyScope,
} from "../../../domain/integrations.types.js";

export function toApiKeyPublic(apiKey: MerchantApiKey): MerchantApiKeyPublic {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    environment: apiKey.environment,
    allowedCidrs: apiKey.allowedCidrs,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
    rotatedFromId: apiKey.rotatedFromId,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt
  };
}

export function sanitizeScopes(scopes: MerchantApiKeyScope[]): MerchantApiKeyScope[] {
  const allowed = new Set<MerchantApiKeyScope>(TENANT_API_SCOPES);
  const unique = Array.from(new Set(scopes.filter((scope) => allowed.has(scope))));
  if (!unique.length) throw new BadRequestException("api_key_scopes_required");
  return unique;
}

export function parseFutureExpiry(value: string | undefined, now: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() <= now) {
    throw new BadRequestException("api_key_expiry_must_be_in_the_future");
  }
  return parsed.toISOString();
}
