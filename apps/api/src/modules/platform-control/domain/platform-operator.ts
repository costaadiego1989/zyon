export const PLATFORM_OPERATOR_ROLES = [
  "platform_admin",
  "billing_ops",
  "support_ops",
  "infra_ops",
  "auditor",
] as const;

export type PlatformOperatorRole = (typeof PLATFORM_OPERATOR_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  "platform:operators:read",
  "platform:overview:read",
  "platform:merchants:read",
  "platform:billing:read",
  "platform:billing-promotions:write",
  "platform:orders:read",
  "platform:ai-usage:read",
  "platform:ai-governance:read",
  "platform:ai-governance:write",
  "platform:feedback:read",
  "platform:feedback:write",
  "platform:infrastructure:read",
  "platform:audit:read",
  "platform:exports:read",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export type PlatformOperator = {
  id: string;
  email: string;
  passwordHash?: string;
  role: PlatformOperatorRole;
  authVersion: number;
  disabledAt?: Date;
};

export type PlatformPrincipal = {
  operatorId: string;
  email: string;
  role: PlatformOperatorRole;
};

const ALL_PLATFORM_PERMISSIONS = new Set<PlatformPermission>(PLATFORM_PERMISSIONS);

const PERMISSIONS_BY_ROLE: Readonly<Record<PlatformOperatorRole, ReadonlySet<PlatformPermission>>> = {
  platform_admin: ALL_PLATFORM_PERMISSIONS,
  billing_ops: new Set([
    "platform:ai-governance:read",
    "platform:overview:read",
    "platform:merchants:read",
    "platform:billing:read",
  "platform:orders:read",
    "platform:ai-usage:read",
  ]),
  support_ops: new Set([
    "platform:overview:read",
    "platform:merchants:read",
    "platform:feedback:read",
    "platform:feedback:write",
  ]),
  infra_ops: new Set([
    "platform:overview:read",
    "platform:infrastructure:read",
  ]),
  auditor: new Set([
    "platform:ai-governance:read",
    "platform:overview:read",
    "platform:merchants:read",
    "platform:billing:read",
  "platform:orders:read",
    "platform:ai-usage:read",
    "platform:feedback:read",
    "platform:infrastructure:read",
    "platform:audit:read",
  ]),
};

export function isPlatformOperatorRole(value: string): value is PlatformOperatorRole {
  return PLATFORM_OPERATOR_ROLES.includes(value as PlatformOperatorRole);
}

export function hasPlatformPermission(
  role: PlatformOperatorRole,
  permission: PlatformPermission,
): boolean {
  return PERMISSIONS_BY_ROLE[role].has(permission);
}

export function platformPermissionsForRole(role: PlatformOperatorRole): PlatformPermission[] {
  return [...PERMISSIONS_BY_ROLE[role]];
}
export function normalizePlatformEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("platform_invalid_email");
  return email;
}
