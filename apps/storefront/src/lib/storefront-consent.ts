export const STOREFRONT_CONSENT_VERSION = "storefront_privacy_2026_10_05";
export type ContactChannel = "email" | "whatsapp";
export type StorefrontConsent = {
  version: typeof STOREFRONT_CONSENT_VERSION;
  optionalCookies: boolean;
  channels: ContactChannel[];
  decidedAt: string;
  // A guest's explicit choice can be bound once, after authentication.
  buyerId: string | null;
  pendingContactSync: boolean;
};

export function consentStorageKey(storeId: string): string {
  return `zyon-storefront-consent:${storeId}`;
}

export function parseStorefrontConsent(raw: string | null): StorefrontConsent | null {
  try {
    const data = JSON.parse(raw ?? "null");
    if (!data || data.version !== STOREFRONT_CONSENT_VERSION
      || typeof data.optionalCookies !== "boolean"
      || !Array.isArray(data.channels)
      || data.channels.some((channel: unknown) => channel !== "email" && channel !== "whatsapp")
      || typeof data.decidedAt !== "string" || !Number.isFinite(Date.parse(data.decidedAt))
      || !(data.buyerId === null || typeof data.buyerId === "string")
      || typeof data.pendingContactSync !== "boolean") return null;
    return { ...data, channels: [...new Set<ContactChannel>(data.channels)] };
  } catch { return null; }
}

export function readStorefrontConsent(storeId: string): StorefrontConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = parseStorefrontConsent(localStorage.getItem(consentStorageKey(storeId)));
    if (saved) return saved;
  } catch { /* Try tab storage when persistent storage is unavailable. */ }
  try { return parseStorefrontConsent(sessionStorage.getItem(consentStorageKey(storeId))); }
  catch { return null; }
}

export function writeStorefrontConsent(storeId: string, consent: StorefrontConsent): boolean {
  try { localStorage.setItem(consentStorageKey(storeId), JSON.stringify(consent)); return true; }
  catch {
    try { sessionStorage.setItem(consentStorageKey(storeId), JSON.stringify(consent)); return true; }
    catch { return false; }
  }
}

export function canSyncContactChoice(consent: StorefrontConsent, buyerId: string): boolean {
  return consent.pendingContactSync && (consent.buyerId === null || consent.buyerId === buyerId);
}

// Optional analytics must also stop for an already-loaded tag manager.
export function hasOptionalCookieConsent(): boolean {
  if (typeof window === "undefined") return false;
  const storeId = document.documentElement.dataset.consentStore;
  return Boolean(storeId && readStorefrontConsent(storeId)?.optionalCookies);
}
