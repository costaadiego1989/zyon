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
    draft: "var(--color-text-muted)",
    running: "var(--color-brand)",
    paused: "var(--color-text-faint)",
    completed: "var(--good, #10b981)",
    archived: "var(--color-text-muted)",
  }[experiment.status];

  return (
    <button
      onClick={onSelect}
      style={{
        background: selected ? "var(--accent-soft, oklch(30% 0.04 160 / 0.3))" : "var(--surface-1)",
        border: selected ? "1px solid var(--color-brand)" : "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s",
        width: "100%",
      }}
    >
      {/* Row 1: Title + Badge right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {experiment.name}
        </span>
        <span
          style={{
            font: "600 9px var(--font-mono)",
            color: statusColor,
            background: `color-mix(in oklch, ${statusColor} 15%, transparent)`,
            padding: "3px 8px",
            borderRadius: 4,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Row 2: Meta below */}
      <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 6 }}>
        {(experiment.variants ?? []).length} variantes • {new Date(experiment.created_at).toLocaleDateString("pt-BR")}
      </div>
    </button>
  );
}
