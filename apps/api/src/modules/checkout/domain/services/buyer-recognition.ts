import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";

/** The existing recognition ranking, shared without persistence or authority. */
export function isCompleteBuyerAddress(address?: CustomerHints["address"]): boolean {
  return Boolean(address?.zip && address.street && address.city && address.state && address.number && address.complement !== undefined);
}
export function buyerProfileCompletenessScore(customer?: CustomerHints): number {
  if (!customer) return 0;
  let score = 0;
  if (customer.fullName) score += 2;
  if (customer.email_verified) score += 1;
  if (customer.cpf) score += 2;
  if (customer.phone) score += 1;
  if (customer.phone_verified) score += 2;
  if (customer.address?.zip) score += 1;
  if (customer.address?.street) score += 1;
  if (customer.address?.number) score += 1;
  if (customer.address?.complement !== undefined) score += 1;
  if (customer.address_verified) score += 1;
  if (isCompleteBuyerAddress(customer.address)) score += 3;
  return score;
}
export function pickBestPriorCheckoutBuyer(sessions: CheckoutSession[], currentSessionId: string, email: string): CheckoutSession | null {
  return sessions.filter(session => session.sessionId !== currentSessionId && session.customer?.email_verified === true
    && session.customer.email?.trim().toLowerCase() === email.trim().toLowerCase()).sort((a, b) => {
    const score = buyerProfileCompletenessScore(b.customer) - buyerProfileCompletenessScore(a.customer);
    return score !== 0 ? score : Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  })[0] ?? null;
}
