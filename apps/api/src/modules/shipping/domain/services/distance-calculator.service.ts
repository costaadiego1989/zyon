/**
 * Geocode a Brazilian CEP to lat/lng using ViaCEP + Nominatim.
 * ViaCEP is free (no key required).
 * Resolves a street or postcode. A city centre cannot prove delivery coverage.
 */
// Nominatim usage policy requires an identifying User-Agent; server-side
// fetch sends none by default and gets 403. Identify the app + contact.
const NOMINATIM_HEADERS = {
  "User-Agent": "ZyonCheckout/1.0 (delivery radius quoting; contact@zyon.app)",
  "Accept-Language": "pt-BR",
};

async function nominatimSearch(query: string): Promise<{ lat: number; lng: number } | null> {
  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`,
    { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(4500) }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (Array.isArray(data) && data.length > 0) {
    if (["city", "municipality", "county", "state", "country", "administrative"].includes(data[0].addresstype ?? data[0].type)) return null;
    const lat = Number(data[0].lat), lng = Number(data[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }
  return null;
}

export async function geocodeBrazilianCep(cep: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const cleaned = cep.replace(/\D/g, "");
    if (cleaned.length !== 8) return null;

    // Query ViaCEP
    const viacepResp = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, { signal: AbortSignal.timeout(4500) });
    if (!viacepResp.ok) return null;
    const viacepData = await viacepResp.json();
    if (viacepData.erro) return null;

    // Try street-level first, then the postcode; never substitute a city centre.
    const fullAddr = `${viacepData.logradouro}, ${viacepData.bairro}, ${viacepData.localidade}, ${viacepData.uf}, Brazil`;
    const byStreet = viacepData.logradouro?.trim() ? await nominatimSearch(fullAddr) : null;
    if (byStreet) return byStreet;

    const byPostcode = await nominatimSearch(`${cleaned}, Brazil`);
    if (byPostcode) return byPostcode;

    return null;
  } catch {
    return null;
  }
}

/**
 * Calculate straight-line distance (km) between two lat/lng points using Haversine formula.
 * Useful for delivery radius zones. Real-world driving distance may vary.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get delivery price for a given distance (km) within radius zones.
 * Returns the first zone where distance <= maxKm.
 * Zones must be sorted ascending by maxKm (null = open-ended, last).
 * Returns null if distance exceeds all zones.
 */
export function getPriceForDistance(
  distanceKm: number,
  zones: Array<{ maxKm: number | null; priceCents: number }>
): number | null {
  for (const zone of zones) {
    if (zone.maxKm === null || distanceKm <= zone.maxKm) {
      return zone.priceCents;
    }
  }
  return null; // Distance exceeds all zones
}
