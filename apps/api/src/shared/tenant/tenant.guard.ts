import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { TenantContext } from "./tenant-context.service.js";

export const IS_PUBLIC_KEY = "isPublic";

export const PublicRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

export type TenantRequest = {
  user?: unknown;
  params?: unknown;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    validateTenantRequest(context.switchToHttp().getRequest<TenantRequest>());
    return true;
  }
}

export function validateTenantRequest(
  request: TenantRequest,
): TenantContext | null {
  const tenant = tenantContextFromPrincipal(request.user);
  if (!tenant) return null;

  for (const [source, value] of [
    ["params", request.params],
    ["query", request.query],
    ["body", request.body],
  ] as const) {
    for (const candidate of merchantIdsFrom(value)) {
      if (candidate !== tenant.merchantId) {
        throw new ForbiddenException(`tenant_mismatch_${source}`);
      }
    }
  }

  return tenant;
}

export function tenantContextFromPrincipal(
  principal: unknown,
): TenantContext | null {
  if (principal === undefined || principal === null) return null;
  if (!isRecord(principal)) {
    throw new ForbiddenException("invalid_tenant_principal");
  }

  // Buyer principals may carry merchantId (H3 fix) but are NOT tenant-scoped
  // merchant principals — skip tenant validation for them.
  if (principal.role === "buyer" || principal.aud === "buyer") return null;

  const looksLikeMerchantPrincipal =
    hasOwn(principal, "merchantId") ||
    hasOwn(principal, "userId") ||
    principal.role === "owner" ||
    principal.role === "admin";
  if (!looksLikeMerchantPrincipal) return null;

  if (
    !isNormalizedIdentifier(principal.merchantId) ||
    !isNormalizedIdentifier(principal.userId) ||
    (principal.role !== "owner" && principal.role !== "admin")
  ) {
    throw new ForbiddenException("invalid_tenant_principal");
  }

  return {
    merchantId: principal.merchantId,
    userId: principal.userId,
    role: principal.role,
  };
}

function merchantIdsFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => merchantIdsFrom(entry));
  }
  if (!isRecord(value)) return [];

  const candidates: unknown[] = [];
  if (hasOwn(value, "merchantId")) {
    candidates.push(...flattenValue(value.merchantId));
  }
  if (hasOwn(value, "merchant_id")) {
    candidates.push(...flattenValue(value.merchant_id));
  }
  return candidates;
}

function flattenValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value.flatMap(flattenValue) : [value];
}

function isNormalizedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value
  );
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
