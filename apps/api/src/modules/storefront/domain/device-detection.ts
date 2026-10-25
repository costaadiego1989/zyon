/**
 * Server-side device classification from a User-Agent string. Pure, no I/O.
 * Used to tag storefront funnel events with a device segment so the funnel's
 * "por dispositivo" breakdown reports real data. Deliberately coarse — the
 * funnel only needs mobile / tablet / desktop buckets.
 */
export type DeviceType = "mobile" | "tablet" | "desktop";

export function detectDeviceFromUserAgent(userAgent?: string): DeviceType {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "desktop";
  // Tablets first — many tablet UAs also contain "mobile"/"android".
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "mobile";
  return "desktop";
}
