import { ForbiddenException } from '@nestjs/common';
import { currentTenantPrincipal, type TenantPrincipalRequest } from '../../../shared/auth/tenant-principal.js';
import { MetaAdsError } from '../domain/types.js';

export type MetaAdsMerchantRequest = TenantPrincipalRequest & { headers?: { authorization?: string; origin?: string } };
export function metaAdsMerchantPrincipal(request: MetaAdsMerchantRequest, dashboardUrl: string | undefined, mutation = false) {
  const principal = currentTenantPrincipal(request);
  if (principal.kind !== 'human' || !['owner', 'admin'].includes(principal.role)) throw new ForbiddenException('meta_ads_role_forbidden');
  if (mutation && !request.headers?.authorization?.startsWith('Bearer ')) {
    let origin: string | null = null; try { origin = new URL(dashboardUrl ?? '').origin; } catch { /* Unconfigured cookie origin fails closed. */ }
    if (!origin || origin !== request.headers?.origin) throw new ForbiddenException('meta_ads_origin_forbidden');
  }
  return principal;
}
export function emptyMetaRequest(body: unknown): void {
  const value = body ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new MetaAdsError('request_fields_invalid');
}
