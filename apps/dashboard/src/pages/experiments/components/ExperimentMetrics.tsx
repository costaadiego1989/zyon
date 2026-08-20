import React from "react";
import { ArrowUpRight, Trophy } from "lucide-react";
import type { Experiment, ExperimentResults } from "../types.js";
import { Button } from "../../../components/Button.js";
import { SignificanceIndicator } from "./SignificanceIndicator.js";

interface ExperimentMetricsProps {
  results: ExperimentResults;
  experiment: Experiment;
  saving: boolean;
  onPromote: (variantId: string) => void;
}

export function ExperimentMetrics({
  results,
  experiment,
  saving,
  onPromote,
}: ExperimentMetricsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Confidence */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
              CONFIANÇA
            </span>
            <span style={{ font: "24px var(--mono)", color: "var(--accent)" }}>
              {results.confidence_level}%
            </span>
          </div>
          <SignificanceIndicator confidence={results.confidence_level} />
        </div>
      </div>

      {/* Metrics Table */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>MÉTRICAS POR VARIANTE</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "12px var(--mono)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", font: "600 11px var(--sans)", color: "var(--muted)" }}>
                  Variante
                </th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>
                  Visitantes
                </th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>
                  Conversões
                </th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>
                  Taxa
                </th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>
                  Ticket Médio
                </th>
              </tr>
            </thead>
            <tbody>
              {results.metrics.map((m: any) => {
                const variant = experiment.variants.find((v) => v.id === m.variant_id);
                const isWinner = results.winner_variant_id === m.variant_id;
                return (
                  <tr key={m.variant_id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px", color: "var(--ink)" }}>
                      {variant?.name}
                      {isWinner && (
                        <Trophy size={12} style={{ marginLeft: 6, display: "inline", color: "var(--accent)" }} />
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--ink)" }}>
                      {m.total_visitors}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--ink)" }}>
                      {m.conversions}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        textAlign: "right",
                        color: isWinner ? "var(--good)" : "var(--ink)",
                      }}
                    >
                      {m.conversion_rate?.toFixed(2) ?? "0.00"}%
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--ink)" }}>
                      R$ {m.avg_order_value?.toFixed(2) ?? "0.00"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Promote Button */}
      {results.winner_variant_id && (
        <Button
          variant="primary"
          onClick={() => onPromote(results.winner_variant_id!)}
          disabled={results.confidence_level < 95}
          loading={saving}
        >
          <ArrowUpRight size={14} />
          Promover Variante Vencedora {results.confidence_level < 95 ? `(${results.confidence_level}% < 95%)` : ""}
        </Button>
      )}
    </div>
  );
}
