import React from "react";
import { TrendingUp, DollarSign, Beaker } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard, StatCardGrid } from "../../components/stat-card.js";
import { SectionHeader } from "../../components/SectionHeader.js";
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
  const { summary, trend, loading, error, isDemo } = useRevenueLiftPage();

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
      <SectionHeader
        title="Revenue Lift"
        subtitle="Quanto a IA gerou de receita a mais para sua loja — comparação entre vendas com IA vs sem IA em períodos equivalentes. ROI = receita adicional / custo do plano."
        trailing={
          isDemo ? (
            <span style={{ ...BADGE, background: "var(--warn-soft)", color: "var(--warn)" }}>
              <Beaker size={12} aria-hidden /> Dados de demonstração
            </span>
          ) : null
        }
      />

      {error && (
        <div style={{ ...BADGE, background: "var(--warn-soft)", color: "var(--warn)" }}>
          ⚠ {error}
        </div>
      )}

      <StatCardGrid>
        <StatCard
          icon={TrendingUp}
          value={`+${summary.lift_percent.toFixed(1)}%`}
          label="Revenue Lift"
          trend={{
            direction: summary.confidence === "significant" ? "up" : "flat",
            text: confidenceLabel,
          }}
          hero
        />
        <StatCard
          icon={DollarSign}
          value={`R$ ${summary.net_lift_brl.toLocaleString("pt-BR")}`}
          label="Lift líquido"
        />
        <StatCard
          icon={DollarSign}
          value={`${summary.roi_percent.toLocaleString("pt-BR")}%`}
          label="ROI"
        />
        <StatCard
          icon={DollarSign}
          value={`R$ ${summary.ai_cost_brl.toLocaleString("pt-BR")}`}
          label="Custo da IA"
        />
      </StatCardGrid>

      <div style={CARD}>
        <SectionHeader
          title="Contribuição por Feature"
          subtitle="Cada IA autônoma contribui com uma fatia do lift total. Use para priorizar o que está gerando mais resultado."
          variant="secondary"
        />
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

      <div style={CARD}>
        <SectionHeader
          title="Tendência Diária"
          subtitle="Comparação dia a dia entre grupo controle (sem IA) e tratamento (com IA). Mantido enquanto o motor holdout roda em background."
          variant="secondary"
        />
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