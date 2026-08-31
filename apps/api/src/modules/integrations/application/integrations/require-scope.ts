import { ForbiddenException } from "@nestjs/common";
import { type TenantApiScope } from "../../../../shared/auth/tenant-principal.js";
import { hasApiKeyScope } from "../../domain/api-key-scope.js";
import { type MerchantApiKeyContext } from "../../domain/integrations.types.js";

export function requireScope(context: MerchantApiKeyContext, scope: TenantApiScope): void {
  if (!hasApiKeyScope(context.scopes, scope)) {
    throw new ForbiddenException("missing_api_key_scope");
  }
}
