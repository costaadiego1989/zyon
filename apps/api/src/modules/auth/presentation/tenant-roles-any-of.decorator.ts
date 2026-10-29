import type { TenantRole } from "../../../shared/auth/tenant-principal.js";
import { RequireTenantRoles } from "./tenant-role.decorator.js";

/**
 * Identical semantics to @RequireTenantRoles. Exists so callers can express
 * "any of these roles including staff" without confusion. Re-uses the same
 * metadata key — no new guard logic required.
 */
export const TenantRolesAnyOf = (...roles: TenantRole[]) => RequireTenantRoles(...roles);
