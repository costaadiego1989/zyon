import React, { useMemo, useState } from "react";
import { Lightbulb, TrendingUp } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Pagination } from "../../components/Pagination.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useRevenueManagerPage } from "./useRevenueManagerPage.js";

export interface RevenueManagerPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

type TabKey = "hypotheses" | "observations" | "lessons";

const CARD: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "24px",
  boxShadow: "var(--card-shadow)",
  transition: "var(--card-transition)",
};

const BADGE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 12px",
  borderRadius: "9999px",
  font: "600 11px var(--font-mono)",
  letterSpacing: "0.02em",
};

const BADGE_APPROVED: React.CSSProperties = {
  ...BADGE,
  background: "var(--color-success-bg)",
  color: "var(--color-success)",
  border: "1px solid var(--color-success-border)",
};

const BADGE_PENDING: React.CSSProperties = {
  ...BADGE,
  background: "var(--color-warning-bg)",
  color: "var(--color-warning)",
  border: "1px solid var(--color-warning-border)",
};

const BADGE_REJECTED: React.CSSProperties = {
  ...BADGE,
  background: "var(--color-error-bg)",
  color: "var(--color-error)",
  border: "1px solid var(--color-error-border)",
};

const BADGE_RISK_LOW: React.CSSProperties = {
  ...BADGE,
  background: "var(--color-success-bg)",
  color: "var(--color-success)",
  border: "1px solid var(--color-success-border)",
};

const BADGE_RISK_MEDIUM: React.CSSProperties = {
  ...BADGE,
  background: "var(--color-warning-bg)",
  color: "var(--color-warning)",
  border: "1px solid var(--color-warning-border)",
};

const BADGE_RISK_HIGH: React.CSSProperties = {
  ...BADGE,
  background: "var(--color-error-bg)",
  color: "var(--color-error)",
  border: "1px solid var(--color-error-border)",
};

const EXPLANATION_BOX: React.CSSProperties = {
  ...CARD,
  padding: "16px 20px",
  background: "var(--surface-1)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  font: "13px var(--font-sans)",
  color: "var(--color-text-secondary)",
  lineHeight: 1.6,
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
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Revenue Manager</h1>
          <p>Login necessário para gerenciar hipóteses e observações</p>
        </div>
      </header>
    );
  }

  if (vm.loading) {
    return (
      <div className="page-container">
        <div className="page-head">
          <div>
            <span className="eyebrow">Inteligência IA</span>
            <h1>Revenue Manager</h1>
          </div>
        </div>
        <div style={{ textAlign: "center", padding: "60px 24px", color: "var(--color-text-muted)", font: "13px var(--font-sans)" }}>
          Carregando...
        </div>
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
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Revenue Manager</h1>
          <p>Aprove hipóteses, observe padrões e extraia lições para aumentar receita.</p>
        </div>
      </header>

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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={EXPLANATION_BOX}>
            <strong style={{ color: "var(--color-text)" }}>O que é uma hipótese?</strong>{" "}
            É uma sugestão de mudança no checkout (ex.: novo gatilho, copy, oferta) gerada a partir dos padrões de comportamento dos seus compradores. Cada hipótese traz uma estimativa de impacto e um nível de risco. Ao aprová-la, o sistema executa um experimento controlado; ao rejeitá-la, ela é descartada e seu feedback alimenta o aprendizado do gerador.
          </div>

          <SectionHeader title="Hipóteses pendentes e histórico" variant="secondary" />

          {vm.hypotheses.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="Nenhuma hipótese encontrada"
              description="Novas hipóteses aparecerão aqui conforme o sistema analisa padrões de checkout."
            />
          ) : (
            vm.hypotheses.map((h) => (
              <div key={h.id} style={{ ...CARD, display: "flex", gap: 16 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <Lightbulb size={16} style={{ flex: "none", marginTop: 2, color: "var(--color-brand)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ font: "13px var(--font-sans)", color: "var(--color-text)", margin: 0, lineHeight: 1.6 }}>{h.hypothesis_text}</p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={riskBadge(h.risk_level)}>
                      {h.risk_level === "low" ? "Risco Baixo" : h.risk_level === "high" ? "Risco Alto" : "Risco Médio"}
                    </span>
                    <span style={{ font: "12px var(--font-mono)", color: "var(--color-brand)" }}>+{h.expected_lift_percent}% lift</span>
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
                      variant="danger"
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={EXPLANATION_BOX}>
            <strong style={{ color: "var(--color-text)" }}>O que são observações?</strong>{" "}
            São registros diários do funil de checkout: taxa de conversão, volume de sessões e a principal objeção detectada. Use estes dados para identificar tendências, validar se experimentos estão funcionando e priorizar novas hipóteses.
          </div>

          <SectionHeader title="Observações recentes" variant="secondary" />

          <div style={CARD}>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={obsQuery}
                onChange={(e) => { setObsQuery(e.target.value); setObsPage(1); }}
                placeholder="Filtrar por data ou objeção..."
                style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "13px var(--font-sans)", transition: "var(--card-transition)" }}
              />
              <select
                value={obsPageSize}
                onChange={(e) => { setObsPageSize(Number(e.target.value)); setObsPage(1); }}
                style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "13px var(--font-sans)", transition: "var(--card-transition)" }}
              >
                <option value={5}>5 / página</option>
                <option value={10}>10 / página</option>
                <option value={20}>20 / página</option>
              </select>
            </div>

            {filteredObservations.length === 0 ? (
              <EmptyState
                title="Nenhuma observação encontrada"
                description="Novas observações aparecerão aqui conforme o checkout processa transações."
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {filteredObservations
                  .slice((obsPage - 1) * obsPageSize, obsPage * obsPageSize)
                  .map((o) => (
                    <div key={o.date} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, padding: "16px 0", borderBottom: "1px solid var(--color-border)", alignItems: "center" }}>
                      <div>
                        <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>DATA</div>
                        <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>{o.date}</div>
                      </div>
                      <div>
                        <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>CONVERSÃO</div>
                        <div style={{ font: "13px var(--font-mono)", color: "var(--color-brand)", fontWeight: 600 }}>{o.conversion_rate.toFixed(2)}%</div>
                      </div>
                      <div>
                        <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>SESSÕES</div>
                        <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>{o.sessions_count.toLocaleString("pt-BR")}</div>
                      </div>
                      <div>
                        <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>TOP OBJEÇÃO</div>
                        <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-secondary)" }}>{o.top_objection}</div>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={EXPLANATION_BOX}>
            <strong style={{ color: "var(--color-text)" }}>O que são lições?</strong>{" "}
            Cada lição é o aprendizado extraído de um experimento concluído: qual variante venceu, qual foi o lift real e qual insight prático pode ser aplicado daqui pra frente. As lições alimentam o gerador de hipóteses, são exibidas no painel de analytics e ajudam o agente a priorizar sugestões mais relevantes para a sua loja.
          </div>

          <SectionHeader title="Lições aprendidas" variant="secondary" />

          {vm.lessons.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="Nenhuma lição extraída ainda"
              description="Lições aparecerão aqui após experimentos serem concluídos."
            />
          ) : (
            vm.lessons.map((l) => (
              <div key={l.experiment_id} style={{ ...CARD, display: "flex", gap: 16, alignItems: "flex-start" }}>
                <TrendingUp size={18} style={{ flex: "none", marginTop: 2, color: "var(--color-success)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>{l.actual_winner}</span>
                    <span style={{ font: "600 12px var(--font-mono)", color: "var(--color-success)" }}>+{l.lift_percent}%</span>
                  </div>
                  <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>{l.lesson}</p>
                  <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", marginTop: 8 }}>
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
