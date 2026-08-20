import React from "react";
import { Plus } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { SearchInput } from "../../components/SearchInput.js";
import { useExperimentsPage } from "./hooks/useExperimentsPage.js";
import { ExperimentCard } from "./components/ExperimentCard.js";
import { ExperimentDetail } from "./components/ExperimentDetail.js";
import { ExperimentForm } from "./components/ExperimentForm.js";
import type { Experiment } from "./types.js";

export interface ExperimentsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

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

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <span className="eyebrow">CONFIGURAÇÃO</span>
          <h1>Testes A/B</h1>
          <p className="page-lead">Experimente variações de ofertas e mensagens</p>
        </div>
        <Button variant="primary" size="sm" arrow onClick={vm.openCreateForm}>
          <Plus size={14} /> Novo Teste
        </Button>
      </div>

      {/* List */}
      {vm.loading ? (
        <div className="panel" style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)" }}>Carregando testes...</div>
      ) : vm.experiments.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="Nenhum teste A/B"
            description="Crie seu primeiro teste para começar a experimentar"
            action={<Button size="sm" onClick={vm.openCreateForm}>Criar Teste</Button>}
          />
        </div>
      ) : (
        <div className="panel" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <SearchInput value={vm.searchText} onChange={vm.setSearchText} placeholder="Buscar testes..." />
            <select
              value={vm.filterStatus}
              onChange={(e) => vm.setFilterStatus(e.target.value as any)}
              style={{
                padding: "7px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--ink)",
                font: "12px var(--sans)",
                minWidth: 120,
              }}
            >
              <option value="all">Todos</option>
              <option value="draft">Rascunho</option>
              <option value="running">Em Execução</option>
              <option value="completed">Concluído</option>
            </select>
            <select
              value={vm.sortBy}
              onChange={(e) => vm.setSortBy(e.target.value as any)}
              style={{
                padding: "7px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--ink)",
                font: "12px var(--sans)",
                minWidth: 120,
              }}
            >
              <option value="created">Mais Recentes</option>
              <option value="name">Nome A-Z</option>
              <option value="status">Status</option>
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
            {/* List Column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {vm.experiments.map((exp) => (
                <ExperimentCard
                  key={exp.id}
                  experiment={exp}
                  selected={vm.selectedId === exp.id}
                  onSelect={() => vm.setSelectedId(vm.selectedId === exp.id ? null : exp.id)}
                />
              ))}
            </div>

            {/* Detail Column */}
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
              <div
                style={{
                  background: "var(--card)",
                  border: "1px dashed var(--border)",
                  borderRadius: 14,
                  padding: 24,
                  textAlign: "center",
                  color: "var(--muted)",
                }}
              >
                <p>Selecione um teste para ver detalhes</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
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
