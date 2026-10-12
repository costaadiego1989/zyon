import React from "react";
import { Plus, Zap } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { SearchInput } from "../../components/SearchInput.js";
import { FilterSelect } from "../../components/FilterToolbar.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useExperimentsPage } from "./hooks/useExperimentsPage.js";
import { ExperimentCard } from "./components/ExperimentCard.js";
import { ExperimentDetail } from "./components/ExperimentDetail.js";
import { ExperimentForm } from "./components/ExperimentForm.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import "./experiments.css";
export interface ExperimentsPageProps { apiBaseUrl: string; me: MerchantProfile | null; }
const STATUSES = [{ value: "all", label: "Todos os status" }, { value: "draft", label: "Rascunhos" }, { value: "running", label: "Em execução" }, { value: "paused", label: "Pausados" }, { value: "completed", label: "Concluídos" }, { value: "archived", label: "Arquivados" }];
export function ExperimentsPage(props: ExperimentsPageProps) {
  const vm = useExperimentsPage({ me: props.me });
  if (!props.me) return <PageHeader title="Testes A/B" description="Faça login para acompanhar seus testes." />;
  return <div className="page-container experiments-page">
    <PageHeader title="Testes A/B" description="Compare versões das instruções do agente e acompanhe os resultados."
      actions={<Button onClick={vm.openCreateForm} disabled={vm.saving}><Plus size={16} /> Novo teste</Button>} />
    <SetupGuide title="Como comparar duas versões" steps={[
      { title: "Defina uma mudança", description: "Descreva o comportamento de referência e a nova abordagem." },
      { title: "Revise antes de iniciar", description: "Confira os textos e a divisão do público. Crie o teste e inicie quando estiver pronto." },
      { title: "Acompanhe os resultados", description: "Considere a amostra e a confiança. Uma diferença inicial ainda pode ser inconclusiva." },
    ]} />
    <section className="experiments-automation">
      <div className="experiment-section-heading"><div><label htmlFor="experiments-auto">Testes automáticos</label><p>A otimização com IA cria testes a partir de hipóteses aprovadas.</p></div>
        <ToggleSwitch id="experiments-auto" checked={vm.autoLoaded && vm.autoEnabled} disabled={vm.autoToggleBusy || !vm.autoLoaded} onChange={vm.handleToggleAuto} /></div>
      {vm.autoError ? <p role="alert">Não foi possível consultar a automação. <Button size="sm" variant="ghost" onClick={vm.reloadAuto}>Tentar novamente</Button></p> :
        <p>{vm.autoLoaded ? "A promoção automática segue os critérios da plataforma. Confira a confiança e o estado de cada teste." : "Consultando o estado da automação…"}</p>}
    </section>
    {vm.loading ? <div className="panel" role="status" style={{ padding: 24 }}>Carregando testes…</div> : vm.loadError ?
      <EmptyState title="Testes indisponíveis" description={vm.loadError} action={<Button variant="outline" onClick={vm.reload}>Tentar novamente</Button>} /> : vm.allExperiments.length === 0 ?
      <EmptyState icon={Zap} title="Crie seu primeiro teste" description="Compare a abordagem atual com uma nova instrução. Comece por uma mudança que seja fácil de avaliar." action={<Button onClick={vm.openCreateForm}><Plus size={16} /> Criar teste</Button>} /> :
      <div className="experiments-workspace">
        <section className="experiments-list" aria-label="Lista de testes">
          <div className="experiments-filters">
            <SearchInput value={vm.searchText} onChange={vm.setSearchText} placeholder="Buscar testes" width="100%" />
            <FilterSelect ariaLabel="Status dos testes" width="100%" value={vm.filterStatus} onChange={status => vm.setFilterStatus(status as typeof vm.filterStatus)} options={STATUSES} />
          </div>
          <p className="experiments-count" role="status">{vm.experiments.length} {vm.experiments.length === 1 ? "teste encontrado" : "testes encontrados"}</p>
          {vm.experiments.length === 0 ? <EmptyState title="Nenhum teste com estes filtros" description="Busque outro nome ou remova os filtros." action={<Button variant="outline" onClick={() => { vm.setSearchText(''); vm.setFilterStatus('all'); }}>Limpar filtros</Button>} /> :
            <div className="experiments-items">{vm.experiments.map(exp => <ExperimentCard key={exp.id} experiment={exp} metrics={vm.selectedResults?.experiment_id === exp.id ? vm.selectedResults.metrics : exp.metrics} selected={vm.selectedId === exp.id} onSelect={() => vm.setSelectedId(exp.id)} />)}</div>}
        </section>
        <section className="experiments-detail" aria-label="Detalhes do teste">
          {vm.selectedExperiment && vm.experiments.some(exp => exp.id === vm.selectedId) ? <ExperimentDetail experiment={vm.selectedExperiment} results={vm.selectedResults} loading={vm.resultsLoading} saving={vm.saving}
            resultsError={vm.resultsError} onRetryResults={vm.reloadResults}
            onStart={() => vm.handleStartExperiment(vm.selectedId!)} onStop={() => vm.handleStopExperiment(vm.selectedId!)}
            onPromote={variantId => vm.handlePromoteVariant(vm.selectedId!, variantId)} onArchive={() => vm.requestArchive(vm.selectedId!)} /> :
            <EmptyState icon={Zap} title="Selecione um teste" description="Escolha um item da lista para consultar versões, resultados e próximas ações." />}
        </section>
      </div>}
    {vm.formMode && <ExperimentForm form={vm.form} errors={vm.errors} loading={vm.saving} saveError={vm.formError}
      onClose={vm.closeForm} onSave={vm.handleCreateExperiment} patch={vm.patch} addVariant={vm.addVariant} removeVariant={vm.removeVariant}
      updateVariant={vm.updateVariant} onGenerateVariants={vm.handleGenerateVariants} generatingVariants={vm.generatingVariants} />}
    <ConfirmDialog open={vm.archiveConfirmId !== null} title="Arquivar teste?" description="O teste será movido para Arquivados. Arquivar um rascunho não inicia o teste."
      confirmLabel="Arquivar teste" variant="danger" busy={vm.saving} error={vm.archiveError} onConfirm={vm.confirmArchive} onCancel={vm.cancelArchive} />
  </div>;
}
