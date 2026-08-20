import React from "react";
import { TrendingUp, DollarSign, Brain } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { useRevenueLiftPage } from "./useRevenueLiftPage.js";

export interface RevenueLiftPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: "24px 28px",
};

const BADGE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 10px",
  borderRadius: 20,
  font: "600 11px var(--mono)",
  letterSpacing: "0.02em",
};

export function RevenueLiftPage(props: RevenueLiftPageProps) {
  const { summary, trend, loading, error } = useRevenueLiftPage();

  if (!props.me) {
    return <p style={{ color: "var(--faint)", font: "13px var(--sans)" }}>Login necessário</p>;
  }

  if (loading) {
    return (
      <div className="panel" style={{ padding: "60px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>
        Carregando dados de revenue lift...
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="panel" style={{ ...CARD, textAlign: "center", padding: "60px 22px" }}>
        <p style={{ color: "var(--faint)", font: "13px var(--sans)" }}>Configuração pendente</p>
      </div>
    );
  }

  const confidenceColor = summary.confidence === "significant" ? "var(--good)" : "var(--warn)";
  const confidenceLabel = summary.confidence === "significant" ? "Significante" : "Amostra insuficiente";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)" }}>INTELIGÊNCIA</span>
        <h1 style={{ font: "600 26px var(--serif)", margin: "4px 0 6px", color: "var(--ink)" }}>Revenue Lift</h1>
        <p style={{ font: "13px var(--sans)", color: "var(--muted)", margin: 0 }}>
          Impacto incremental da IA nas conversões do checkout
        </p>
      </div>

      {error && (
        <div style={{ ...BADGE, background: "var(--warn-soft)", color: "var(--warn)" }}>
          ⚠ {error} — dados mock exibidos
        </div>
      )}

      {/* Hero metric + ROI row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Hero Metric */}
        <div style={{ ...CARD, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "40px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={22} color="var(--accent)" />
            <span style={{ font: "600 10px var(--mono)", color: "var(--faint)", letterSpacing: "0.04em" }}>REVENUE LIFT</span>
          </div>
          <div style={{ font: "700 56px var(--serif)", color: "var(--accent)", letterSpacing: "-0.02em" }}>
            +{summary.lift_percent.toFixed(1)}%
          </div>
          <span style={{ ...BADGE, background: summary.confidence === "significant" ? "var(--good-soft)" : "var(--warn-soft)", color: confidenceColor }}>
            {confidenceLabel}
          </span>
        </div>

        {/* ROI */}
        <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DollarSign size={18} color="var(--accent)" />
            <span style={{ font: "600 10px var(--mono)", color: "var(--faint)", letterSpacing: "0.04em" }}>RETORNO SOBRE INVESTIMENTO</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ font: "11px var(--sans)", color: "var(--muted)", marginBottom: 4 }}>Custo IA</div>
              <div style={{ font: "600 20px var(--serif)", color: "var(--ink)" }}>R$ {summary.ai_cost_brl.toLocaleString("pt-BR")}</div>
            </div>
            <div>
              <div style={{ font: "11px var(--sans)", color: "var(--muted)", marginBottom: 4 }}>Lift Líquido</div>
              <div style={{ font: "600 20px var(--serif)", color: "var(--good)" }}>R$ {summary.net_lift_brl.toLocaleString("pt-BR")}</div>
            </div>
            <div>
              <div style={{ font: "11px var(--sans)", color: "var(--muted)", marginBottom: 4 }}>ROI</div>
              <div style={{ font: "600 20px var(--serif)", color: "var(--accent)" }}>{summary.roi_percent.toLocaleString("pt-BR")}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Feature breakout */}
      <div style={CARD}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <Brain size={16} color="var(--accent)" />
          <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Contribuição por Feature</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {summary.feature_breakout.map((f) => (
            <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, font: "13px var(--sans)", color: "var(--muted)" }}>{f.feature}</div>
              <div style={{ width: 180, height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${f.contribution_percent}%`, background: "var(--accent)", borderRadius: 4, transition: "width 0.3s" }} />
              </div>
              <div style={{ width: 40, textAlign: "right", font: "600 12px var(--mono)", color: "var(--ink)" }}>{f.contribution_percent}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trend */}
      <div style={CARD}>
        <div style={{ font: "600 12px var(--sans)", color: "var(--ink)", marginBottom: 14 }}>Tendência Diária</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "12px var(--sans)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Data</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Lift</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Controle (R$)</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Tratamento (R$)</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((row) => (
                <tr key={row.date} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{row.date}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--accent)", fontWeight: 600 }}>+{row.lift_percent.toFixed(1)}%</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--muted)" }}>{row.revenue_control_brl.toLocaleString("pt-BR")}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--ink)" }}>{row.revenue_treatment_brl.toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
