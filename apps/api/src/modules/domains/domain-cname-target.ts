/** Legacy registrations use the same target as a newly registered domain. */
export function resolveDomainCnameTarget(storedTarget?: string | null): string {
  if (storedTarget?.trim()) return storedTarget;
  return process.env.STOREFRONT_CNAME_TARGET?.trim() || "stores.zyon.com";
}
