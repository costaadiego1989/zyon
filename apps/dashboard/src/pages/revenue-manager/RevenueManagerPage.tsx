import React, { useMemo, useState } from "react";
import { Lightbulb, TrendingUp } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Pagination } from "../../components/Pagination.js";
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

const EXPLANATION_BOX: React.CSSProperties = {
  ...CARD,
  padding: "16px 20px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  font: "13px var(--sans)",
  color: "var(--muted)",
  lineHeight: 1.55,
};

const PAGE_SIZE = 5;

export function RevenueManagerPage(props: RevenueManagerPageProps) {
  const vm = useRevenueManagerPage(props.me);
  const [tab, setTab] = useState<TabKey>("hypotheses");
  const [obsQuery, setObsQuery] = useState("");
  const [obsPage, setObsPage] = useState(1);
  const [obsPageSize, setObsPageSize] = useState(PAGE_SIZE);

  const filteredObservations = useMemo(() => {
    const q = obsQuery.trim().toLowerCase();
    if (!q) return vm.observations;
    return vm.observations.filter((o) =>
      o.date.toLowerCase().includes(q) ||
      o.top_objection.toLowerCase().includes(q),
    );
  }, [vm.observations, obsQuery]);

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

  const rejectWithPrompt = (id: string) => {
    const reason = window.prompt("Motivo da rejeição (obrigatório):");
    if (!reason || reason.trim().length === 0) return;
    void vm.rejectHypothesis(id, reason.trim());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <SectionHeader
        title="Revenue Manager"
        subtitle="Aprove hipóteses, observe padrões e extraia lições para aumentar receita."
      />

      {/* Tabs */}
      <TabBar
        tabs={[
          { key: "hypotheses", label: "Hipóteses" },
          { key: "observations", label: "Observações" },
          { key: "lessons", label: "Lições" },
        ]}
        activeTab={tab}
        onTabChange={(k) => setTab(k as TabKey)}
      />

      {/* Hypotheses Tab */}
      {tab === "hypotheses" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={EXPLANATION_BOX}>
            <strong style={{ color: "var(--ink)" }}>O que é uma hipótese?</strong>{" "}
            É uma sugestão de mudança no checkout (ex.: novo gatilho, copy, oferta) gerada a partir dos padrões de comportamento dos seus compradores. Cada hipótese traz uma estimativa de impacto e um nível de risco. Ao aprová-la, o sistema executa um experimento controlado; ao rejeitá-la, ela é descartada e seu feedback alimenta o aprendizado do gerador.
          </div>

          <SectionHeader title="Hipóteses pendentes e histórico" variant="secondary" />

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
                      onClick={() => rejectWithPrompt(h.id)}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={EXPLANATION_BOX}>
            <strong style={{ color: "var(--ink)" }}>O que são observações?</strong>{" "}
            São registros diários do funil de checkout: taxa de conversão, volume de sessões e a principal objeção detectada. Use estes dados para identificar tendências, validar se experimentos estão funcionando e priorizar novas hipóteses.
          </div>

          <SectionHeader title="Observações recentes" variant="secondary" />

          <div style={{ ...CARD, padding: 0 }}>
            <div style={{ display: "flex", gap: 12, padding: "16px 22px", borderBottom: "1px solid var(--border)", alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={obsQuery}
                onChange={(e) => { setObsQuery(e.target.value); setObsPage(1); }}
                placeholder="Filtrar por data ou objeção..."
                style={{ flex: 1, minWidth: 200, padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
              />
              <select
                value={obsPageSize}
                onChange={(e) => { setObsPageSize(Number(e.target.value)); setObsPage(1); }}
                style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
              >
                <option value={5}>5 / página</option>
                <option value={10}>10 / página</option>
                <option value={20}>20 / página</option>
              </select>
            </div>

            {filteredObservations.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 22px", color: "var(--faint)" }}>Nenhuma observação encontrada</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {filteredObservations
                  .slice((obsPage - 1) * obsPageSize, obsPage * obsPageSize)
                  .map((o) => (
                    <div key={o.date} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, padding: "16px 22px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
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

            {filteredObservations.length > obsPageSize && (
              <Pagination
                page={obsPage}
                pageSize={obsPageSize}
                total={filteredObservations.length}
                onChange={setObsPage}
              />
            )}
          </div>
        </div>
      )}

      {/* Lessons Tab */}
      {tab === "lessons" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={EXPLANATION_BOX}>
            <strong style={{ color: "var(--ink)" }}>O que são lições?</strong>{" "}
            Cada lição é o aprendizado extraído de um experimento concluído: qual variante venceu, qual foi o lift real e qual insight prático pode ser aplicado daqui pra frente. As lições alimentam o gerador de hipóteses, são exibidas no painel de analytics e ajudam o agente a priorizar sugestões mais relevantes para a sua loja.
          </div>

          <SectionHeader title="Lições aprendidas" variant="secondary" />

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
