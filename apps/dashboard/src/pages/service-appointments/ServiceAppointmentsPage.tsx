import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { PageHeader } from "../../components/PageHeader.js";
import { Button } from "../../components/Button.js";
import { FormField, FormSelect } from "../../components/FormField.js";
import { EmptyState } from "../../components/EmptyState.js";
import { canManageServiceAttendance, canAccessTab } from "../../lib/auth/permissions.js";
import { NAV_ITEMS, visibleItemsForPlan } from "../../shell/nav-config.js";
import { appointmentReadQuery } from "../../api/endpoints/service-appointments.js";
import { SESSION_EXPIRED_EVENT } from "../../api/http/client.js";
import { useServiceAttendancePage } from "../service-attendance/useServiceAttendancePage.js";
import { useProfessionalsPanelData } from "../service-attendance/components/useProfessionalsPanelData.js";
import { AppointmentViews } from "./AppointmentViews.js";
import { useServiceAppointments } from "./useServiceAppointments.js";
import { APPOINTMENT_COLUMNS } from "./appointment-board.js";
import { appointmentPageQuery, appointmentPageHash, currentBrasiliaDay, type AppointmentPageQuery } from "./service-appointments-filters.js";
import "./service-appointments-page.css";
const ManualAppointmentDrawer = lazy(() => import("../service-attendance/components/ManualAppointmentDrawer.js").then(module => ({ default: module.ManualAppointmentDrawer })));
const AppointmentDetailDrawer = lazy(() => import("../service-attendance/components/AppointmentDetailDrawer.js").then(module => ({ default: module.AppointmentDetailDrawer })));

export function ServiceAppointmentsPage({ me }: { me: MerchantProfile | null }) {
  if (!canManageServiceAttendance(me) || !me) return <div><PageHeader title="Agendamentos" description="Acompanhe os atendimentos da sua empresa." /><EmptyState icon={CalendarDays} title="Agendamentos indisponíveis para esta conta" description="Esta área exige uma empresa de serviços e permissão de administração." /></div>;
  return <ManagedAppointments key={JSON.stringify([me.id, me.user_id, me.role, me.businessMode, me.businessModeSelectionState])} me={me} />;
}
function ManagedAppointments({ me }: { me: MerchantProfile }) {
  const [query, setQuery] = useState(() => appointmentPageQuery(window.location.hash, currentBrasiliaDay()));
  const [draft, setDraft] = useState<AppointmentPageQuery>(() => query ?? { fromDate: "", toDate: "" });
  const [filterError, setFilterError] = useState<string | null>(null);
  const vm = useServiceAttendancePage({ me }), metadata = useProfessionalsPanelData(me, vm);
  const list = useServiceAppointments({ me, query: query ?? { fromDate: "", toDate: "" } });
  const [selectedId, select] = useState<string | null>(null), [detailOpen, openDetail] = useState(false), [manualOpen, openManual] = useState(false), [manualMounted, mountManual] = useState(false);
  const expired = useRef(false);
  useEffect(() => {
    const onHash = () => { if (window.location.hash.split("?")[0] !== "#service-appointments") return; const value = appointmentPageQuery(window.location.hash, currentBrasiliaDay()); setQuery(value); setDraft(value ?? { fromDate: "", toDate: "" }); setFilterError(null); };
    const onExpired = () => { expired.current = true; };
    window.addEventListener("hashchange", onHash); window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired); };
  }, []);
  const historyAllowed = canAccessTab(me.role, "shipments") && visibleItemsForPlan(NAV_ITEMS.filter(item => item.key === "shipments"), me.plan ?? "BOTH").length > 0;
  const professionalOptions = [{ value: "", label: "Todos os profissionais" }, ...metadata.rows.map(row => ({ value: row.id, label: row.publicName }))];
  if (draft.professionalId && !professionalOptions.some(row => row.value === draft.professionalId)) professionalOptions.push({ value: draft.professionalId, label: "Profissional selecionado" });
  const serviceOptions = [{ value: "", label: "Todos os serviços" }, ...metadata.services.map(row => ({ value: row.id, label: row.name }))];
  if (draft.productId && !serviceOptions.some(row => row.value === draft.productId)) serviceOptions.push({ value: draft.productId, label: "Serviço selecionado" });
  const categoryOptions = [{ value: "", label: "Todas as categorias" }, ...(vm.loadState.data?.categories ?? []).map(row => ({ value: row.id, label: row.name }))];
  if (draft.categoryId && !categoryOptions.some(row => row.value === draft.categoryId)) categoryOptions.push({ value: draft.categoryId, label: "Categoria selecionada" });
  const busy = list.status === "loading", blocked = list.status === "forbidden" || list.status === "unauthorized" || list.issue === "forbidden" || list.issue === "unauthorized";
  const manualVm = { ...vm, filters: { ...vm.filters, fromDate: query?.fromDate ?? "", toDate: query?.toDate ?? "" } };
  if (blocked) return <div><PageHeader title="Agendamentos" /><EmptyState icon={CalendarDays} title={list.status === "unauthorized" || list.issue === "unauthorized" ? "Sessão expirada" : "Acesso aos agendamentos indisponível"} description="Entre novamente e confira sua permissão para acessar os dados da empresa." /></div>;
  return <div className="service-appointments-page">
    <PageHeader title="Agendamentos" description="Veja a agenda por etapa e acompanhe cada atendimento e seu pagamento."
      actions={<><Button variant="outline" disabled={busy} onClick={() => void list.refresh()}><RefreshCw size={14} aria-hidden="true" /> Atualizar</Button><Button disabled={vm.loadState.status === "loading"} onClick={() => { if (!expired.current) { mountManual(true); openManual(true); } }}>Novo agendamento</Button></>} />
    <div className="service-appointments-page__context"><span>Horário de Brasília</span><div><a href="#service-attendance">Configurar atendimento</a>{historyAllowed && <a href="#shipments">Histórico de pedidos</a>}</div></div>
    <form className="service-appointments-page__filters" aria-label="Filtros de agendamentos" onSubmit={event => { event.preventDefault(); if (expired.current) return;
      try { const value = appointmentReadQuery({ ...draft, cursor: undefined }); setQuery(value); setFilterError(null); window.history.pushState(null, "", appointmentPageHash(value)); }
      catch { setFilterError("Informe datas válidas em um período de até 31 dias e uma etapa de atendimento disponível."); }
    }}>
      <FormField label="De" type="date" value={draft.fromDate} onChange={fromDate => setDraft(value => ({ ...value, fromDate }))} />
      <FormField label="Até" type="date" value={draft.toDate} onChange={toDate => setDraft(value => ({ ...value, toDate }))} />
      <FormSelect label="Profissional" value={draft.professionalId ?? ""} options={professionalOptions} onChange={professionalId => setDraft(value => ({ ...value, professionalId: professionalId || undefined }))} />
      <FormSelect label="Serviço" value={draft.productId ?? ""} options={serviceOptions} onChange={productId => setDraft(value => ({ ...value, productId: productId || undefined }))} />
      <FormSelect label="Categoria" value={draft.categoryId ?? ""} options={categoryOptions} onChange={categoryId => setDraft(value => ({ ...value, categoryId: categoryId || undefined }))} />
      <FormSelect label="Etapa do atendimento" value={draft.status ?? ""} options={[{ value: "", label: "Todas as etapas" }, ...APPOINTMENT_COLUMNS.map(row => ({ value: row.status, label: row.label }))]} onChange={status => setDraft(value => ({ ...value, status: status ? status as AppointmentPageQuery["status"] : undefined }))} />
      <Button type="submit" variant="outline" disabled={busy}>Aplicar filtros</Button>
    </form>
    {metadata.nextCursor && <Button variant="ghost" disabled={metadata.listLoading} onClick={() => { if (!expired.current) void metadata.loadMoreProfessionals(); }}>Carregar mais profissionais para filtrar</Button>}
    <div><Button variant="ghost" disabled={metadata.catalogPhase === "loading" || metadata.catalogPhase === "ready" && !metadata.catalogHasMore} onClick={() => { if (!expired.current) void metadata.loadCatalog(metadata.catalogPhase === "error"); }}>{metadata.catalogHasMore ? "Carregar mais serviços para filtrar" : metadata.catalogPhase === "ready" ? "Serviços consultados" : "Consultar serviços para filtrar"}</Button></div>
    {metadata.catalogError && <p role="alert">Não foi possível consultar os serviços. Tente novamente para conferir as opções do filtro.</p>}
    {filterError && <p role="alert">{filterError}</p>}
    {list.status === "invalid" && <p role="alert">Os filtros deste endereço são inválidos. Informe um período válido para consultar a agenda.</p>}
    {busy && <p role="status">{list.snapshot ? "Atualizando agendamentos…" : "Consultando agendamentos…"}</p>}
    {list.status === "error" && <p role="alert">Não foi possível atualizar a agenda. Os dados anteriores permanecem visíveis; atualize antes de realizar outra ação.</p>}
    {list.snapshot && <AppointmentViews snapshot={list.snapshot} busy={busy || list.status !== "ready"} onOpen={id => { if (!expired.current && list.status === "ready") { select(id); openDetail(true); } }} onFirstPage={() => void list.firstPage()} onNextPage={() => void list.nextPage()} />}
    <Suspense fallback={<p role="status">Carregando detalhes…</p>}>{selectedId && <AppointmentDetailDrawer me={me} vm={vm} appointmentId={selectedId} open={detailOpen} onClose={() => openDetail(false)} onChanged={() => { void list.refresh(); }} />}</Suspense>
    <Suspense fallback={<p role="status">Carregando formulário…</p>}>{manualMounted && <ManualAppointmentDrawer me={me} vm={manualVm} open={manualOpen} onClose={() => { openManual(false); void list.refresh(); }} />}</Suspense>
  </div>;
}
