/**
 * Geocode a Brazilian CEP to lat/lng using ViaCEP + Nominatim.
 * ViaCEP is free (no key required).
 * Falls back from street-level to city-level if exact address not found.
 */
export async function geocodeBrazilianCep(cep: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const cleaned = cep.replace(/\D/g, "");
    if (cleaned.length !== 8) return null;

    // Query ViaCEP
    const viacepResp = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
    const viacepData = await viacepResp.json();
    if (viacepData.erro) return null;

    // Try Nominatim with full address
    const fullAddr = `${viacepData.logradouro}, ${viacepData.bairro}, ${viacepData.localidade}, ${viacepData.uf}, Brazil`;
    const nomResp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddr)}&limit=1`
    );
    const nomData = await nomResp.json();
    if (nomData.length > 0) {
      return { lat: parseFloat(nomData[0].lat), lng: parseFloat(nomData[0].lon) };
    }

    // Fallback: city-level
    const cityAddr = `${viacepData.localidade}, ${viacepData.uf}, Brazil`;
    const cityResp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityAddr)}&limit=1`
    );
    const cityData = await cityResp.json();
    if (cityData.length > 0) {
      return { lat: parseFloat(cityData[0].lat), lng: parseFloat(cityData[0].lon) };
    }

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
