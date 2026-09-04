import React, { useEffect, useRef, useState } from "react";
import type { RadiusZone } from "../../../api/endpoints/delivery.js";

// Default radius tiers (km). null = "10+ km" (open-ended)
const DEFAULT_TIERS: Array<{ maxKm: number | null; label: string }> = [
  { maxKm: 1, label: "Até 1 km" },
  { maxKm: 3, label: "Até 3 km" },
  { maxKm: 5, label: "Até 5 km" },
  { maxKm: 7, label: "Até 7 km" },
  { maxKm: 9, label: "Até 9 km" },
  { maxKm: null, label: "10+ km" },
];

// Colors for radius rings on map
const RING_COLORS = ["#22c55e", "#84cc16", "#eab308", "#f97316", "#ef4444", "#a855f7"];

interface RadiusZonesEditorProps {
  zones: RadiusZone[];
  onChange: (zones: RadiusZone[]) => void;
  originZip?: string;
}

// Geocode Brazilian CEP via ViaCEP + Nominatim for lat/lng
async function geocodeCep(cep: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const cleaned = cep.replace(/\D/g, "");
    if (cleaned.length !== 8) return null;
    const resp = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
    const data = await resp.json();
    if (data.erro) return null;
    // Use Nominatim for lat/lng from address
    const q = `${data.logradouro}, ${data.bairro}, ${data.localidade}, ${data.uf}, Brazil`;
    const nomResp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
    const nomData = await nomResp.json();
    if (nomData.length > 0) {
      return { lat: parseFloat(nomData[0].lat), lng: parseFloat(nomData[0].lon) };
    }
    // Fallback: city-level
    const cityResp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${data.localidade}, ${data.uf}, Brazil&limit=1`);
    const cityData = await cityResp.json();
    if (cityData.length > 0) {
      return { lat: parseFloat(cityData[0].lat), lng: parseFloat(cityData[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

const centsToStr = (cents: number) => (cents ? (cents / 100).toFixed(2).replace(".", ",") : "");
const strToCents = (str: string) => {
  const cleaned = str.replace(/[^\d,]/g, "").replace(",", ".");
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(val * 100);
};

export function RadiusZonesEditor({ zones, onChange, originZip }: RadiusZonesEditorProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [manualCep, setManualCep] = useState("");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);

  // Raw string state per tier — avoids reformat-on-keystroke loop ("10" -> "1,00")
  const [priceRaw, setPriceRaw] = useState<string[]>(() =>
    DEFAULT_TIERS.map((tier) => {
      const existing = zones.find((z) => z.maxKm === tier.maxKm);
      return centsToStr(existing?.priceCents ?? 0);
    })
  );

  // Sync raw strings ONLY on external load (not on our own edits).
  // A ref guards against the feedback loop: typing emits new zones via
  // onChange, which would otherwise re-sync and reformat mid-typing.
  const selfEditRef = useRef(false);
  const loadedRef = useRef(false);
  useEffect(() => {
    if (selfEditRef.current) {
      // This change came from our own onChange — skip re-sync
      selfEditRef.current = false;
      return;
    }
    // Only sync the first time zones arrive with content, or on genuine external reset
    if (!loadedRef.current && zones.length > 0) {
      loadedRef.current = true;
      setPriceRaw(
        DEFAULT_TIERS.map((tier) => {
          const existing = zones.find((z) => z.maxKm === tier.maxKm);
          return centsToStr(existing?.priceCents ?? 0);
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones]);

  // Effective CEP: prop from merchant config, or manual override
  const effectiveCep = (originZip && originZip.replace(/\D/g, "").length === 8) ? originZip : manualCep;

  // Geocode origin ZIP (from config or manual input)
  useEffect(() => {
    const cleaned = effectiveCep.replace(/\D/g, "");
    if (cleaned.length !== 8) return;
    geocodeCep(cleaned).then((coords) => {
      if (coords) setOrigin(coords);
    });
  }, [effectiveCep]);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || !origin) return;
    // Dynamically import leaflet to avoid SSR issues
    import("leaflet").then((L) => {
      // Import CSS
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      if (mapRef.current) {
        mapRef.current.setView([origin.lat, origin.lng], 13);
        return;
      }

      const map = L.map(mapContainerRef.current!, {
        center: [origin.lat, origin.lng],
        zoom: 13,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);

      // Origin marker
      L.circleMarker([origin.lat, origin.lng], {
        radius: 6,
        fillColor: "var(--color-brand)",
        fillOpacity: 1,
        color: "#fff",
        weight: 2,
      }).addTo(map);

      mapRef.current = map;
      drawCircles(L, map);
    });
  }, [origin]);

  // Redraw circles on activeIdx change
  useEffect(() => {
    if (!mapRef.current || !origin) return;
    import("leaflet").then((L) => {
      drawCircles(L, mapRef.current);
    });
  }, [activeIdx, origin]);

  function drawCircles(L: any, map: any) {
    // Clear existing
    circlesRef.current.forEach((c) => c.remove());
    circlesRef.current = [];

    if (!origin) return;

    // Draw all defined zones as faint rings
    DEFAULT_TIERS.forEach((tier, i) => {
      if (tier.maxKm === null) return; // Skip open-ended
      const radiusMeters = tier.maxKm * 1000;
      const isActive = activeIdx === i;
      const circle = L.circle([origin.lat, origin.lng], {
        radius: radiusMeters,
        color: RING_COLORS[i],
        weight: isActive ? 3 : 1,
        fillColor: RING_COLORS[i],
        fillOpacity: isActive ? 0.15 : 0.04,
        dashArray: isActive ? undefined : "5 5",
      }).addTo(map);
      circlesRef.current.push(circle);
    });

    // Fit bounds to largest active ring or all
    const maxTier = DEFAULT_TIERS.filter((t) => t.maxKm !== null).at(-1);
    if (maxTier?.maxKm) {
      const bounds = L.latLng(origin.lat, origin.lng).toBounds(maxTier.maxKm * 2000);
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }

  const handlePriceChange = (idx: number, raw: string) => {
    const cleaned = raw.replace(/[^\d,]/g, "");
    const updated = [...priceRaw];
    updated[idx] = cleaned;
    setPriceRaw(updated);
    // Mark as self-edit so useEffect doesn't re-sync
    selfEditRef.current = true;
    const parsed: RadiusZone[] = DEFAULT_TIERS.map((tier, i) => ({
      maxKm: tier.maxKm,
      priceCents: strToCents(updated[i] ?? ""),
    }));
    onChange(parsed.filter((z) => z.priceCents > 0));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Faixas de distância
      </label>

      {/* Map preview */}
      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: 200,
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          overflow: "hidden",
          background: "#f0f0f0",
        }}
      >
        {!origin && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
            {effectiveCep ? "Carregando mapa..." : "Informe o CEP de origem abaixo"}
          </div>
        )}
      </div>

      {/* Manual CEP input when merchant has no origin zip configured */}
      {!originZip && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            inputMode="numeric"
            value={manualCep}
            onChange={(e) => setManualCep(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="CEP de origem (ex: 20040020)"
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", font: "13px var(--font-sans)", color: "var(--color-text)" }}
          />
        </div>
      )}

      {/* Zone price inputs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {DEFAULT_TIERS.map((tier, i) => (
          <div
            key={tier.maxKm ?? "open"}
            onFocus={() => setActiveIdx(i)}
            onMouseEnter={() => setActiveIdx(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 8,
              border: `1.5px solid ${activeIdx === i ? RING_COLORS[i] : "var(--color-border)"}`,
              background: activeIdx === i ? `${RING_COLORS[i]}0a` : "var(--surface-1)",
              transition: "all 0.15s",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: RING_COLORS[i],
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, font: "13px var(--font-sans)", color: "var(--color-text)" }}>
              {tier.label}
            </span>
            <div style={{ position: "relative", width: 100 }}>
              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>R$</span>
              <input
                type="text"
                inputMode="decimal"
                value={priceRaw[i] ?? ""}
                onChange={(e) => handlePriceChange(i, e.target.value)}
                placeholder="0,00"
                style={{
                  width: "100%",
                  padding: "6px 8px 6px 28px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--surface-1)",
                  font: "13px var(--font-mono)",
                  color: "var(--color-text)",
                  textAlign: "right",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>
        Deixe R$ 0,00 para não entregar nessa faixa. Faixas com preço definido aparecem no checkout.
      </div>
    </div>
  );
}
