import React, { useEffect, useState } from "react";
import { Truck, Plus, Trash2 } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { Button } from "../../../components/Button.js";
import type { OwnDeliveryConfig } from "../../../api/endpoints/delivery.js";

interface OwnDeliveryCardProps {
  config: OwnDeliveryConfig | undefined;
  saving: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onOpenConfig: () => void;
}

// Helper: format estimated value + unit for display
function formatEstimate(value: number, unit: "minutes" | "days"): string {
  if (unit === "minutes") {
    if (value < 60) return `${value} min`;
    const h = Math.floor(value / 60);
    const m = value % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
  return value === 1 ? "1 dia" : `${value} dias`;
}

export function OwnDeliveryCard({ config, saving, onToggle, onOpenConfig }: OwnDeliveryCardProps) {
  const enabled = config?.enabled ?? false;
  const mode = config?.mode ?? "fixed";
  const flatPriceCents = config?.flatPriceCents ?? 0;
  const estimatedValue = config?.estimatedValue ?? 60;
  const estimatedUnit = config?.estimatedUnit ?? "minutes";
  const neighborhoods = config?.neighborhoods ?? [];

  return (
    <div style={{ padding: "20px 24px", borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--surface-1)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Truck size={20} color="var(--color-brand)" />
          <div>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>Entrega Própria</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>Delivery local, motoboy, entregador</div>
          </div>
        </div>
        <ToggleSwitch checked={enabled} onChange={onToggle} disabled={saving} />
      </div>

      {enabled && (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--good-soft)", border: "1px solid var(--good-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                Modo: <strong>{mode === "fixed" ? "Valor Fixo" : "Por Bairro"}</strong>
              </div>
              <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                {mode === "fixed" && flatPriceCents
                  ? `R$ ${(flatPriceCents / 100).toFixed(2)} • ${formatEstimate(estimatedValue, estimatedUnit)}`
                  : mode === "by_neighborhood"
                    ? `${neighborhoods.length} bairro(s) configurado(s)`
                    : "Configure os valores"}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onOpenConfig}>Configurar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SidePanel Content (follows project pattern: Cancelar + Salvar) ───

interface OwnDeliveryConfigPanelProps {
  config: OwnDeliveryConfig | undefined;
  saving: boolean;
  onSave: (patch: Partial<OwnDeliveryConfig>) => Promise<void>;
  onClose: () => void;
}

// Converter hint: show equivalent in the other unit
function converterHint(value: number, unit: "minutes" | "days"): string {
  if (unit === "minutes") {
    const days = Math.floor(value / 1440);
    const hours = Math.floor((value % 1440) / 60);
    if (days > 0 && hours > 0) return `≈ ${days} dia(s) ${hours}h`;
    if (days > 0) return `≈ ${days} dia(s)`;
    if (hours > 0) return `≈ ${hours}h`;
    return `≈ ${value} min`;
  }
  // days → minutes
  const minutes = value * 1440;
  return `≈ ${minutes.toLocaleString("pt-BR")} minutos`;
}

export function OwnDeliveryConfigPanel({ config, saving, onSave, onClose }: OwnDeliveryConfigPanelProps) {
  const [local, setLocal] = useState<OwnDeliveryConfig>({
    enabled: true,
    mode: config?.mode ?? "fixed",
    flatPriceCents: config?.flatPriceCents ?? 800,
    freeAboveCents: config?.freeAboveCents ?? null,
    estimatedValue: config?.estimatedValue ?? 60,
    estimatedUnit: config?.estimatedUnit ?? "minutes",
    neighborhoods: config?.neighborhoods ?? [],
  });
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");

  // Sync if config changes externally
  useEffect(() => {
    if (config) setLocal({ ...config, enabled: true });
  }, [config?.mode, config?.flatPriceCents, config?.neighborhoods?.length]);

  const formatPrice = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
  const parseCents = (str: string) => Math.round(parseFloat(str.replace(",", ".")) * 100 || 0);

  // Máscara de Real: aceita input como "10" = R$ 10,00 (formato livre com vírgula)
  // Usuário digita valor em reais (ex: "10", "10,50", "8,00")
  const handlePriceInput = (raw: string, setter: (cents: number) => void) => {
    // Permite apenas dígitos e vírgula
    const cleaned = raw.replace(/[^\d,]/g, "");
    setter(parseCents(cleaned));
  };
  const displayPrice = (cents: number): string => {
    if (!cents) return "";
    return formatPrice(cents);
  };

  const handleSave = async () => {
    await onSave(local);
    onClose();
  };

  const addNeighborhood = () => {
    if (!newName.trim() || !newPrice) return;
    const priceCents = parseCents(newPrice);
    if (priceCents <= 0) return;
    setLocal({ ...local, neighborhoods: [...local.neighborhoods, { name: newName.trim(), priceCents }] });
    setNewName("");
    setNewPrice("");
  };

  const removeNeighborhood = (i: number) => {
    setLocal({ ...local, neighborhoods: local.neighborhoods.filter((_, idx) => idx !== i) });
  };

  const switchUnit = (newUnit: "minutes" | "days") => {
    if (newUnit === local.estimatedUnit) return;
    let newValue: number;
    if (newUnit === "days") {
      // minutes → days
      newValue = Math.max(1, Math.round(local.estimatedValue / 1440));
    } else {
      // days → minutes
      newValue = local.estimatedValue * 1440;
    }
    setLocal({ ...local, estimatedUnit: newUnit, estimatedValue: newValue });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "100%" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Mode selector */}
        <div>
          <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Modo de cobrança
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {([{ key: "fixed", label: "Valor Fixo" }, { key: "by_neighborhood", label: "Por Bairro" }] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setLocal({ ...local, mode: opt.key })}
                style={{
                  flex: 1, padding: "10px 12px", borderRadius: 8,
                  border: `1.5px solid ${local.mode === opt.key ? "var(--color-brand)" : "var(--color-border)"}`,
                  background: local.mode === opt.key ? "var(--color-brand-subtle)" : "var(--surface-1)",
                  color: local.mode === opt.key ? "var(--color-brand)" : "var(--color-text)",
                  font: "600 13px var(--font-sans)", cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fixed mode */}
        {local.mode === "fixed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Preço da entrega</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>R$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={displayPrice(local.flatPriceCents ?? 0)}
                  onChange={(e) => handlePriceInput(e.target.value, (c) => setLocal({ ...local, flatPriceCents: c }))}
                  placeholder="8,00"
                  style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", font: "13px var(--font-sans)", color: "var(--color-text)" }}
                />
              </div>
            </div>
            <div>
              <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Grátis acima de (opcional)</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>R$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={local.freeAboveCents ? displayPrice(local.freeAboveCents) : ""}
                  onChange={(e) => handlePriceInput(e.target.value, (c) => setLocal({ ...local, freeAboveCents: c || null }))}
                  placeholder="50,00"
                  style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", font: "13px var(--font-sans)", color: "var(--color-text)" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Neighborhood mode */}
        {local.mode === "by_neighborhood" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Bairros ({local.neighborhoods.length})
            </label>
            {local.neighborhoods.map((n, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)" }}>
                <span style={{ flex: 1, font: "13px var(--font-sans)", color: "var(--color-text)" }}>{n.name}</span>
                <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>R$ {displayPrice(n.priceCents)}</span>
                <button type="button" onClick={() => removeNeighborhood(i)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4 }}>
                  <Trash2 size={14} color="var(--danger)" />
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="Bairro" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", font: "13px var(--font-sans)", color: "var(--color-text)" }} />
              <input
                type="text"
                inputMode="decimal"
                placeholder="R$ 0,00"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value.replace(/[^\d,]/g, ""))}
                style={{ width: 90, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", font: "13px var(--font-sans)", color: "var(--color-text)" }}
              />
              <Button variant="outline" size="sm" onClick={addNeighborhood}><Plus size={14} /> Add</Button>
            </div>
          </div>
        )}

        {/* Estimated time — unit toggle + value input + converter hint */}
        <div>
          <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Tempo estimado de entrega
          </label>
          {/* Unit toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {([{ key: "minutes", label: "Minutos" }, { key: "days", label: "Dias" }] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => switchUnit(opt.key)}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 8,
                  border: `1.5px solid ${local.estimatedUnit === opt.key ? "var(--color-brand)" : "var(--color-border)"}`,
                  background: local.estimatedUnit === opt.key ? "var(--color-brand-subtle)" : "var(--surface-1)",
                  color: local.estimatedUnit === opt.key ? "var(--color-brand)" : "var(--color-text)",
                  font: "600 13px var(--font-sans)", cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Value input */}
          <input
            type="number"
            min="1"
            step="1"
            value={local.estimatedValue}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v > 0) setLocal({ ...local, estimatedValue: v });
            }}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", font: "13px var(--font-sans)", color: "var(--color-text)" }}
          />
          {/* Converter hint */}
          <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 6 }}>
            {converterHint(local.estimatedValue, local.estimatedUnit)}
          </div>
        </div>
      </div>

      {/* Footer buttons — Cancelar + Salvar (project pattern) */}
      <div style={{ display: "flex", gap: 8, paddingTop: 16, borderTop: "1px solid var(--color-border)" }}>
        <Button variant="outline" size="sm" onClick={onClose} style={{ flex: 1 }}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
