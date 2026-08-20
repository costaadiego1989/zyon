import React, { useState } from "react";
import { CheckCircle, AlertCircle, Clock, Lightbulb, TrendingUp } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { useRevenueManagerPage } from "./useRevenueManagerPage.js";

export interface RevenueManagerPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

type TabKey = "hypotheses" | "observations" | "lessons";

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

const BADGE_APPROVED: React.CSSProperties = {
  ...BADGE,
  background: "var(--good-soft)",
  color: "var(--good)",
};

const BADGE_PENDING: React.CSSProperties = {
  ...BADGE,
  background: "var(--warn-soft)",
  color: "var(--warn)",
};

const BADGE_REJECTED: React.CSSProperties = {
  ...BADGE,
  background: "var(--danger-soft)",
  color: "var(--danger)",
};

const BADGE_RISK_LOW: React.CSSProperties = {
  ...BADGE,
  background: "var(--good-soft)",
  color: "var(--good)",
};

const BADGE_RISK_MEDIUM: React.CSSProperties = {
  ...BADGE,
  background: "var(--warn-soft)",
  color: "var(--warn)",
};

const BADGE_RISK_HIGH: React.CSSProperties = {
  ...BADGE,
  background: "var(--danger-soft)",
  color: "var(--danger)",
};

export function RevenueManagerPage(props: RevenueManagerPageProps) {
  const vm = useRevenueManagerPage();
  const [tab, setTab] = useState<TabKey>("hypotheses");

  if (!props.me) {
    return <p style={{ color: "var(--faint)", font: "13px var(--sans)" }}>Login necessário</p>;
  }

  if (vm.loading) {
    return (
      <div className="panel" style={{ padding: "60px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>
        Carregando...
      </div>
    );
  }

  const statusBadge = (status: string) => {
    if (status === "approved") return BADGE_APPROVED;
    if (status === "rejected") return BADGE_REJECTED;
    return BADGE_PENDING;
  };

  const riskBadge = (risk: string) => {
    if (risk === "low") return BADGE_RISK_LOW;
    if (risk === "high") return BADGE_RISK_HIGH;
    return BADGE_RISK_MEDIUM;
  };

  const statusLabel = (status: string) => {
    if (status === "approved") return "Aprovada";
    if (status === "rejected") return "Rejeitada";
    return "Aguardando revisão";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)" }}>INTELIGÊNCIA</span>
        <h1 style={{ font: "600 26px var(--serif)", margin: "4px 0 6px", color: "var(--ink)" }}>Revenue Manager</h1>
        <p style={{ font: "13px var(--sans)", color: "var(--muted)", margin: 0 }}>
          Aprove hipóteses, observe padrões e extraia lições
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 12, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {(["hypotheses", "observations", "lessons"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 0",
              paddingBottom: 10,
              marginBottom: -1,
              border: "none",
              background: "transparent",
              font: "13px var(--sans)",
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "color 0.2s",
            }}
          >
            {t === "hypotheses" && "Hipóteses"}
            {t === "observations" && "Observações"}
            {t === "lessons" && "Lições"}
          </button>
        ))}
      </div>

      {/* Hypotheses Tab */}
      {tab === "hypotheses" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {vm.hypotheses.length === 0 ? (
            <div style={{ ...CARD, textAlign: "center", padding: "60px 22px", color: "var(--faint)" }}>
              Nenhuma hipótese encontrada
            </div>
          ) : (
            vm.hypotheses.map((h) => (
              <div key={h.id} style={{ ...CARD, display: "flex", gap: 16 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <Lightbulb size={16} style={{ flex: "none", marginTop: 2, color: "var(--accent)" }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ font: "13px var(--sans)", color: "var(--ink)", margin: 0, lineHeight: 1.5 }}>{h.hypothesis_text}</p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={riskBadge(h.risk_level)}>
                      {h.risk_level === "low" ? "Risco Baixo" : h.risk_level === "high" ? "Risco Alto" : "Risco Médio"}
                    </span>
                    <span style={{ font: "12px var(--mono)", color: "var(--accent)" }}>+{h.expected_lift_percent}% lift esperado</span>
                    <span style={statusBadge(h.status)}>{statusLabel(h.status)}</span>
                  </div>
                </div>
                {h.status === "pending_review" && (
                  <div style={{ display: "flex", gap: 10, flex: "none" }}>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => vm.approveHypothesis(h.id)}
                      disabled={vm.approving.has(h.id)}
                      style={{ minWidth: 80 }}
                    >
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => vm.rejectHypothesis(h.id)}
                      disabled={vm.approving.has(h.id)}
                      style={{ minWidth: 80 }}
                    >
                      Rejeitar
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Observations Tab */}
      {tab === "observations" && (
        <div style={{ ...CARD }}>
          {vm.observations.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 22px", color: "var(--faint)" }}>Sem dados</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {vm.observations.map((o) => (
                <div key={o.date} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                  <div>
                    <div style={{ font: "11px var(--mono)", color: "var(--faint)" }}>DATA</div>
                    <div style={{ font: "13px var(--sans)", color: "var(--ink)" }}>{o.date}</div>
                  </div>
                  <div>
                    <div style={{ font: "11px var(--mono)", color: "var(--faint)" }}>CONVERSÃO</div>
                    <div style={{ font: "13px var(--sans)", color: "var(--accent)" }}>{o.conversion_rate.toFixed(2)}%</div>
                  </div>
                  <div>
                    <div style={{ font: "11px var(--mono)", color: "var(--faint)" }}>SESSÕES</div>
                    <div style={{ font: "13px var(--sans)", color: "var(--ink)" }}>{o.sessions_count.toLocaleString("pt-BR")}</div>
                  </div>
                  <div>
                    <div style={{ font: "11px var(--mono)", color: "var(--faint)" }}>TOP OBJEÇÃO</div>
                    <div style={{ font: "13px var(--sans)", color: "var(--muted)" }}>{o.top_objection}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lessons Tab */}
      {tab === "lessons" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {vm.lessons.length === 0 ? (
            <div style={{ ...CARD, textAlign: "center", padding: "60px 22px", color: "var(--faint)" }}>
              Nenhuma lição extraída ainda
            </div>
          ) : (
            vm.lessons.map((l) => (
              <div key={l.experiment_id} style={{ ...CARD, display: "flex", gap: 16, alignItems: "flex-start" }}>
                <TrendingUp size={18} style={{ flex: "none", marginTop: 2, color: "var(--good)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>{l.actual_winner}</span>
                    <span style={{ font: "600 12px var(--mono)", color: "var(--good)" }}>+{l.lift_percent}%</span>
                  </div>
                  <p style={{ font: "13px var(--sans)", color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>{l.lesson}</p>
                  <div style={{ font: "11px var(--mono)", color: "var(--faint)", marginTop: 6 }}>
                    {new Date(l.learned_at).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
