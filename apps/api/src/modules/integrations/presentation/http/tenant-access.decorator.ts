import { SetMetadata } from "@nestjs/common";
import type {
  TenantApiScope,
  TenantRole,
} from "../../../../shared/auth/tenant-principal.js";

export const TENANT_ACCESS_METADATA = "tenant_access";

export interface TenantAccessRequirement {
  humanOnly?: boolean;
  humanRoles?: readonly TenantRole[];
  serviceScopes?: readonly TenantApiScope[];
}

export function RequireTenantAccess(
  requirement: TenantAccessRequirement,
): MethodDecorator & ClassDecorator {
  return SetMetadata(TENANT_ACCESS_METADATA, requirement);
}
