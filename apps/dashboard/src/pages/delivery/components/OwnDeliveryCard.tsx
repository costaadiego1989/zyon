import React, { useState } from "react";
import { Truck, Plus, Trash2 } from "lucide-react";
import type { OwnDeliveryConfig } from "../../../api/endpoints/delivery.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { Button } from "../../../components/Button.js";

interface OwnDeliveryCardProps {
  config: OwnDeliveryConfig;
  saving: boolean;
  onUpdate: (patch: Partial<OwnDeliveryConfig>) => Promise<void>;
}

export function OwnDeliveryCard({
  config,
  saving,
  onUpdate,
}: OwnDeliveryCardProps) {
  const [localConfig, setLocalConfig] = useState(config);
  const [newNeighborhood, setNewNeighborhood] = useState({ name: "", priceCents: 0 });

  const handleToggle = () => {
    onUpdate({ ...localConfig, enabled: !localConfig.enabled });
  };

  const handleModeChange = (mode: "fixed" | "by_neighborhood") => {
    setLocalConfig({ ...localConfig, mode });
    onUpdate({ ...localConfig, mode });
  };

  const handleFlatPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cents = Math.round(parseFloat(e.target.value) * 100 || 0);
    setLocalConfig({ ...localConfig, flatPriceCents: cents });
  };

  const handleFreeAboveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    const cents = val ? Math.round(parseFloat(val) * 100) : null;
    setLocalConfig({ ...localConfig, freeAboveCents: cents });
  };

  const handleEstimatedDaysChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const days = Math.max(1, parseInt(e.target.value) || 1);
    setLocalConfig({ ...localConfig, estimatedDays: days });
  };

  const handleAddNeighborhood = () => {
    if (!newNeighborhood.name.trim()) return;
    const updated = [
      ...localConfig.neighborhoods,
      { name: newNeighborhood.name, priceCents: newNeighborhood.priceCents },
    ];
    setLocalConfig({ ...localConfig, neighborhoods: updated });
    onUpdate({ ...localConfig, neighborhoods: updated });
    setNewNeighborhood({ name: "", priceCents: 0 });
  };

  const handleRemoveNeighborhood = (index: number) => {
    const updated = localConfig.neighborhoods.filter((_, i) => i !== index);
    setLocalConfig({ ...localConfig, neighborhoods: updated });
    onUpdate({ ...localConfig, neighborhoods: updated });
  };

  const handleSave = () => {
    onUpdate(localConfig);
  };

  const formatPrice = (cents: number): string => {
    return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const parsePrice = (str: string): number => {
    return Math.round(parseFloat(str.replace(",", ".")) * 100 || 0);
  };

  return (
    <div className="panel" style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Truck size={20} color="var(--color-brand)" />
          <div>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>
              Entrega Própria
            </div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>
              Configuração de entrega operada por você
            </div>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={localConfig.enabled}
            onChange={handleToggle}
            disabled={saving}
            style={{ cursor: saving ? "wait" : "pointer" }}
          />
          <span style={{ font: "12px var(--font-sans)", color: "var(--color-text)" }}>
            {localConfig.enabled ? "Ativada" : "Desativada"}
          </span>
        </label>
      </div>

      {localConfig.enabled && (
        <>
          {/* Mode selector */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Modo
            </label>
            <select
              value={localConfig.mode}
              onChange={(e) => handleModeChange(e.target.value as "fixed" | "by_neighborhood")}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                font: "13px var(--font-sans)",
                color: "var(--color-text)",
                cursor: "pointer",
              }}
            >
              <option value="fixed">Valor Fixo</option>
              <option value="by_neighborhood">Por Bairro</option>
            </select>
          </div>

          {/* Fixed mode */}
          {localConfig.mode === "fixed" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Preço (R$)
                </label>
                <input
                  type="text"
                  value={formatPrice(localConfig.flatPriceCents)}
                  onChange={handleFlatPriceChange}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    background: "var(--surface-1)",
                    font: "13px var(--font-sans)",
                    color: "var(--color-text)",
                  }}
                  placeholder="8,00"
                />
              </div>

              <div>
                <label style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Grátis acima de (R$) — opcional
                </label>
                <input
                  type="text"
                  value={
                    localConfig.freeAboveCents
                      ? formatPrice(localConfig.freeAboveCents)
                      : ""
                  }
                  onChange={handleFreeAboveChange}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    background: "var(--surface-1)",
                    font: "13px var(--font-sans)",
                    color: "var(--color-text)",
                  }}
                  placeholder="50,00"
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Prazo estimado (dias)
                </label>
                <input
                  type="number"
                  min="1"
                  value={localConfig.estimatedDays}
                  onChange={handleEstimatedDaysChange}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    background: "var(--surface-1)",
                    font: "13px var(--font-sans)",
                    color: "var(--color-text)",
                  }}
                />
              </div>
            </div>
          )}

          {/* By neighborhood mode */}
          {localConfig.mode === "by_neighborhood" && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text)", marginBottom: 8, fontWeight: 600 }}>
                  Bairros
                </div>

                {localConfig.neighborhoods.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                    {localConfig.neighborhoods.map((n, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--color-border)",
                          background: "var(--surface-1)",
                        }}
                      >
                        <div>
                          <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                            {n.name}
                          </div>
                          <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-muted)" }}>
                            R$ {formatPrice(n.priceCents)}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveNeighborhood(i)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: 4,
                            display: "flex",
                            alignItems: "center",
                          }}
                          title="Remover"
                        >
                          <Trash2 size={14} color="var(--color-text-muted)" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Nome do bairro"
                    value={newNeighborhood.name}
                    onChange={(e) =>
                      setNewNeighborhood({ ...newNeighborhood, name: e.target.value })
                    }
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--surface-1)",
                      font: "13px var(--font-sans)",
                      color: "var(--color-text)",
                    }}
                  />
                  <input
                    type="text"
                    placeholder="R$ 0,00"
                    value={
                      newNeighborhood.priceCents > 0
                        ? formatPrice(newNeighborhood.priceCents)
                        : ""
                    }
                    onChange={(e) => {
                      const cents = parsePrice(e.target.value);
                      setNewNeighborhood({ ...newNeighborhood, priceCents: cents });
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--surface-1)",
                      font: "13px var(--font-sans)",
                      color: "var(--color-text)",
                      width: 120,
                    }}
                  />
                  <button
                    onClick={handleAddNeighborhood}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-brand-subtle)",
                      color: "var(--color-brand)",
                      cursor: "pointer",
                      font: "13px var(--font-sans)",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      gridColumn: "1 / -1",
                    }}
                  >
                    <Plus size={14} />
                    Adicionar bairro
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            style={{ width: "100%" }}
          >
            {saving ? "Salvando..." : "Salvar configuração"}
          </Button>
        </>
      )}
    </div>
  );
}
