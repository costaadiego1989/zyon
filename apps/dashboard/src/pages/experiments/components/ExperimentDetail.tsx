import React from "react";
import { Play, Pause, Trash2 } from "lucide-react";
import type { Experiment, ExperimentResults } from "../types.js";
import { EmptyState } from "../../../components/EmptyState.js";
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
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h3 style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", margin: 0, marginBottom: 4 }}>
              {experiment.name}
            </h3>
            <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", margin: 0 }}>
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
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
          <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 8 }}>
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
                  background: v.id === experiment.control_variant_id ? "var(--color-brand-subtle)" : "var(--surface-1)",
                  color: v.id === experiment.control_variant_id ? "var(--color-brand)" : "var(--color-text-muted)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  font: "11px var(--font-sans)",
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
        <div style={{ padding: "20px", textAlign: "center", color: "var(--color-text-faint)" }}>
          Carregando resultados...
        </div>
      ) : results && results.metrics && results.metrics.length > 0 ? (
        <ExperimentMetrics results={results} experiment={experiment} saving={saving} onPromote={onPromote} />
      ) : (
        <EmptyState
          title={experiment.status === "running" ? "Aguardando sessões de compradores" : "Sem resultados registrados"}
          description={experiment.status === "draft"
            ? "Inicie o teste para começar a coletar dados."
            : "Os resultados aparecerão conforme clientes interagirem com o agente."}
        />
      )}
    </div>
  );
}
