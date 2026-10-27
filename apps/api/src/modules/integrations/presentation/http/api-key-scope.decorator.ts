import { SetMetadata } from "@nestjs/common";
import type { TenantApiScope } from "../../../../shared/auth/tenant-principal.js";

export const API_KEY_SCOPES_METADATA = "aacp:api_key_scopes";

export const RequireApiKeyScopes = (...scopes: TenantApiScope[]) =>
  SetMetadata(API_KEY_SCOPES_METADATA, scopes);
