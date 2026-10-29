import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { TenantRole } from "../domain/auth.types.js";
import { TENANT_ROLES_METADATA } from "./tenant-role.decorator.js";

/** Staff access is opt-in until each dashboard operation has an explicit policy. */
export function requireStaffAccess(context: ExecutionContext, role: TenantRole): void {
  if (role !== "staff") return;
  const roles: TenantRole[] | undefined = Reflect.getMetadata(TENANT_ROLES_METADATA, context.getHandler()) ??
    Reflect.getMetadata(TENANT_ROLES_METADATA, context.getClass());
  if (!roles?.includes("staff")) throw new ForbiddenException("staff_operation_not_permitted");
}
