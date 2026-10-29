import type { TenantApiScope } from "../../../shared/auth/tenant-principal.js";

export function hasApiKeyScope(
  granted: readonly string[],
  required: TenantApiScope,
): boolean {
  if (granted.includes(required)) {
    return true;
  }
  return required === "tracking:write"
    && granted.includes("orders:tracking:write");
}
