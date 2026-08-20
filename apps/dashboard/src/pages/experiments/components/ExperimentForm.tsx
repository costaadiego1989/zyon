import React from "react";
import { Plus, X, Save } from "lucide-react";
import type { ExperimentForm, Variant } from "../types.js";
import { Button } from "../../../components/Button.js";

interface ExperimentFormProps {
  form: ExperimentForm;
  errors: Record<string, string>;
  loading: boolean;
  onClose: () => void;
  onSave: () => void;
  patch: (p: Partial<ExperimentForm>) => void;
  addVariant: () => void;
  removeVariant: (idx: number) => void;
  updateVariant: (idx: number, updates: Partial<Variant>) => void;
}

export function ExperimentForm({
  form,
  errors,
  loading,
  onClose,
  onSave,
  patch,
  addVariant,
  removeVariant,
  updateVariant,
}: ExperimentFormProps) {
  return (
    <div className="experiment-drawer-overlay" onClick={onClose}>
      <aside
        className="experiment-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Novo Teste A/B"
      >
        {/* Header */}
        <header className="experiment-drawer__header">
          <h2 style={{ font: "600 15px var(--serif)", color: "var(--ink)", margin: 0 }}>
            Novo Teste A/B
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="experiment-drawer__close">
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div className="experiment-drawer__body">
          {/* Name */}
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
              Nome do Teste
            </span>
            <input
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Ex: Desconto 15% vs 20%"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: `1px solid ${errors.name ? "var(--danger)" : "var(--border)"}`,
                background: "var(--bg)",
                color: "var(--ink)",
                font: "13px var(--sans)",
              }}
            />
            {errors.name && (
              <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>
                {errors.name}
              </span>
            )}
          </label>

          {/* Description */}
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
              Descrição (opcional)
            </span>
            <textarea
              value={form.description ?? ""}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Objetivo do teste..."
              rows={2}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--ink)",
                font: "13px var(--sans)",
                resize: "vertical",
              }}
            />
          </label>

          {/* Sample Size */}
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
              Tamanho da Amostra
            </span>
            <input
              type="number"
              value={form.sample_size}
              onChange={(e) => patch({ sample_size: Number(e.target.value) })}
              min="10"
              max="1000000"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: `1px solid ${errors.sample_size ? "var(--danger)" : "var(--border)"}`,
                background: "var(--bg)",
                color: "var(--ink)",
                font: "13px var(--mono)",
              }}
            />
            {errors.sample_size && (
              <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>
                {errors.sample_size}
              </span>
            )}
          </label>

          {/* Variants */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>VARIANTES</span>
              <Button size="sm" onClick={addVariant}>
                <Plus size={12} /> Adicionar
              </Button>
            </div>
            {errors.variants && (
              <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginBottom: 8, display: "block" }}>
                {errors.variants}
              </span>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {form.variants.map((v, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "start" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      value={v.name}
                      onChange={(e) => updateVariant(idx, { name: e.target.value })}
                      placeholder="Nome da variante"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--ink)",
                        font: "12px var(--sans)",
                      }}
                    />
                    <textarea
                      value={v.description ?? ""}
                      onChange={(e) => updateVariant(idx, { description: e.target.value })}
                      placeholder="System prompt do agente para esta variante"
                      rows={3}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--ink)",
                        font: "12px var(--sans)",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="number"
                        value={v.weight ?? 50}
                        onChange={(e) => updateVariant(idx, { weight: Number(e.target.value) })}
                        min="1"
                        max="99"
                        style={{
                          width: 60,
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: "var(--ink)",
                          font: "12px var(--mono)",
                        }}
                      />
                      <span style={{ font: "11px var(--sans)", color: "var(--muted)" }}>% tráfego</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, font: "11px var(--sans)", color: "var(--muted)", marginLeft: "auto" }}>
                        <input
                          type="checkbox"
                          checked={v.is_control ?? idx === 0}
                          onChange={(e) => updateVariant(idx, { is_control: e.target.checked })}
                        />
                        Controle
                      </label>
                    </div>
                  </div>
                  {form.variants.length > 2 && (
                    <button
                      onClick={() => removeVariant(idx)}
                      style={{
                        marginTop: 2,
                        background: "var(--danger-soft)",
                        border: "1px solid var(--danger)",
                        borderRadius: 6,
                        padding: "6px 8px",
                        cursor: "pointer",
                        color: "var(--danger)",
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="experiment-drawer__footer">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSave} loading={loading} disabled={Object.keys(errors).length > 0}>
            <Save size={14} /> Criar Teste
          </Button>
        </footer>
      </aside>
    </div>
  );
}
