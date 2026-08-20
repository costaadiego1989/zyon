import React from "react";
import { Plus, FlaskConical, Play, Pause, Archive } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { SearchInput } from "../../components/SearchInput.js";
import { useExperimentsPage } from "./hooks/useExperimentsPage.js";
import { ExperimentCard } from "./components/ExperimentCard.js";
import { ExperimentDetail } from "./components/ExperimentDetail.js";
import { ExperimentForm } from "./components/ExperimentForm.js";

export interface ExperimentsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const STATUS_COUNTS_STYLE: React.CSSProperties = {
  display: "flex", gap: 6, font: "600 11px var(--mono)",
};

const FILTER_CHIP: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 20,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  font: "500 11px var(--sans)",
  cursor: "pointer",
  transition: "all 0.15s",
};

const FILTER_CHIP_ACTIVE: React.CSSProperties = {
  ...FILTER_CHIP,
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#fff",
};

export function ExperimentsPage(props: ExperimentsPageProps) {
  const vm = useExperimentsPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Testes A/B</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  const statusCounts = {
    all: vm.experiments.length,
    draft: vm.experiments.filter(e => e.status === "draft").length,
    running: vm.experiments.filter(e => e.status === "running").length,
    completed: vm.experiments.filter(e => e.status === "completed").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="eyebrow">AGENTE IA</span>
          <h1>Testes A/B</h1>
          <p className="page-lead">Compare estratégias de abordagem e meça conversão</p>
        </div>
        <Button variant="primary" size="sm" arrow onClick={vm.openCreateForm}>
          <Plus size={14} /> Novo Teste
        </Button>
      </div>

      {/* Content */}
      {vm.loading ? (
        <div className="panel" style={{ padding: "60px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>
          Carregando experimentos...
        </div>
      ) : vm.experiments.length === 0 ? (
        <div className="panel" style={{ padding: "60px 24px" }}>
          <EmptyState
            icon={FlaskConical}
            title="Nenhum teste criado"
            description="Testes A/B permitem comparar como diferentes estratégias de comunicação do agente impactam suas vendas"
            action={<Button size="sm" onClick={vm.openCreateForm}><Plus size={12} /> Criar primeiro teste</Button>}
          />
        </div>
      ) : (
        <>
          {/* Master-Detail Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20, alignItems: "start" }}>
            {/* Left Column: Filters + List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Search */}
              <SearchInput value={vm.searchText} onChange={vm.setSearchText} placeholder="Buscar testes..." />

              {/* Filter Chips */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(["all", "draft", "running", "completed"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => vm.setFilterStatus(s)}
                    style={vm.filterStatus === s ? FILTER_CHIP_ACTIVE : FILTER_CHIP}
                  >
                    {s === "all" ? "Todos" : s === "draft" ? "Rascunho" : s === "running" ? "Ativo" : "Concluído"}
                    <span style={{ marginLeft: 4, opacity: 0.7 }}>{statusCounts[s]}</span>
                  </button>
                ))}
              </div>

              {/* Experiment List */}
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: "calc(100vh - 300px)",
                overflowY: "auto",
                paddingRight: 4,
              }}>
                {vm.experiments.map((exp) => (
                  <ExperimentCard
                    key={exp.id}
                    experiment={exp}
                    selected={vm.selectedId === exp.id}
                    onSelect={() => vm.setSelectedId(vm.selectedId === exp.id ? null : exp.id)}
                  />
                ))}
              </div>
            </div>

            {/* Right Column: Detail Panel */}
            <div style={{ position: "sticky", top: 20 }}>
              {vm.selectedId && vm.selectedExperiment ? (
                <ExperimentDetail
                  experiment={vm.selectedExperiment}
                  results={vm.selectedResults}
                  loading={vm.resultsLoading}
                  saving={vm.saving}
                  onStart={() => vm.handleStartExperiment(vm.selectedId!)}
                  onStop={() => vm.handleStopExperiment(vm.selectedId!)}
                  onPromote={(variantId) => vm.handlePromoteVariant(vm.selectedId!, variantId)}
                  onArchive={() => vm.handleArchiveExperiment(vm.selectedId!)}
                />
              ) : (
                <div style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: "48px 24px",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                }}>
                  <FlaskConical size={32} style={{ color: "var(--muted)", opacity: 0.4 }} />
                  <p style={{ font: "13px var(--sans)", color: "var(--muted)", margin: 0 }}>
                    Selecione um teste ao lado para ver detalhes e métricas
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Create/Edit Drawer */}
      {vm.formMode && (
        <ExperimentForm
          form={vm.form}
          errors={vm.errors}
          loading={vm.saving}
          onClose={vm.closeForm}
          onSave={vm.handleCreateExperiment}
          patch={vm.patch}
          addVariant={vm.addVariant}
          removeVariant={vm.removeVariant}
          updateVariant={vm.updateVariant}
        />
      )}
    </div>
  );
}
