import React from "react";
import type { Experiment, ExperimentMetrics } from "../types.js";

interface ExperimentCardProps {
  experiment: Experiment;
  metrics?: ExperimentMetrics[];
  selected: boolean;
  onSelect: () => void;
}

export function ExperimentCard({ experiment, metrics, selected, onSelect }: ExperimentCardProps) {
  const statusLabel = {
    draft: "Rascunho",
    running: "Em Execução",
    paused: "Pausado",
    completed: "Concluído",
    archived: "Arquivado",
  }[experiment.status];

  const statusColor = {
    draft: "var(--color-text-muted)",
    running: "var(--color-success)",
    paused: "var(--color-warning)",
    completed: "var(--color-brand)",
    archived: "var(--color-text-faint)",
  }[experiment.status];

  const isAuto = /hip[oó]tese[:\s]/i.test(experiment.name)
    || Boolean((experiment as any).hypothesis_id)
    || (experiment as any).source === "auto"
    || (experiment as any).source === "revenue_manager";

  // Aggregate metrics
  const totalVisitors = metrics?.reduce((s, m) => s + m.total_visitors, 0) ?? 0;
  const totalConversions = metrics?.reduce((s, m) => s + m.conversions, 0) ?? 0;
  const avgConversion = totalVisitors > 0 ? ((totalConversions / totalVisitors) * 100).toFixed(1) : "—";
  const totalRevenue = metrics?.reduce((s, m) => s + (m.revenue ?? 0), 0) ?? 0;

  return (
    <button
      onClick={onSelect}
      style={{
        background: selected ? "color-mix(in srgb, var(--color-brand) 8%, var(--surface-2))" : "var(--surface-2)",
        border: selected ? "1px solid var(--color-brand)" : "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: "16px 18px",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Row 1: Title + Status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {experiment.name}
        </span>
        <span
          style={{
            font: "700 9px var(--font-mono)",
            color: statusColor,
            background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${statusColor} 30%, transparent)`,
            padding: "3px 8px",
            borderRadius: "var(--radius-full)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Row 2: Meta (variants, origin, date) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>
          {(experiment.variants ?? []).length} variantes
        </span>
        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--color-text-faint)" }} />
        <span
          style={{
            background: isAuto ? "var(--color-brand-subtle)" : "var(--surface-3, var(--color-surface-raised))",
            color: isAuto ? "var(--color-brand)" : "var(--color-text-muted)",
            font: "600 9px var(--font-mono)",
            padding: "2px 7px",
            borderRadius: "var(--radius-full)",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {isAuto ? "🤖 AUTO" : "✏️ MANUAL"}
        </span>
        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--color-text-faint)" }} />
        <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>
          {new Date(experiment.created_at).toLocaleDateString("pt-BR")}
        </span>
      </div>

      {/* Row 3: KPIs */}
      {(experiment.status === "running" || experiment.status === "completed") && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
          <div>
            <div style={{ font: "600 9px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Sessões</div>
            <div style={{ font: "700 14px var(--font-mono)", color: "var(--color-text)" }}>{totalVisitors > 0 ? totalVisitors.toLocaleString("pt-BR") : String(experiment.sample_size ?? 0)}</div>
          </div>
          <div>
            <div style={{ font: "600 9px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Conversão</div>
            <div style={{ font: "700 14px var(--font-mono)", color: "var(--color-brand)" }}>{avgConversion}%</div>
          </div>
          <div>
            <div style={{ font: "600 9px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Receita</div>
            <div style={{ font: "700 14px var(--font-mono)", color: "var(--color-success)" }}>
              {totalRevenue > 0 ? `R$ ${(totalRevenue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}` : "—"}
            </div>
          </div>
        </div>
      )}
    </button>
  );
}
