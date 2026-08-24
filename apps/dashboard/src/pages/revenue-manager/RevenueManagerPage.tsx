import React, { useState } from "react";
import { Lightbulb, TrendingUp, Eye, BookOpen, Brain } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { TabBar } from "../../components/TabBar.js";
import { StatCard } from "../overview/components/StatCard.js";
import { PageLoader } from "../../components/PageLoader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { useRevenueManagerPage } from "./useRevenueManagerPage.js";

export interface RevenueManagerPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

type Tab = "hypotheses" | "observations" | "lessons";

const TABS = [
  { key: "hypotheses" as const, label: "Sugestões" },
  { key: "observations" as const, label: "Observações" },
  { key: "lessons" as const, label: "Aprendizados" },
];

const PAGE_SIZE = 5;

const RISK_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  low: { bg: "var(--color-success-bg)", color: "var(--color-success)", label: "Baixo" },
  medium: { bg: "var(--color-warning-bg)", color: "var(--color-warning)", label: "Médio" },
  high: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Alto" },
};

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pending_review: { bg: "var(--color-warning-bg)", color: "var(--color-warning)", label: "Aguardando" },
  approved: { bg: "var(--color-success-bg)", color: "var(--color-success)", label: "Aprovada" },
  rejected: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Rejeitada" },
};

export function RevenueManagerPage({ me }: RevenueManagerPageProps) {
  const vm = useRevenueManagerPage(me);
  const [tab, setTab] = useState<Tab>("hypotheses");
  const [hypPage, setHypPage] = useState(1);
  const [obsPage, setObsPage] = useState(1);
  const [lessonPage, setLessonPage] = useState(1);

  const pendingCount = vm.hypotheses.filter(h => h.status === "pending_review").length;
  const approvedCount = vm.hypotheses.filter(h => h.status === "approved").length;
  const avgConversion = vm.observations.length > 0
    ? (vm.observations.reduce((s, o) => s + o.conversion_rate, 0) / vm.observations.length).toFixed(1)
    : "0.0";
  const lessonsCount = vm.lessons.length;

  const hypSlice = vm.hypotheses.slice((hypPage - 1) * PAGE_SIZE, hypPage * PAGE_SIZE);
  const obsSlice = vm.observations.slice((obsPage - 1) * PAGE_SIZE, obsPage * PAGE_SIZE);
  const lessonSlice = vm.lessons.slice((lessonPage - 1) * PAGE_SIZE, lessonPage * PAGE_SIZE);

  if (vm.loading) {
    return (
      <div className="page-container">
        <header className="page-head">
          <div>
            <span className="eyebrow">Inteligência IA</span>
            <h1>Otimização de Checkout</h1>
          </div>
        </header>
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Otimização de Checkout</h1>
          <p className="page-lead">
            A IA analisa seu checkout diariamente e sugere melhorias baseadas nos dados reais de abandono e conversão
          </p>
        </div>
      </header>

      {/* Explicação */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-brand-subtle)",
        border: "1px solid var(--color-brand-ring)",
        font: "13px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.65,
      }}>
        <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong>{" "}
        Todo dia a IA observa o funil de checkout (conversão, abandonos, objeções),
        gera sugestões de melhoria com estimativa de impacto, e cria testes A/B automaticamente quando você aprova.
        Após o teste terminar, o sistema registra o resultado e usa para gerar sugestões cada vez melhores.
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard label="Aguardando revisão" value={pendingCount} icon={<Lightbulb size={16} />} accent="var(--color-warning)" />
        <StatCard label="Testes ativos" value={approvedCount} icon={<Brain size={16} />} accent="var(--color-brand)" />
        <StatCard label="Conversão média" value={`${avgConversion}%`} icon={<TrendingUp size={16} />} accent="var(--color-success)" />
        <StatCard label="Aprendizados" value={lessonsCount} icon={<BookOpen size={16} />} />
      </div>

      {/* Tabs */}
      <TabBar tabs={TABS} activeTab={tab} onTabChange={(k) => setTab(k as Tab)} />

      {/* Sugestões */}
      {tab === "hypotheses" && (
        <DataPanel
          title="Sugestões de melhoria"
          page={hypPage}
          pageSize={PAGE_SIZE}
          total={vm.hypotheses.length}
          onPageChange={setHypPage}
          isEmpty={vm.hypotheses.length === 0}
          empty={{ icon: Lightbulb, title: "Nenhuma sugestão ainda", description: "Sugestões são geradas automaticamente a cada dia com base nos dados do seu checkout." }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {hypSlice.map((h, i) => {
              const risk = RISK_COLORS[h.risk_level] ?? RISK_COLORS.medium;
              const status = STATUS_COLORS[h.status] ?? STATUS_COLORS.pending_review;
              return (
                <div key={h.id} style={{ padding: "16px 20px", borderBottom: i < hypSlice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)", flex: 1 }}>{h.hypothesis_text}</span>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: risk.bg, color: risk.color }}>{risk.label}</span>
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: status.bg, color: status.color }}>{status.label}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>
                    <span>Impacto estimado: <strong style={{ color: "var(--color-brand)" }}>+{h.expected_lift_percent.toFixed(1)}%</strong></span>
                    <span>{new Date(h.created_at).toLocaleDateString("pt-BR")}</span>
                    {h.status === "pending_review" && (
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <button type="button" className="zyn-btn zyn-btn--primary" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => vm.approveHypothesis(h.id)} disabled={vm.approving.has(h.id)}>
                          Aprovar
                        </button>
                        <button type="button" style={{ fontSize: 11, padding: "4px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--color-text-muted)", cursor: "pointer" }} onClick={() => vm.rejectHypothesis(h.id, "Não relevante")} disabled={vm.approving.has(h.id)}>
                          Rejeitar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DataPanel>
      )}

      {/* Observações */}
      {tab === "observations" && (
        <DataPanel
          title="Análises diárias"
          page={obsPage}
          pageSize={PAGE_SIZE}
          total={vm.observations.length}
          onPageChange={setObsPage}
          isEmpty={vm.observations.length === 0}
          empty={{ icon: Eye, title: "Nenhuma análise registrada", description: "A IA analisa o checkout diariamente. Quando houver dados suficientes, as análises aparecerão aqui." }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                  <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Conversão</th>
                  <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Principal objeção</th>
                  <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Sessões</th>
                </tr>
              </thead>
              <tbody>
                {obsSlice.map((o, i) => (
                  <tr key={o.date} style={{ borderBottom: i < obsSlice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                    <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>{new Date(o.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</td>
                    <td style={{ padding: "12px 20px", font: "600 13px var(--font-data)", color: "var(--color-brand)" }}>{o.conversion_rate.toFixed(1)}%</td>
                    <td style={{ padding: "12px 20px", font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>{o.top_objection}</td>
                    <td style={{ padding: "12px 20px", font: "13px var(--font-data)", color: "var(--color-text-faint)", textAlign: "right" }}>{o.sessions_count.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>
      )}

      {/* Aprendizados */}
      {tab === "lessons" && (
        <DataPanel
          title="O que a IA aprendeu"
          page={lessonPage}
          pageSize={PAGE_SIZE}
          total={vm.lessons.length}
          onPageChange={setLessonPage}
          isEmpty={vm.lessons.length === 0}
          empty={{ icon: BookOpen, title: "Nenhum aprendizado ainda", description: "Após experimentos concluírem, a IA registra o que funcionou e usa para melhorar as próximas sugestões." }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {lessonSlice.map((l, i) => (
              <div key={l.experiment_id} style={{ padding: "16px 20px", borderBottom: i < lessonSlice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: "var(--color-success-bg)", color: "var(--color-success)" }}>
                    +{l.lift_percent.toFixed(1)}%
                  </span>
                  <span style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>{l.lesson}</span>
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>
                  Variante vencedora: <strong style={{ color: "var(--color-text-muted)" }}>{l.actual_winner}</strong> · {new Date(l.learned_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
            ))}
          </div>
        </DataPanel>
      )}
    </div>
  );
}
