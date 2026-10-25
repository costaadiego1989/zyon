import React, { useEffect, useRef, useState } from "react";
import { FormField } from "../../../components/FormField.js";
import { Button } from "../../../components/Button.js";
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
    const signal = AbortSignal.timeout(10000);
    const cleaned = cep.replace(/\D/g, "");
    if (cleaned.length !== 8) return null;
    const resp = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, { signal });
    const data = await resp.json();
    if (data.erro) return null;
    // Use Nominatim for lat/lng from address
    const q = `${data.logradouro}, ${data.bairro}, ${data.localidade}, ${data.uf}, Brazil`;
    const nomResp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`, { signal });
    const nomData = await nomResp.json();
    if (nomData.length > 0) {
      return { lat: parseFloat(nomData[0].lat), lng: parseFloat(nomData[0].lon) };
    }
    // Fallback: city-level
    const cityResp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${data.localidade}, ${data.uf}, Brazil&limit=1`, { signal });
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
  const cleaned = str.replace(",", ".");
  const val = /^\d+(?:[.]\d{0,2})?$/.test(cleaned) ? Number(cleaned) : NaN;
  return isNaN(val) ? 0 : Math.round(val * 100);
};

export function RadiusZonesEditor({ zones, onChange, originZip }: RadiusZonesEditorProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [manualCep, setManualCep] = useState("");
  const [mapStatus, setMapStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [attempt, setAttempt] = useState(0);
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

  // Ignore late geocoding responses after a CEP change or modal closure.
  useEffect(() => {
    let cancelled = false;
    setOrigin(null);
    if (effectiveCep.replace(/\D/g, "").length !== 8) { setMapStatus("idle"); return; }
    setMapStatus("loading");
    geocodeCep(effectiveCep).then(coords => {
      if (cancelled) return;
      setOrigin(coords);
      setMapStatus(coords ? "ready" : "error");
    });
    return () => { cancelled = true; };
  }, [effectiveCep, attempt]);

  useEffect(() => {
    if (!mapContainerRef.current || !origin) return;
    let cancelled = false;
    import("leaflet").then(L => {
      if (cancelled || !mapContainerRef.current) return;
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css"; link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      // The preview can unmount while the user changes pricing mode or closes the modal.
      // Avoid deferred zoom transitions that would access the removed map pane.
      const map = L.map(mapContainerRef.current, { center: [origin.lat, origin.lng], zoom: 13, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      L.circleMarker([origin.lat, origin.lng], { radius: 6, fillColor: "var(--color-brand)", fillOpacity: 1, color: "var(--surface-1)", weight: 2 }).addTo(map);
      mapRef.current = map;
      drawCircles(L, map);
    }).catch(() => { if (!cancelled) setMapStatus("error"); });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; circlesRef.current = []; };
  }, [origin]);

  useEffect(() => {
    let cancelled = false;
    if (mapRef.current && origin) void import("leaflet").then(L => {
      if (!cancelled && mapRef.current) drawCircles(L, mapRef.current);
    }).catch(() => { if (!cancelled) setMapStatus("error"); });
    return () => { cancelled = true; };
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
      map.fitBounds(bounds, { padding: [20, 20], animate: false });
    }
  }

  const handlePriceChange = (idx: number, raw: string) => {
    if (!/^\d*(?:[.,]\d{0,2})?$/.test(raw)) return;
    const cleaned = raw;
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

  return <div className="delivery-radius">
    <p>Defina o preço por distância a partir da loja. Deixe vazio ou use 0 nas faixas sem atendimento.</p>
    <div className="configuration-form__grid">
      {DEFAULT_TIERS.map((tier, i) => <div key={tier.maxKm ?? "open"} onFocus={() => setActiveIdx(i)} onMouseEnter={() => setActiveIdx(i)}>
        <FormField label={tier.label + " (R$)"} value={priceRaw[i] ?? ""} onChange={value => handlePriceChange(i, value)} inputProps={{ inputMode: "decimal" }} placeholder="Sem atendimento" />
      </div>)}
    </div>
    {(!originZip || originZip.replace(/\D/g, "").length !== 8) && <FormField label="CEP para visualizar o mapa" value={manualCep} onChange={value => setManualCep(value.replace(/\D/g, "").slice(0, 8))} placeholder="Ex.: 20040020" inputProps={{ inputMode: "numeric" }} hint="Usado apenas nesta prévia. O endereço da loja continua sendo a origem das entregas." />}
    {origin && mapStatus !== "error" ? <div ref={mapContainerRef} className="delivery-radius__map" aria-label="Mapa de referência das faixas de entrega" /> : <div className="delivery-radius__placeholder" role="status">
      <p>{mapStatus === "loading" ? "Buscando a localização para o mapa…" : mapStatus === "error" ? "Não foi possível exibir o mapa. Você pode continuar configurando os valores." : "Informe um CEP com 8 dígitos para visualizar as faixas no mapa."}</p>
      {mapStatus === "error" && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Tentar carregar o mapa</Button>}
    </div>}
    <p>O mapa é uma referência aproximada da área atendida.</p>
  </div>;
}
