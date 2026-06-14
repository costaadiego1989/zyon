import { SetMetadata } from "@nestjs/common";
import type { TenantRole } from "../../../shared/auth/tenant-principal.js";

export const TENANT_ROLES_METADATA = "aacp:tenant_roles";

export const RequireTenantRoles = (...roles: TenantRole[]) =>
  SetMetadata(TENANT_ROLES_METADATA, roles);
