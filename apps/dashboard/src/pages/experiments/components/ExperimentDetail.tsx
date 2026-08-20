import React from "react";
import { Play, Pause, Trash2 } from "lucide-react";
import type { Experiment, ExperimentResults } from "../types.js";
import { Button } from "../../../components/Button.js";
import { ExperimentMetrics } from "./ExperimentMetrics.js";

interface ExperimentDetailProps {
  experiment: Experiment;
  results: ExperimentResults | null;
  loading: boolean;
  saving: boolean;
  onStart: () => void;
  onStop: () => void;
  onPromote: (variantId: string) => void;
  onArchive: () => void;
}

export function ExperimentDetail({
  experiment,
  results,
  loading,
  saving,
  onStart,
  onStop,
  onPromote,
  onArchive,
}: ExperimentDetailProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h3 style={{ font: "600 14px var(--sans)", color: "var(--ink)", margin: 0, marginBottom: 4 }}>
              {experiment.name}
            </h3>
            <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: 0 }}>
              Criado em {new Date(experiment.created_at).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {experiment.status === "draft" && (
              <Button size="sm" variant="primary" onClick={onStart} loading={saving}>
                <Play size={12} /> Iniciar
              </Button>
            )}
            {experiment.status === "running" && (
              <Button size="sm" variant="outline" onClick={onStop} loading={saving}>
                <Pause size={12} /> Pausar
              </Button>
            )}
            {experiment.status !== "archived" && (
              <Button size="sm" variant="ghost" onClick={onArchive} loading={saving}>
                <Trash2 size={12} /> Arquivar
              </Button>
            )}
          </div>
        </div>

        {/* Variants */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 8 }}>
            VARIANTES
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(experiment.variants ?? []).map((v) => (
              <span
                key={v.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: v.id === experiment.control_variant_id ? "var(--accent-soft)" : "var(--bg)",
                  color: v.id === experiment.control_variant_id ? "var(--accent)" : "var(--muted)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  font: "11px var(--sans)",
                }}
              >
                {v.name}
                {v.id === experiment.control_variant_id && <span style={{ font: "9px" }}>CONTROL</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ padding: "20px", textAlign: "center", color: "var(--faint)" }}>
          Carregando resultados...
        </div>
      ) : results && results.metrics && results.metrics.length > 0 ? (
        <ExperimentMetrics results={results} experiment={experiment} saving={saving} onPromote={onPromote} />
      ) : experiment.status === "running" ? (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "32px 20px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: "var(--accent)",
            animation: "pulse 2s infinite",
            boxShadow: "0 0 8px var(--accent)",
          }} />
          <p style={{ font: "13px var(--sans)", color: "var(--muted)", margin: 0 }}>
            Teste ativo — aguardando sessões de compradores
          </p>
          <p style={{ font: "11px var(--sans)", color: "var(--faint)", margin: 0 }}>
            Os resultados aparecerão aqui conforme clientes interagem com o agente
          </p>
        </div>
      ) : (
        <div
          style={{
            background: "var(--card)",
            border: "1px dashed var(--border)",
            borderRadius: 10,
            padding: 20,
            textAlign: "center",
            color: "var(--muted)",
            font: "13px var(--sans)",
          }}
        >
          {experiment.status === "draft"
            ? "Inicie o teste para começar a coletar dados"
            : "Sem resultados registrados"}
        </div>
      )}
    </div>
  );
}
