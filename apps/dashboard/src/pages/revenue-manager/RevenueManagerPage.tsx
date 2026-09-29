import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import "./revenue-manager.css";
import { PageHeader } from "../../components/PageHeader.js";
import { openStrategyReview } from "./strategy-review.js";
import React, { useState } from "react";
import { Lightbulb, TrendingUp, Eye, BookOpen, Brain, ArrowRight } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { TabBar } from "../../components/TabBar.js";
import { StatCard } from "../overview/components/StatCard.js";
import { PageLoader } from "../../components/PageLoader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
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
  experiment_created: { bg: "var(--color-info-bg)", color: "var(--color-info)", label: "Teste criado" },
  experiment_failed: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Teste falhou" },
};

export function RevenueManagerPage({ me }: RevenueManagerPageProps) {
  const vm = useRevenueManagerPage(me);
  const [tab, setTab] = useState<Tab>("hypotheses");
  const [hypPage, setHypPage] = useState(1);
  const [obsPage, setObsPage] = useState(1);
  const [lessonPage, setLessonPage] = useState(1);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filteredHypotheses = vm.hypotheses.filter(h => (!statusFilter || h.status === statusFilter) && normalized(h.hypothesis_text).includes(normalized(search)));
  const currentHypPage = Math.min(hypPage, Math.max(1, Math.ceil(filteredHypotheses.length / PAGE_SIZE)));
  const currentObsPage = Math.min(obsPage, Math.max(1, Math.ceil(vm.observations.length / PAGE_SIZE)));
  const currentLessonPage = Math.min(lessonPage, Math.max(1, Math.ceil(vm.lessons.length / PAGE_SIZE)));
  const pendingCount = vm.hypotheses.filter(h => h.status === "pending_review").length;
  const approvedCount = vm.hypotheses.filter(h => h.status === "approved").length;
  const measuredConversions = vm.observations
    .map((observation) => observation.conversion_rate)
    .filter((rate): rate is number => rate !== null);
  const avgConversion = measuredConversions.length > 0
    ? (measuredConversions.reduce((sum, rate) => sum + rate, 0) / measuredConversions.length).toFixed(1)
    : "—";
  const lessonsCount = vm.lessons.length;

  const hypSlice = filteredHypotheses.slice((currentHypPage - 1) * PAGE_SIZE, currentHypPage * PAGE_SIZE);
  const obsSlice = vm.observations.slice((currentObsPage - 1) * PAGE_SIZE, currentObsPage * PAGE_SIZE);
  const lessonSlice = vm.lessons.slice((currentLessonPage - 1) * PAGE_SIZE, currentLessonPage * PAGE_SIZE);

  if (vm.loading) {
    return (
      <div className="page-container revenue-manager-page">
        <PageHeader title="Otimização com IA" />
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="page-container revenue-manager-page">
      <PageHeader title="Otimização com IA" description="Revise sugestões para sua loja e acompanhe os dados que fundamentam cada decisão." />

      <details className="revenue-manager-guide"><summary>Da sugestão ao resultado</summary><ol><li>Leia a proposta, as condições e a estimativa de impacto.</li><li>Revise como a estratégia será aplicada. As opções disponíveis aparecem na revisão.</li><li>Acompanhe a execução e a amostra antes de avaliar o resultado.</li></ol><p>Estimativas não garantem aumento de vendas. Os limites comerciais da loja continuam valendo.</p></details>

      {/* Kill-switch — ativar/desativar o motor autônomo */}
      {vm.errors.engine ? <EmptyState title="Configuração indisponível" description={vm.errors.engine} action={<Button variant="outline" onClick={vm.refresh}>Tentar novamente</Button>} /> : <section style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 20px", borderRadius: "var(--radius-md)",
        background: "var(--surface-2)", border: "1px solid var(--color-border)",
      }}>
        <ToggleSwitch
          id="autonomous-engine-toggle"
          checked={vm.engineEnabled}
          disabled={vm.engineSaving}
          onChange={() => void vm.toggleEngine()}
        />
        <label htmlFor="autonomous-engine-toggle" style={{ cursor: "pointer", flex: 1 }}>
          <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
            Geração de sugestões {vm.engineEnabled ? "ativada" : "desativada"}
          </div>
          <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>
            {vm.engineEnabled
              ? "A geração de novas sugestões está habilitada. Revise as condições antes de aprovar uma proposta."
              : "A IA não gera novas sugestões. Regras já ativas continuam valendo; você ainda pode criar regras manualmente."}
          </div>
        </label>
      </section>}
      {vm.actionError && <div className="revenue-manager-error" role="alert"><p>{vm.actionError}</p><Button variant="outline" onClick={vm.refresh}>Atualizar dados</Button></div>}

      {/* KPIs */}
      {!vm.errors.hypotheses && !vm.errors.observations && !vm.errors.lessons && <div className="grid-4" style={{ gap: 14 }}>
        <StatCard label="Aguardando revisão" value={pendingCount} icon={<Lightbulb size={16} />} accent="var(--color-warning)" />
        <StatCard label="Testes ativos" value={approvedCount} icon={<Brain size={16} />} accent="var(--color-brand)" />
        <StatCard label="Conversão média" value={`${avgConversion}%`} icon={<TrendingUp size={16} />} accent="var(--color-success)" />
        <StatCard label="Aprendizados" value={lessonsCount} icon={<BookOpen size={16} />} />
      </div>}

      {/* Tabs */}
      <TabBar tabs={TABS} activeTab={tab} onTabChange={(k) => setTab(k as Tab)} />

      {tab === "hypotheses" && <FilterToolbar tabs={[]} activeTab="" onTabChange={() => {}} search={search} onSearchChange={value => { setSearch(value); setHypPage(1); }} searchPlaceholder="Buscar sugestões" extra={<FilterSelect ariaLabel="Estado da sugestão" value={statusFilter} onChange={value => { setStatusFilter(value); setHypPage(1); }} placeholder="Todos os estados" options={Object.entries(STATUS_COLORS).map(([value,status]) => ({value,label:status.label}))} />} />}
      {/* Sugestões */}
      {tab === "hypotheses" && (
        <DataPanel
          title="Sugestões de melhoria"
          page={currentHypPage}
          pageSize={PAGE_SIZE}
          total={vm.errors.hypotheses ? 0 : filteredHypotheses.length}
          onPageChange={setHypPage}
          isEmpty={!vm.errors.hypotheses && filteredHypotheses.length === 0}
          empty={{ icon: Lightbulb, title: search || statusFilter ? "Nenhuma sugestão com estes filtros" : "Nenhuma sugestão ainda", description: search || statusFilter ? "Tente outro termo ou limpe os filtros." : "As propostas aparecerão conforme houver dados e a geração estiver habilitada.", action: search || statusFilter ? <Button variant="outline" onClick={() => { setSearch(""); setStatusFilter(""); setHypPage(1); }}>Limpar filtros</Button> : undefined }}
        >
          {vm.errors.hypotheses ? <EmptyState title="Sugestões indisponíveis" description={vm.errors.hypotheses} action={<Button variant="outline" onClick={vm.refresh}>Tentar novamente</Button>} /> : <ul className="revenue-manager-proposals">
            {hypSlice.map((h) => {
              const risk = RISK_COLORS[h.risk_level] ?? RISK_COLORS.medium;
              const status = STATUS_COLORS[h.status] ?? STATUS_COLORS.pending_review;
              return (
                <li key={h.id} className="revenue-manager-proposal" aria-labelledby={`proposal-${h.id}`}>
                  <div className="revenue-manager-proposal-content">
                    <h3 id={`proposal-${h.id}`}>{h.hypothesis_text}</h3>
                    {h.reasoning && <p className="revenue-manager-proposal-context">{h.reasoning}</p>}
                    <div className="revenue-manager-proposal-meta">
                      <span className={`revenue-manager-proposal-risk revenue-manager-proposal-risk--${h.risk_level}`}>Risco {risk.label.toLowerCase()}</span>
                      <time dateTime={h.created_at}>Criada em {new Date(h.created_at).toLocaleDateString("pt-BR")}</time>
                    </div>
                  </div>
                  <div className="revenue-manager-proposal-impact">
                    <span>Impacto estimado</span>
                    <strong className={h.expected_lift_percent < 0 ? "is-negative" : undefined}>{h.expected_lift_percent > 0 ? "+" : ""}{h.expected_lift_percent.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>
                    <small>A validar em teste</small>
                  </div>
                  <div className="revenue-manager-proposal-actions">
                    <span className="revenue-manager-proposal-status" style={{ background: status.bg, color: status.color }}>{status.label}</span>
                    <Button variant="outline" size="lg" onClick={() => openStrategyReview(h.id)} disabled={vm.approving.has(h.id)}>
                      {h.status === "pending_review" ? "Revisar sugestão" : "Ver detalhes"}<ArrowRight size={16} aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>}
        </DataPanel>
      )}

      {/* Observações */}
      {tab === "observations" && (
        <DataPanel
          title="Análises diárias"
          page={currentObsPage}
          pageSize={PAGE_SIZE}
          total={vm.observations.length}
          onPageChange={setObsPage}
          isEmpty={!vm.errors.observations && vm.observations.length === 0}
          empty={{ icon: Eye, title: "Nenhuma análise registrada", description: "A IA analisa o checkout diariamente. Quando houver dados suficientes, as análises aparecerão aqui." }}
        >
          {vm.errors.observations ? <EmptyState title="Observações indisponíveis" description={vm.errors.observations} action={<Button variant="outline" onClick={vm.refresh}>Tentar novamente</Button>} /> : <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                  <th style={{ textAlign: "left", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Conversão</th>
                  <th style={{ textAlign: "left", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Principal objeção</th>
                  <th style={{ textAlign: "right", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Sessões</th>
                </tr>
              </thead>
              <tbody>
                {obsSlice.map((o, i) => (
                  <tr key={o.date} style={{ borderBottom: i < obsSlice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                    <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>{new Date(o.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</td>
                    <td style={{ padding: "12px 20px", font: "600 13px var(--font-data)", color: "var(--color-brand)" }}>{o.conversion_rate === null ? "Dados insuficientes" : `${o.conversion_rate.toFixed(1)}%`}</td>
                    <td style={{ padding: "12px 20px", font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>{o.top_objection}</td>
                    <td style={{ padding: "12px 20px", font: "13px var(--font-data)", color: "var(--color-text-faint)", textAlign: "right" }}>{o.sessions_count.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </DataPanel>
      )}

      {/* Aprendizados */}
      {tab === "lessons" && (
        <DataPanel
          title="O que a IA aprendeu"
          page={currentLessonPage}
          pageSize={PAGE_SIZE}
          total={vm.lessons.length}
          onPageChange={setLessonPage}
          isEmpty={!vm.errors.lessons && vm.lessons.length === 0}
          empty={{ icon: BookOpen, title: "Nenhum aprendizado ainda", description: "Após experimentos concluírem, a IA registra o que funcionou e usa para melhorar as próximas sugestões." }}
        >
          {vm.errors.lessons ? <EmptyState title="Aprendizados indisponíveis" description={vm.errors.lessons} action={<Button variant="outline" onClick={vm.refresh}>Tentar novamente</Button>} /> : <div style={{ display: "flex", flexDirection: "column" }}>
            {lessonSlice.map((l, i) => (
              <div key={l.experiment_id} style={{ padding: "16px 20px", borderBottom: i < lessonSlice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 13px var(--font-sans)", background: l.lift_percent > 0 ? "var(--color-success-bg)" : "var(--surface-2)", color: l.lift_percent < 0 ? "var(--color-error)" : l.lift_percent > 0 ? "var(--color-success)" : "var(--color-text-muted)" }}>
                    {l.lift_percent > 0 ? "+" : ""}{l.lift_percent.toFixed(1)}%
                  </span>
                  <span style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>{l.lesson}</span>
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>
                  Variante vencedora: <strong style={{ color: "var(--color-text-muted)" }}>{l.actual_winner}</strong> · {new Date(l.learned_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
            ))}
          </div>}
        </DataPanel>
      )}
    </div>
  );
}
