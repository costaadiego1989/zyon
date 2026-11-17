import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, FolderTree } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { ServiceProfessionalAvailabilityDTO } from "../../api/endpoints/service-attendance.js";
import { useApi } from "../../hooks/useApi.js";
import { DataPanel } from "../../components/DataPanel.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Button } from "../../components/Button.js";
import type { ServiceAttendanceFilters, useServiceAttendancePage } from "./useServiceAttendancePage.js";
import { ProfessionalsPanel } from "./components/ProfessionalsPanel.js";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const wallMinute = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
function instant(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

function ProfessionalGrade({ me, professionalId }: { me: MerchantProfile; professionalId: string }) {
  const api = useApi();
  const client = useMemo(() => api.serviceAttendance(me), [api, me.id, me.user_id]);
  const key = JSON.stringify([me.id, me.user_id, professionalId]), current = useRef(key); current.current = key;
  const mounted = useRef(true), sequence = useRef(0), inFlight = useRef<{ key: string } | null>(null);
  const [state, setState] = useState<{ key: string; status: "idle" | "loading" | "ready" | "error"; data: ServiceProfessionalAvailabilityDTO | null; error?: string }>({ key: "", status: "idle", data: null });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  const visible = state.key === key ? state : { key, status: "idle" as const, data: null };
  async function read(cursor?: string) {
    if (!professionalId || !mounted.current || current.current !== key || inFlight.current?.key === key) return;
    const token = { key }, generation = ++sequence.current; inFlight.current = token;
    const previous = cursor ? visible.data : null;
    setState({ key, status: "loading", data: previous });
    try {
      const result = await client.getProfessionalAvailability(professionalId, cursor ? { cursor } : {});
      if (!mounted.current || current.current !== key || sequence.current !== generation) return;
      if (result.professionalId !== professionalId || previous && (result.version !== previous.version || result.timeZone !== previous.timeZone)) throw new Error("professional_grade_changed");
      const seen = new Set<string>();
      const exceptions = [...(previous?.exceptions ?? []), ...result.exceptions].filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
      setState({ key, status: "ready", data: { ...result, exceptions } });
    } catch {
      if (mounted.current && current.current === key && sequence.current === generation) setState({ key, status: "error", data: previous, error: "Não foi possível consultar a grade. Consulte novamente para conferir os dados atuais." });
    } finally { if (inFlight.current === token) inFlight.current = null; }
  }
  return <DataPanel title="Grade cadastrada" trailing={<Button variant="outline" disabled={!professionalId} loading={visible.status === "loading"} onClick={() => void read()}>Consultar grade</Button>}>
    <div style={{ padding: 20, display: "grid", gap: 16 }}>
      {!professionalId ? <p>Selecione um profissional para consultar a grade e as exceções cadastradas.</p> : visible.status === "idle" ? <p>Consulte a grade do profissional selecionado.</p> : null}
      {visible.status === "loading" && <p role="status">Consultando grade…</p>}
      {visible.status === "error" && <p role="alert">{visible.error}</p>}
      {visible.data && <>
        <p>Fuso do profissional: {visible.data.timeZone}</p>
        {visible.data.rows.length === 0 && visible.data.exceptions.length === 0 ? <EmptyState icon={CalendarDays} title="Nenhum horário cadastrado" description="A consulta não retornou grade ou exceções para este profissional." /> : <>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>{visible.data.rows.map(row => <li key={row.id}>{weekdays[row.weekday]} · {wallMinute(row.startMinute)}–{wallMinute(row.endMinute)} · {row.timeZone}</li>)}</ul>
          {visible.data.exceptions.length > 0 && <div><h3>Exceções cadastradas</h3><ul style={{ paddingInlineStart: 20 }}>{visible.data.exceptions.map(row => <li key={row.id}>{row.kind === "block" ? "Bloqueio" : "Horário avulso"} · <time dateTime={row.startsAt}>{instant(row.startsAt, row.timeZone)}</time>–<time dateTime={row.endsAt}>{instant(row.endsAt, row.timeZone)}</time> · {row.timeZone}</li>)}</ul></div>}
        </>}
        {visible.data.nextCursor && <Button variant="outline" loading={visible.status === "loading"} onClick={() => void read(visible.data!.nextCursor!)}>Carregar mais exceções</Button>}
      </>}
    </div>
  </DataPanel>;
}

/** Read-only composition of implemented administrative contracts. Booking,
 * financial operations and the later editing panels retain their own tasks. */
export function ServiceAttendancePanels({ tab, vm, me }: { tab: ServiceAttendanceFilters["tab"]; vm: ViewModel; me: MerchantProfile }) {
  const data = vm.loadState.data;
  if (!data) return null;
  if (tab === "agenda") return <DataPanel title="Consulta da agenda"><div style={{ padding: 20, display: "grid", gap: 12 }}><p>Escolha um profissional e consulte a grade e as exceções cadastradas.</p><Button variant="outline" onClick={() => vm.setFilters({ tab: "availability" })}>Consultar grade cadastrada</Button></div></DataPanel>;
  if (tab === "professionals") return <ProfessionalsPanel me={me} vm={vm} />;
  if (tab === "categories") return <DataPanel title="Categorias" isEmpty={data.categories.length === 0} empty={{ icon: FolderTree, title: "Nenhuma categoria cadastrada", description: "As categorias cadastradas aparecerão nesta lista." }}>
    <ul style={{ listStyle: "none", margin: 0, padding: 20, display: "grid", gap: 16 }}>{data.categories.map(row => <li key={row.id}><strong style={{ overflowWrap: "anywhere" }}>{row.name}</strong><p>{row.is_active ? "Ativa" : "Inativa"}</p><span>Ofertas vinculadas: {row.product_count}</span></li>)}</ul>
  </DataPanel>;
  if (tab === "availability") return <ProfessionalGrade me={me} professionalId={vm.filters.professionalId} />;
  return <DataPanel title="Política de agendamento"><div style={{ padding: 20 }}>
    {data.policy.status !== "configured" ? <p>{data.policy.status === "invalid" ? "A política cadastrada precisa de revisão." : "A política de agendamento ainda não foi configurada."}</p> : <dl>
      <dt>Forma de pagamento</dt><dd>{data.policy.policy.paymentMode === "online" ? "Pagamento on-line" : "Pagamento no atendimento"}</dd>
      <dt>Reserva temporária</dt><dd>{data.policy.policy.holdEnabled ? `${data.policy.policy.holdMinutes} minutos` : "Desativada"}</dd>
      <dt>Admissão</dt><dd>Novos agendamentos: {data.policy.policy.admissionsEnabled ? "ativados" : "desativados"}</dd>
    </dl>}
  </div></DataPanel>;
}
