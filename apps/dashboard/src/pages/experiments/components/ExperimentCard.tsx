import React from "react";
import type { Experiment } from "../types.js";

interface ExperimentCardProps {
  experiment: Experiment;
  selected: boolean;
  onSelect: () => void;
}

export function ExperimentCard({ experiment, selected, onSelect }: ExperimentCardProps) {
  const statusLabel = {
    draft: "Rascunho",
    running: "Em Execução",
    paused: "Pausado",
    completed: "Concluído",
    archived: "Arquivado",
  }[experiment.status];

  const statusColor = {
    draft: "var(--muted)",
    running: "var(--accent)",
    paused: "var(--faint)",
    completed: "var(--good)",
    archived: "var(--muted)",
  }[experiment.status];

  return (
    <button
      onClick={onSelect}
      style={{
        background: selected ? "var(--accent-soft)" : "var(--card)",
        border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 16px",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>{experiment.name}</span>
        <span
          style={{
            font: "11px var(--mono)",
            color: statusColor,
            background: "rgba(0,0,0,0.1)",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div style={{ font: "11px var(--sans)", color: "var(--muted)" }}>
        {experiment.variants.length} variantes • {new Date(experiment.created_at).toLocaleDateString("pt-BR")}
      </div>
    </button>
  );
}
