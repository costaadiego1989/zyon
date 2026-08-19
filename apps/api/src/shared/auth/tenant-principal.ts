import { UnauthorizedException } from "@nestjs/common";

export const TENANT_API_SCOPES = [
  "checkout:read",
  "checkout:write",
  "configuration:read",
  "configuration:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "catalog:read",
  "embed:sessions:create",
  "tracking:read",
  "tracking:write",
  "commerce:read",
  "commerce:write",
  "payments:read",
  "support:read",
  "support:write",
  "webhooks:read",
  "webhooks:write",
  "audit:read",
  "analytics:read",
  "coupons:read",
  "coupons:write",
  "experiments:read",
  "experiments:write",
  "team:read",
  "team:write",
  "returns:read",
  "returns:write",
] as const;

export type TenantApiScope = (typeof TENANT_API_SCOPES)[number];
export type TenantRole = "owner" | "admin";

export type HumanTenantPrincipal = {
  kind: "human";
  tenantId: string;
  userId: string;
  email: string;
  role: TenantRole;
};

export type ServiceTenantPrincipal = {
  kind: "service";
  tenantId: string;
  credentialId: string;
  environment: "test" | "live";
  scopes: readonly string[];
};

export type TenantPrincipal = HumanTenantPrincipal | ServiceTenantPrincipal;

export type TenantPrincipalRequest = {
  tenantPrincipal?: TenantPrincipal;
};

export function setTenantPrincipal(
  request: TenantPrincipalRequest,
  principal: TenantPrincipal,
): void {
  request.tenantPrincipal = principal;
}

export function currentTenantPrincipal(
  request: TenantPrincipalRequest,
): TenantPrincipal {
  if (!request.tenantPrincipal) {
    throw new UnauthorizedException("missing_tenant_principal");
  }
  return request.tenantPrincipal;
}
