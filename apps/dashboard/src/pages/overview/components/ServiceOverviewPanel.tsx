import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, RefreshCw, Wallet } from "lucide-react";
import type { ServiceMetricsMoney, ServiceMetricsSummary } from "@zyon/shared-types";
import type { MerchantProfile } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import { PageHeader } from "../../../components/PageHeader.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { Button } from "../../../components/Button.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { FormField, FormSelect } from "../../../components/FormField.js";
import { validateServiceMetricsQuery, type ServiceMetricsQuery } from "../../../api/endpoints/service-metrics.js";
import type { ServiceCategoryDTO, ServiceProfessionalDTO, ServiceProfessionalPage } from "../../../api/endpoints/service-attendance.js";
import { useServiceOverview } from "../useServiceOverview.js";
import "./service-overview-panel.css";

const zone = "America/Sao_Paulo";
const civilFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
const asOfDate = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric" });
const asOfTime = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
const dateLabel = (value: string) => value.split("-").reverse().join("/");
export function defaultServiceOverviewQuery(now = new Date()): ServiceMetricsQuery {
  const parts = civilFormatter.formatToParts(now), part = (name: string) => parts.find(item => item.type === name)!.value;
  const toDate = `${part("year")}-${part("month")}-${part("day")}`;
  return { fromDate: new Date(Date.parse(toDate + "T12:00:00Z") - 6 * 86_400_000).toISOString().slice(0, 10), toDate };
}
interface Props { me: MerchantProfile | null; initialQuery?: ServiceMetricsQuery }
interface Options {
  status: "loading" | "ready" | "error";
  professionals: ServiceProfessionalDTO[]; categories: ServiceCategoryDTO[]; nextCursor: string | null;
  loadingMore: boolean; moreError: boolean;
}

/** Separate keyed child: blocked scopes never mount data hooks or lookups. */
export function ServiceOverviewPanel({ me, initialQuery }: Props) {
  if (!me || !canManageServiceAttendance(me)) return <EmptyState icon={CalendarDays} title="Visão geral de serviços indisponível"
    description="Esta visão é exclusiva de empresas de serviços e está disponível para o proprietário ou administrador." />;
  return <PrivateServiceOverview key={JSON.stringify([me.id, me.user_id, me.role, me.businessMode, me.businessModeSelectionState])}
    me={me} initialQuery={initialQuery} />;
}

function PrivateServiceOverview({ me, initialQuery }: { me: MerchantProfile; initialQuery?: ServiceMetricsQuery }) {
  const api = useApi();
  const client = useMemo(() => api.serviceAttendance({ id: me.id, user_id: me.user_id }), [api, me.id, me.user_id]);
  const [query, setQuery] = useState<ServiceMetricsQuery>(() => ({ ...(initialQuery ?? defaultServiceOverviewQuery()) }));
  const [draft, setDraft] = useState(() => ({ fromDate: query.fromDate, toDate: query.toDate,
    professionalId: query.professionalId ?? "", categoryId: query.categoryId ?? "" }));
  const [filterError, setFilterError] = useState("");
  const vm = useServiceOverview({ me, query });
  const [options, setOptions] = useState<Options>({ status: "loading", professionals: [], categories: [], nextCursor: null, loadingMore: false, moreError: false });
  const latest = useRef(options); latest.current = options;
  const alive = useRef(true), optionEpoch = useRef(0), optionRead = useRef<AbortController | null>(null);
  const optionsAllowed = useRef(true);
  optionsAllowed.current = vm.status !== "unauthorized" && vm.status !== "forbidden";
  const loadOptions = useCallback(async (more = false) => {
    if (!optionsAllowed.current) return;
    const previous = latest.current;
    if (more && (!previous.nextCursor || previous.loadingMore)) return;
    const epoch = ++optionEpoch.current;
    optionRead.current?.abort(); const controller = new AbortController(); optionRead.current = controller;
    setOptions(current => ({ ...current, status: more ? current.status : "loading", loadingMore: more, moreError: false }));
    try {
      const [page, categories]: [ServiceProfessionalPage, ServiceCategoryDTO[]] = more
        ? [await client.listProfessionals({ limit: 100, cursor: previous.nextCursor! }, { signal: controller.signal }), previous.categories]
        : await Promise.all([client.listProfessionals({ limit: 100 }, { signal: controller.signal }), client.listCategories({ signal: controller.signal })]);
      if (!alive.current || !optionsAllowed.current || epoch !== optionEpoch.current) return;
      const professionals = [...new Map([...(more ? previous.professionals : []), ...page.items].map(item => [item.id, item])).values()];
      setOptions({ status: "ready", professionals, categories, nextCursor: page.nextCursor, loadingMore: false, moreError: false });
    } catch {
      if (!alive.current || !optionsAllowed.current || epoch !== optionEpoch.current) return;
      setOptions({ ...previous, status: more ? previous.status : "error", loadingMore: false, moreError: more });
    }
  }, [client]);
  useEffect(() => {
    alive.current = true; void loadOptions();
    return () => { alive.current = false; optionEpoch.current++; optionRead.current?.abort(); };
  }, [loadOptions]);
  useEffect(() => {
    if (vm.status !== "unauthorized" && vm.status !== "forbidden") return;
    optionEpoch.current++; optionRead.current?.abort();
    setOptions({ status: "error", professionals: [], categories: [], nextCursor: null, loadingMore: false, moreError: false });
  }, [vm.status]);
  const changed = draft.fromDate !== query.fromDate || draft.toDate !== query.toDate
    || draft.professionalId !== (query.professionalId ?? "") || draft.categoryId !== (query.categoryId ?? "");
  function apply(event: React.FormEvent) {
    event.preventDefault();
    try {
      const next = validateServiceMetricsQuery({ fromDate: draft.fromDate, toDate: draft.toDate,
        ...(draft.professionalId ? { professionalId: draft.professionalId } : {}), ...(draft.categoryId ? { categoryId: draft.categoryId } : {}) });
      setFilterError("");
      if (JSON.stringify(next) === JSON.stringify(query)) void vm.refresh(); else setQuery(next);
    } catch { setFilterError("Escolha um período válido de até 31 dias, com início anterior ou igual ao fim."); }
  }
  const selectedProfessional = draft.professionalId && !options.professionals.some(item => item.id === draft.professionalId)
    ? [{ value: draft.professionalId, label: "Profissional selecionado (nome indisponível)" }] : [];
  const selectedCategory = draft.categoryId && !options.categories.some(item => item.id === draft.categoryId)
    ? [{ value: draft.categoryId, label: "Categoria selecionada (nome indisponível)" }] : [];
  const metrics = vm.data?.metrics;
  const empty = vm.status === "complete" && metrics && Object.values(metrics.byStatus).every(value => value === 0)
    && metrics.occupancy.knownOccupiedMinutes === 0
    && metrics.valuesByCurrency.every(row => [row.scheduled, row.receivable, row.received, row.refunds].every(value => value.amountCents === 0));
  const status = empty ? "empty" : vm.status;
  if (vm.status === "unauthorized" || vm.status === "forbidden") return <EmptyState title="Acesso aos indicadores indisponível"
    description="Confira sua sessão e as permissões de atendimento." />;
  return <div className="service-overview" data-service-overview data-state={status}>
    <PageHeader title="Visão geral dos serviços" description={<>{me.name} · Agenda, capacidade e valores do seu negócio.</>}
      actions={<Button variant="outline" loading={vm.loading} onClick={() => void vm.refresh()}>
        {!vm.loading && <RefreshCw size={15} aria-hidden="true" />}Atualizar indicadores</Button>} />
    <form className="service-overview-filters" aria-label="Filtros da visão geral" onSubmit={apply} noValidate>
      <div className="service-overview-filter-fields">
        <FormField label="Data inicial" type="date" value={draft.fromDate} onChange={value => setDraft(current => ({ ...current, fromDate: value }))} />
        <FormField label="Data final" type="date" value={draft.toDate} onChange={value => setDraft(current => ({ ...current, toDate: value }))} />
        <FormSelect label="Profissional" value={draft.professionalId} disabled={options.status !== "ready"}
          onChange={value => setDraft(current => ({ ...current, professionalId: value }))}
          options={[{ value: "", label: "Todos os profissionais" }, ...selectedProfessional,
            ...options.professionals.map(item => ({ value: item.id, label: item.publicName + (item.isActive === false ? " (inativo)" : "") }))]} />
        <FormSelect label="Categoria de serviço" value={draft.categoryId} disabled={options.status !== "ready"}
          onChange={value => setDraft(current => ({ ...current, categoryId: value }))}
          options={[{ value: "", label: "Todas as categorias" }, ...selectedCategory,
            ...options.categories.map(item => ({ value: item.id, label: item.name + (item.is_active === false ? " (inativa)" : "") }))]} />
      </div>
      <div className="service-overview-filter-actions"><p>Datas e horários de Brasília · até 31 dias.</p>
        <div><Button variant="ghost" disabled={!draft.professionalId && !draft.categoryId} onClick={() => setDraft(current => ({ ...current, professionalId: "", categoryId: "" }))}>Limpar seleção</Button>
          <Button type="submit">Aplicar filtros</Button></div></div>
      {changed && !filterError && <p className="service-overview-help" role="status">Filtros alterados. Aplique para atualizar os indicadores.</p>}
      {filterError && <p className="service-overview-filter-error" role="alert" data-service-filter-error>{filterError}</p>}
      {options.status === "loading" && <p className="service-overview-help" role="status">Carregando profissionais e categorias…</p>}
      {options.status === "error" && <div className="service-overview-option-feedback" role="status"><p>Não foi possível carregar os filtros de equipe.</p>
        <Button variant="outline" size="sm" onClick={() => void loadOptions()}>Recarregar filtros</Button></div>}
      {options.status === "ready" && options.nextCursor && <div className="service-overview-option-feedback"><p>Há mais profissionais disponíveis para filtrar.</p>
        <Button variant="ghost" size="sm" loading={options.loadingMore} onClick={() => void loadOptions(true)}>Carregar mais profissionais</Button>
        {options.moreError && <p role="status">Não foi possível carregar os próximos profissionais. Tente novamente.</p>}</div>}
    </form>
    {vm.loading ? <Loading /> : vm.status === "error" ? <EmptyState title="Não foi possível carregar os indicadores" description="Tente novamente para conferir as informações deste período."
      action={<Button variant="outline" onClick={() => void vm.refresh()}>Tentar novamente</Button>} />
      : vm.status === "unavailable" ? <EmptyState title="Indicadores temporariamente indisponíveis" description="Atualize a consulta para conferir as informações do período."
        action={<Button variant="outline" onClick={() => void vm.refresh()}>Tentar novamente</Button>} />
        : vm.status === "invalid" ? <EmptyState title="Confira o período dos filtros" description="Selecione um período válido de até 31 dias e aplique os filtros." />
          : metrics && vm.data ? <>
              <div className="service-overview-position"><span><CalendarDays size={15} aria-hidden="true" />Agenda de {dateLabel(vm.data.period.fromDate)} a {dateLabel(vm.data.period.toDate)}</span>
                <span data-service-as-of>{vm.data.asOf && <>Posição em {asOfDate.format(new Date(vm.data.asOf))} às {asOfTime.format(new Date(vm.data.asOf))} · Brasília</>}</span></div>
              {vm.status === "partial" && <div className="service-overview-partial" role="status">Alguns valores aguardam confirmação. Os valores já conhecidos aparecem identificados.</div>}
              {empty && <EmptyState title="Sem movimentação neste período" description="Ajuste as datas ou a seleção para consultar outra parte da sua agenda. Os novos agendamentos e pagamentos aparecerão aqui." />}
              <div className="service-overview-main"><Agenda metrics={metrics} /><Capacity value={metrics.occupancy} /></div>
              <section className="panel service-overview-financial"><SectionHeader icon={Wallet} title="Valores do período"
                subtitle="Agenda e pagamentos têm bases diferentes. Cada moeda tem seu próprio demonstrativo." variant="secondary" />
                {metrics.valuesByCurrency.length ? metrics.valuesByCurrency.map(row => <section key={row.currency} data-service-currency aria-label={`Valores em ${row.currency}`}>
                  <h3>Valores em {row.currency}</h3><dl className="service-overview-ledger">
                    <Amount title="Agendado" kind="scheduled" currency={row.currency} value={row.scheduled} note="Previsão dos compromissos com início no período." />
                    <Amount title="A receber" kind="receivable" currency={row.currency} value={row.receivable} note="Saldo das obrigações da agenda na posição informada acima." />
                    <Amount title="Recebido" kind="received" currency={row.currency} value={row.received} note="Serviços efetivamente pagos no período. Já considera descontos e não inclui taxas adicionais do comprador." />
                    <Amount title="Estornos confirmados" kind="refunds" currency={row.currency} value={row.refunds} note="Devoluções concluídas no período, apresentadas separadamente do recebido." />
                  </dl></section>) : <p className="service-overview-help">{metrics.financialCoverage === "partial"
                    ? "Não foi possível confirmar os valores financeiros deste período. Os dados serão apresentados por moeda quando estiverem confirmados."
                    : "Nenhum valor financeiro registrado neste período. Quando houver obrigações ou pagamentos, os valores serão apresentados por moeda."}</p>}
                <details className="service-overview-explanation"><summary>Como interpretar estes indicadores<ChevronDown size={16} aria-hidden="true" /></summary>
                  <p>A agenda considera os atendimentos com início no período. A ocupação também considera os minutos de atendimentos que começaram antes e se sobrepõem às datas selecionadas.</p>
                  <p>O saldo a receber é uma posição das obrigações da agenda. Recebimentos e estornos seguem suas próprias datas financeiras. Valores pendentes de confirmação não representam um total fechado.</p>
                </details></section>
            </> : null}
  </div>;
}

function Loading() {
  return <div className="service-overview-loading" role="status" aria-label="Carregando indicadores de serviços"><span /><span /><span /><p>Carregando indicadores de serviços…</p></div>;
}
function Agenda({ metrics }: { metrics: ServiceMetricsSummary }) {
  const states = metrics.byStatus, total = states.scheduled + states.in_service + states.completed + states.no_show;
  return <section className="panel service-overview-agenda" aria-label="Agenda no período"><SectionHeader title="Agenda no período" subtitle="Atendimentos com início nas datas selecionadas." variant="secondary" />
    <dl className="service-overview-kpis"><div data-metric="confirmed"><dt>Agendamentos confirmados</dt><dd>{number.format(total)}</dd></div>
      <div data-metric="completed"><dt>Concluídos</dt><dd>{number.format(states.completed)}</dd></div>
      <div data-metric="no-show"><dt>Não compareceram</dt><dd>{number.format(states.no_show)}</dd></div></dl>
    <dl className="service-overview-secondary"><div><dt>Aguardando confirmação</dt><dd>{number.format(states.pending)}</dd></div>
      <div><dt>Agendados</dt><dd>{number.format(states.scheduled)}</dd></div><div><dt>Em atendimento</dt><dd>{number.format(states.in_service)}</dd></div>
      <div><dt>Cancelados</dt><dd>{number.format(states.cancelled)}</dd></div></dl>
  </section>;
}
function Capacity({ value }: { value: ServiceMetricsSummary["occupancy"] }) {
  return <section className="panel service-overview-capacity" data-service-occupancy aria-label="Ocupação da agenda">
    <SectionHeader title="Ocupação da agenda" subtitle="Minutos confirmados em relação à capacidade disponível." variant="secondary" />
    <div className="service-overview-capacity-value"><strong>{value.occupancyRate === null ? "—" : percent.format(value.occupancyRate)}</strong>
      {value.occupancyRate === null && <span>{value.rateStatus === "not_calculable" ? "Não calculável" : "Capacidade não confirmada"}</span>}</div>
    {value.occupancyRate !== null && value.occupancyRate <= 1 && <progress aria-label="Ocupação da agenda" value={value.occupancyRate} max={1} />}
    {value.occupancyRate !== null && value.occupancyRate > 1 && <p className="service-overview-help">A ocupação supera a capacidade registrada. Confira a grade de horários.</p>}
    <dl className="service-overview-secondary"><div><dt>{value.coverage === "partial" ? "Minutos conhecidos disponíveis" : "Minutos disponíveis"}</dt><dd>{number.format(value.knownOfferedMinutes)}</dd></div>
      <div><dt>{value.coverage === "partial" ? "Minutos conhecidos ocupados" : "Minutos ocupados"}</dt><dd>{number.format(value.knownOccupiedMinutes)}</dd></div></dl>
    <p className="service-overview-help">{value.rateStatus === "not_calculable" ? "Não há capacidade disponível registrada neste período."
      : value.coverage === "partial" ? "A capacidade completa ainda não pôde ser confirmada." : "Horários compartilhados são contados uma única vez; bloqueios são descontados."}</p>
  </section>;
}
function Amount({ title, kind, currency, value, note }: { title: string; kind: string; currency: string; value: ServiceMetricsMoney; note: string }) {
  return <div data-financial={kind} data-status={value.status}><dt><span>{title}</span><small>{note}</small></dt>
    <dd>{value.amountCents === null || value.status === "partial" ? <><strong className="service-overview-unconfirmed">Não confirmado</strong>
      {value.knownAmountCents > 0 && <small>Valor conhecido: {money(value.knownAmountCents, currency)}</small>}</> : <strong>{money(value.amountCents, currency)}</strong>}</dd></div>;
}
