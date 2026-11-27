import React, { useState, type ReactNode } from "react";
import { CalendarDays, Clock3, RefreshCw, Settings2, Tags, Users } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { PageHeader } from "../../components/PageHeader.js";
import { TabBar } from "../../components/TabBar.js";
import { FilterSelect } from "../../components/FilterToolbar.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { parseServiceAttendanceFilters, useServiceAttendancePage, type ServiceAttendanceFilters } from "./useServiceAttendancePage.js";
import { ServiceAttendancePanels } from "./ServiceAttendancePanels.js";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
export interface ServiceAttendancePageProps {
  me: MerchantProfile | null;
  renderPanel?: (tab: ServiceAttendanceFilters["tab"], viewModel: ViewModel) => ReactNode;
}
const tabs = [
  { key: "agenda", label: "Agenda", icon: <CalendarDays size={16} /> },
  { key: "professionals", label: "Profissionais", icon: <Users size={16} /> },
  { key: "categories", label: "Categorias", icon: <Tags size={16} /> },
  { key: "availability", label: "Disponibilidade", icon: <Clock3 size={16} /> },
  { key: "settings", label: "Configurações", icon: <Settings2 size={16} /> },
] as const;

export function ServiceAttendancePage({ me, renderPanel }: ServiceAttendancePageProps) {
  const vm = useServiceAttendancePage({ me });
  const [periodError, setPeriodError] = useState<string | null>(null);
  const header = <PageHeader title="Atendimento" description="Organize os profissionais, os serviços e os horários da sua empresa." />;
  if (!vm.allowed) return <div>{header}<EmptyState icon={CalendarDays} title="Atendimento indisponível para esta conta" description="A gestão de atendimento exige uma empresa de serviços e permissão de administração." /></div>;
  const data = vm.loadState.data;
  const loading = vm.loadState.status === "loading";
  const professionalOptions = [{ value: "", label: "Todos os profissionais" }, ...(data?.professionals.items ?? []).map(item => ({ value: item.id, label: item.publicName }))];
  if (vm.filters.professionalId && !professionalOptions.some(item => item.value === vm.filters.professionalId)) professionalOptions.push({ value: vm.filters.professionalId, label: "Profissional selecionado" });
  const categoryOptions = [{ value: "", label: "Todas as categorias" }, ...(data?.categories ?? []).map(item => ({ value: item.id, label: item.name }))];
  if (vm.filters.categoryId && !categoryOptions.some(item => item.value === vm.filters.categoryId)) categoryOptions.push({ value: vm.filters.categoryId, label: "Categoria selecionada" });
  const panelId = `service-attendance-${vm.filters.tab}`;
  return <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
    <PageHeader title="Atendimento" description="Organize os profissionais, os serviços e os horários da sua empresa."
      actions={<Button variant="outline" loading={loading} disabled={vm.command.status === "saving"} onClick={() => void vm.refresh()}><RefreshCw size={14} aria-hidden="true" /> Atualizar</Button>} />
    <TabBar label="Seções do atendimento" tabs={tabs.map(tab => ({ ...tab, panelId: `service-attendance-${tab.key}` }))}
      activeTab={vm.filters.tab} onTabChange={tab => vm.setFilters({ tab: tab as ServiceAttendanceFilters["tab"] })} />
    <fieldset style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
      <legend className="sr-only">Filtrar atendimento</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 6, flex: "1 1 210px", minWidth: 0 }}>Profissional
          <FilterSelect ariaLabel="Profissional" width="100%" value={vm.filters.professionalId} options={professionalOptions} onChange={professionalId => vm.setFilters({ professionalId })} />
        </label>
        <label style={{ display: "grid", gap: 6, flex: "1 1 210px", minWidth: 0 }}>Categoria
          <FilterSelect ariaLabel="Categoria" width="100%" value={vm.filters.categoryId} options={categoryOptions} onChange={categoryId => vm.setFilters({ categoryId })} />
        </label>
      </div>
    </fieldset>
    <form key={`${vm.filters.fromDate}/${vm.filters.toDate}`} aria-label="Período do atendimento" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget), fromDate = String(values.get("fromDate") ?? ""), toDate = String(values.get("toDate") ?? "");
      const period = parseServiceAttendanceFilters(`#service-attendance?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`);
      if (!period.fromDate || !period.toDate) { setPeriodError("Informe um período válido de até 31 dias."); return; }
      setPeriodError(null); vm.setFilters({ fromDate, toDate });
    }} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
      <label style={{ display: "grid", gap: 6, flex: "1 1 160px" }}>De<input className="form-input" name="fromDate" type="date" defaultValue={vm.filters.fromDate} required /></label>
      <label style={{ display: "grid", gap: 6, flex: "1 1 160px" }}>Até<input className="form-input" name="toDate" type="date" defaultValue={vm.filters.toDate} required /></label>
      <Button type="submit" variant="outline">Aplicar período</Button>
      {(vm.filters.fromDate || vm.filters.toDate) && <Button variant="ghost" onClick={() => { setPeriodError(null); vm.setFilters({ fromDate: "", toDate: "" }); }}>Limpar período</Button>}
    </form>
    {periodError && <p role="alert">{periodError}</p>}
    {vm.command.status === "conflict" && <p role="alert">Os dados foram alterados. Atualize a página e confira os valores antes de salvar novamente.</p>}
    {vm.command.status === "uncertain" && <p role="alert">Não foi possível confirmar o resultado. Atualize e confira o registro antes de tentar novamente.</p>}
    {vm.command.status === "error" && <p role="alert">Não foi possível salvar a alteração. Confira os dados e tente novamente.</p>}
    <section id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab`} tabIndex={0} aria-busy={loading} style={{ minWidth: 0, maxHeight: vm.filters.tab === "availability" ? "70dvh" : undefined, overflowY: vm.filters.tab === "availability" ? "auto" : undefined }}>
      {loading && <p role="status">{data ? "Atualizando atendimento…" : "Carregando atendimento…"}</p>}
      {vm.loadState.status === "error" && <EmptyState icon={CalendarDays} title="Não foi possível atualizar o atendimento"
        description="Atualize para consultar os dados da empresa." action={<Button variant="outline" onClick={() => void vm.refresh()}>Tentar novamente</Button>} />}
      {data && (renderPanel ? renderPanel(vm.filters.tab, vm) : me && <ServiceAttendancePanels tab={vm.filters.tab} vm={vm} me={me} />)}
    </section>
  </div>;
}
