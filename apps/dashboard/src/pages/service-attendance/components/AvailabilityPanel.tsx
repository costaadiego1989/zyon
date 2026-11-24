import React, { useEffect, useId, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { MerchantProfile } from "../../../api-client.js";
import type { ServiceAvailabilityExceptionDTO, ServiceAttendanceErrorKind } from "../../../api/endpoints/service-attendance.js";
import { createIdempotencyKey } from "../../../api/http/idempotency.js";
import { Button } from "../../../components/Button.js";
import { DataPanel } from "../../../components/DataPanel.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { FormField, FormSelect, FormTextarea } from "../../../components/FormField.js";
import { ConfirmDialog } from "../../../components/ConfirmDialog.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { useAvailabilityPanelData } from "./useAvailabilityPanelData.js";
import { availabilityInstantWall, formatAvailabilityInstant, availabilityExceptionPayload, createRecurringAvailabilityDraft, recurringAvailabilityPayload, deactivateAvailabilityExceptionPayload, type RecurringAvailabilityDraft, type AvailabilityExceptionDraft } from "./availability-form.js";
import { FIXED_SERVICE_UI_TIME_ZONE, requiresNewBrasiliaGrade, newBrasiliaRecurringDraft, canEditBrasiliaException } from "./fixed-service-time-zone.js";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
interface Editor { context: object; token: object; key: string; version: number; recurring?: RecurringAvailabilityDraft; newBrasilia?: boolean; exception?: AvailabilityExceptionDraft; original?: ServiceAvailabilityExceptionDTO; error: string | null }
interface Removal { context: object; token: object; key: string; version: number; row: ServiceAvailabilityExceptionDTO; error: string | null }
interface GradeWithdrawal { context: object; token: object; key: string; version: number; timeZone: string; error: string | null }
const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const wallMinute = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
function errorText(kind: ServiceAttendanceErrorKind): string {
  if (kind === "conflict") return "A agenda mudou ou o intervalo conflita com uma indisponibilidade. Nenhum agendamento foi cancelado. Recarregue e revise antes de salvar.";
  if (kind === "network" || kind === "server" || kind === "invalid_response") return "Não foi possível confirmar o resultado. Recarregue a grade antes de tentar novamente.";
  if (kind === "forbidden" || kind === "unauthorized") return "Sua permissão para alterar os horários não está disponível.";
  return "Não foi possível salvar. Confira os dados informados.";
}
export function AvailabilityPanel({ me, vm }: { me: MerchantProfile | null; vm: ViewModel }) {
  const data = useAvailabilityPanelData(me, vm), prefix = useId();
  const [editorState, setEditor] = useState<Editor | null>(null), [removalState, setRemoval] = useState<Removal | null>(null);
  const [withdrawalState, setWithdrawal] = useState<GradeWithdrawal | null>(null);
  const [notice, setNotice] = useState<{ context: object; text: string; error?: boolean } | null>(null), [blocked, setBlocked] = useState<object | null>(null), [pending, setPending] = useState<object | null>(null);
  const [previewChoice, setPreviewChoice] = useState<{ context: object; productId: string; variantId: string } | null>(null);
  const [previewQuery, setPreviewQuery] = useState<{ context: object; productId: string; variantId: string } | null>(null);
  const current = useRef(data.context); current.current = data.context;
  const mounted = useRef(true), submitting = useRef<{ context: object; token: object } | null>(null), feedback = useRef<HTMLParagraphElement>(null);
  const editor = editorState?.context === data.context ? editorState : null, removal = removalState?.context === data.context ? removalState : null;
  const withdrawal = withdrawalState?.context === data.context ? withdrawalState : null;
  const busy = pending === data.context || data.grade.status === "loading" || vm.command.status === "saving" || vm.loadState.status === "loading";
  const fenced = blocked === data.context || vm.command.status === "conflict" || vm.command.status === "uncertain";
  const editable = data.canEdit && !busy && !fenced;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (notice?.context === data.context) feedback.current?.focus(); }, [notice, data.context]);
  const stillCurrent = (scope: object) => mounted.current && current.current === scope;
  const say = (scope: object, text: string, error = false) => setNotice({ context: scope, text, error });
  function openRecurring() {
    if (!editable || !data.context || !data.grade.value) return;
    const historical = requiresNewBrasiliaGrade(data.grade.value);
    setNotice(null); setRemoval(null); setWithdrawal(null); setEditor({ context: data.context, token: {}, key: createIdempotencyKey(), version: data.grade.value.version,
      recurring: historical ? newBrasiliaRecurringDraft() : createRecurringAvailabilityDraft(FIXED_SERVICE_UI_TIME_ZONE, data.grade.value.rows), newBrasilia: historical, error: null });
  }
  function openException(kind: "one_off" | "block", original?: ServiceAvailabilityExceptionDTO) {
    if (!editable || !data.context || !data.grade.value) return;
    if (original && !canEditBrasiliaException(original)) return;
    const timeZone = FIXED_SERVICE_UI_TIME_ZONE;
    try {
      setNotice(null); setRemoval(null); setWithdrawal(null); setEditor({ context: data.context, token: {}, key: createIdempotencyKey(), version: data.grade.value.version, original, exception: { kind, startsAt: original ? availabilityInstantWall(original.startsAt, timeZone) : "", endsAt: original ? availabilityInstantWall(original.endsAt, timeZone) : "", timeZone, reason: original?.reason ?? "" }, error: null });
    } catch { say(data.context, "Não foi possível abrir esta exceção. Recarregue para conferir o intervalo original.", true); }
  }
  function changeRecurring(change: Partial<RecurringAvailabilityDraft>) {
    if (!editor?.recurring || busy || fenced) return; const token = editor.token;
    setEditor(previous => previous?.token === token && previous.recurring ? { ...previous, recurring: { ...previous.recurring, ...change }, error: null } : previous);
  }
  function changeException(change: Partial<AvailabilityExceptionDraft>) {
    if (!editor?.exception || busy || fenced) return; const token = editor.token;
    setEditor(previous => previous?.token === token && previous.exception ? { ...previous, exception: { ...previous.exception, ...change }, error: null } : previous);
  }
  async function save() {
    const active = editor;
    if (!active || !editable || !data.professional || submitting.current?.context === active.context) return;
    if (active.newBrasilia && !active.recurring?.rows.length) {
      setEditor(previous => previous?.token === active.token ? { ...previous, error: "Adicione ao menos uma faixa para criar a nova grade em Brasília. Para retirar a grade existente, use a ação de retirada." } : previous); return;
    }
    submitting.current = { context: active.context, token: active.token }; setPending(active.context); setPreviewQuery(null);
    try {
      const result = active.recurring ? await vm.actions.saveProfessionalAvailability(data.professional.id, recurringAvailabilityPayload(active.recurring, active.version), { idempotencyKey: active.key })
        : active.original ? await vm.actions.updateAvailabilityException(data.professional.id, active.original.id, availabilityExceptionPayload(active.exception!, active.version), { idempotencyKey: active.key })
        : await vm.actions.createAvailabilityException(data.professional.id, availabilityExceptionPayload(active.exception!, active.version), { idempotencyKey: active.key });
      if (!stillCurrent(active.context)) return;
      if (result.status === "success") {
        const read = await data.read(result.value.version); if (!stillCurrent(active.context)) return;
        if (!read) { setRemoval(null); setBlocked(active.context); say(active.context, "A alteração foi recebida, mas a grade não pôde ser conferida. Recarregue para continuar.", true); return; }
        setEditor(null); say(active.context, active.recurring ? "Grade salva." : "Exceção salva.");
      } else if (result.status === "error") {
        if (["conflict", "network", "server", "invalid_response"].includes(result.kind)) setBlocked(active.context);
        setEditor(previous => previous?.token === active.token ? { ...previous, error: errorText(result.kind) } : previous);
      }
    } catch { if (stillCurrent(active.context)) setEditor(previous => previous?.token === active.token ? { ...previous, error: "Confira datas e horários. Use intervalos válidos sem sobreposição e duração em minutos inteiros." } : previous); }
    finally { if (submitting.current?.token === active.token) { submitting.current = null; if (stillCurrent(active.context)) setPending(null); } }
  }
  async function remove() {
    const active = removal;
    if (!active || !editable || !data.professional || submitting.current?.context === active.context) return;
    submitting.current = { context: active.context, token: active.token }; setPending(active.context); setPreviewQuery(null);
    try {
      const result = await vm.actions.updateAvailabilityException(data.professional.id, active.row.id, deactivateAvailabilityExceptionPayload(active.row, active.version), { idempotencyKey: active.key });
      if (!stillCurrent(active.context)) return;
      if (result.status === "success") {
        const read = await data.read(result.value.version); if (!stillCurrent(active.context)) return;
        if (!read) { setRemoval(null); setBlocked(active.context); say(active.context, "A alteração foi recebida, mas a grade não pôde ser conferida. Recarregue para continuar.", true); return; }
        setRemoval(null); say(active.context, "Exceção desativada.");
      } else if (result.status === "error") { setBlocked(active.context); setRemoval(null); say(active.context, errorText(result.kind), true); }
    } finally { if (submitting.current?.token === active.token) { submitting.current = null; if (stillCurrent(active.context)) setPending(null); } }
  }
  async function withdrawRecurring() {
    const active = withdrawal;
    if (!active || !editable || !data.professional || submitting.current?.context === active.context) return;
    submitting.current = { context: active.context, token: active.token }; setPending(active.context); setPreviewQuery(null);
    try {
      const result = await vm.actions.saveProfessionalAvailability(data.professional.id, { expectedVersion: active.version, timeZone: active.timeZone, rows: [] }, { idempotencyKey: active.key });
      if (!stillCurrent(active.context)) return;
      if (result.status === "success") {
        const read = await data.read(result.value.version); if (!stillCurrent(active.context)) return;
        if (!read) { setWithdrawal(null); setBlocked(active.context); say(active.context, "A retirada foi recebida, mas a grade não pôde ser conferida. Recarregue para continuar.", true); return; }
        setWithdrawal(null); say(active.context, "Grade recorrente retirada. Agendamentos confirmados e histórico preservados.");
      } else if (result.status === "error") { setBlocked(active.context); setWithdrawal(null); say(active.context, errorText(result.kind), true); }
    } finally { if (submitting.current?.token === active.token) { submitting.current = null; if (stillCurrent(active.context)) setPending(null); } }
  }
  async function reconcile() {
    const scope = data.context;
    if (!scope || busy || submitting.current?.context === scope) return;
    const token = {}; submitting.current = { context: scope, token }; setPending(scope); setPreviewQuery(null);
    try {
      const result = await vm.reconcileAvailability(data.read);
      if (!stillCurrent(scope)) return;
      if (!result) { say(scope, "Não foi possível conferir a grade. As alterações continuam bloqueadas; tente recarregar novamente.", true); return; }
      setEditor(null); setRemoval(null); setWithdrawal(null); setBlocked(null); say(scope, "Grade atualizada. Reabra a edição para revisar os valores antes de salvar.");
    } finally { if (submitting.current?.token === token) { submitting.current = null; if (stillCurrent(scope)) setPending(null); } }
  }
  if (!data.allowed) return <EmptyState icon={CalendarDays} title="Sem permissão para gerenciar horários" description="A gestão dos horários exige uma empresa de serviços e permissão de administração." />;
  const grade = data.grade.value, draft = editor?.recurring;
  const choices = data.professionals.services.filter(product => product.isActive && data.professional?.services.some(link => link.productId === product.id))
    .flatMap(product => product.variants.filter(variant => variant.isActive).map(variant => ({ productId: product.id, variantId: variant.id, label: `${product.name} · ${variant.sku}` })));
  const choice = previewChoice?.context === data.context ? choices.find(item => item.productId === previewChoice.productId && item.variantId === previewChoice.variantId) : undefined;
  const preview = previewQuery?.context === data.context && choice?.productId === previewQuery.productId && choice?.variantId === previewQuery.variantId ? vm.availability : { status: "idle" as const, data: null };
  function previewDates() {
    if (!data.context || !choice) return;
    setPreviewQuery({ context: data.context, productId: choice.productId, variantId: choice.variantId });
    void vm.loadAvailableDates({ productId: choice.productId, variantId: choice.variantId });
  }
  return <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
    {notice?.context === data.context && <p ref={feedback} tabIndex={-1} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    <FormSelect label="Profissional da agenda" value={vm.filters.professionalId} onChange={professionalId => vm.setFilters({ professionalId })} disabled={busy}
      options={[{ value: "", label: "Selecione um profissional" }, ...data.professionals.rows.map(row => ({ value: row.id, label: row.publicName + (row.isActive ? "" : " · Inativo") }))]} />
    {data.professionals.nextCursor && <Button variant="outline" loading={data.professionals.listLoading} onClick={() => void data.professionals.loadMoreProfessionals()}>Carregar mais profissionais</Button>}
    {data.professionals.listError && <p role="alert">Não foi possível carregar todos os profissionais. Atualize antes de escolher.</p>}
    <DataPanel title="Grade cadastrada" trailing={<Button variant="outline" disabled={!data.professional || busy || fenced} onClick={() => void data.read()}>Consultar grade</Button>}>
      <div style={{ display: "grid", gap: 16, padding: 20, minWidth: 0 }}>
        {!data.professional && <p>Selecione um profissional carregado para consultar a grade e as exceções.</p>}
        {data.professional && data.grade.status === "idle" && <p>Consulte a grade do profissional selecionado.</p>}
        {data.grade.status === "loading" && <p role="status">Consultando grade…</p>}
        {data.grade.status === "error" && <p role="alert">Não foi possível consultar a grade. O resultado não representa uma agenda vazia. Recarregue para continuar.</p>}
        {grade && <><p>Fuso do profissional: {grade.timeZone}</p>
          {grade.rows.length === 0 && grade.exceptions.length === 0 && <EmptyState icon={CalendarDays} title="Nenhum horário cadastrado" description="A consulta não retornou grade ou exceções para este profissional." />}{grade.rows.length ? <ul>{grade.rows.map(row => <li key={row.id}>{days[row.weekday]} · {wallMinute(row.startMinute)}–{wallMinute(row.endMinute)} · {row.timeZone}</li>)}</ul> : <p>Nenhuma faixa recorrente cadastrada.</p>}
          {grade.exceptions.length > 0 && <div><h3>Exceções cadastradas</h3><ul style={{ paddingInlineStart: 20 }}>{grade.exceptions.map((row, index) => <li key={row.id} style={{ paddingBlock: 12, overflowWrap: "anywhere" }}>
            <p>{row.kind === "block" ? "Bloqueio" : "Horário avulso"} · {formatAvailabilityInstant(row.startsAt, row.timeZone)}–{formatAvailabilityInstant(row.endsAt, row.timeZone)} · {row.timeZone}</p>
            {!canEditBrasiliaException(row) && <p>Intervalo registrado preservado. Para mudar a oferta, desative esta exceção e cadastre um novo intervalo em Brasília.</p>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><Button variant="outline" disabled={!editable || !canEditBrasiliaException(row)} aria-label={`Editar ${row.kind === "block" ? "bloqueio" : "horário avulso"} ${index + 1}`} onClick={() => openException(row.kind, row)}>Editar exceção</Button>
              <Button variant="ghost" disabled={!editable} aria-label={`Desativar ${row.kind === "block" ? "bloqueio" : "horário avulso"} ${index + 1}`} onClick={() => { if (!data.context) return; setEditor(null); setWithdrawal(null); setRemoval({ context: data.context, token: {}, key: createIdempotencyKey(), version: grade.version, row, error: null }); }}>Desativar exceção</Button></div>
          </li>)}</ul></div>}
        </>}
        {data.professional && !data.professional.isActive && <p>Este profissional está inativo. A grade pode ser consultada; alterações estão bloqueadas.</p>}
        {grade && requiresNewBrasiliaGrade(grade) && <p>Os horários registrados mantêm seu fuso original. Para publicar uma nova grade em Brasília, informe novas faixas; os horários antigos não serão copiados nem convertidos.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><Button disabled={!editable} onClick={openRecurring}>{grade && requiresNewBrasiliaGrade(grade) ? "Criar grade em Brasília" : "Editar grade"}</Button>
          {Boolean(grade?.rows.length) && <Button variant="ghost" disabled={!editable} onClick={() => { if (!data.context || !grade) return; setEditor(null); setRemoval(null); setNotice(null); setWithdrawal({ context: data.context, token: {}, key: createIdempotencyKey(), version: grade.version, timeZone: grade.timeZone, error: null }); }}>Retirar grade recorrente</Button>}
          <Button variant="outline" disabled={!editable} onClick={() => openException("one_off")}>Novo horário avulso</Button><Button variant="outline" disabled={!editable} onClick={() => openException("block")}>Novo bloqueio</Button></div>
        {fenced || data.grade.status === "error" ? <Button variant="outline" disabled={busy || !data.professional} onClick={() => void reconcile()}>Recarregar e revisar</Button> : null}
      </div>
    </DataPanel>
    {editor && <DataPanel title={draft ? "Editar grade" : editor.original ? "Editar exceção" : "Nova exceção"}><form onSubmit={event => { event.preventDefault(); void save(); }} style={{ padding: 20, display: "grid", gap: 16 }}>
      <fieldset disabled={busy || fenced} style={{ padding: 0, margin: 0, border: 0, minWidth: 0, display: "grid", gap: 16 }}>
        {draft ? <>
          <p><strong>Horário de Brasília</strong>. {editor.newBrasilia ? "Informe novas faixas. A grade histórica permanece preservada até a confirmação pelo servidor." : "Os horários e a validade das faixas cadastradas serão conferidos pelo servidor."}</p>
          {draft.rows.map((row, index) => <fieldset key={index} style={{ border: "1px solid var(--color-border)", padding: 14, margin: 0, borderRadius: 10, minWidth: 0 }}><legend>Faixa {index + 1}</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12 }}>
              <FormSelect label={`Dia da faixa ${index + 1}`} value={String(row.weekday)} onChange={weekday => changeRecurring({ rows: draft.rows.map((item, i) => i === index ? { ...item, weekday: Number(weekday) } : item) })} options={days.map((label, value) => ({ value: String(value), label }))} />
              <FormField label={`Início da faixa ${index + 1}`} value={row.startTime} onChange={startTime => changeRecurring({ rows: draft.rows.map((item, i) => i === index ? { ...item, startTime } : item) })} placeholder="09:00" />
              <FormField label={`Fim da faixa ${index + 1}`} value={row.endTime} onChange={endTime => changeRecurring({ rows: draft.rows.map((item, i) => i === index ? { ...item, endTime } : item) })} placeholder="18:00 ou 24:00" />
            </div>
            {(row.validFrom || row.validUntil) && <p>Validade existente preservada: {row.validFrom ?? "sem início"} até {row.validUntil ?? "sem fim"}.</p>}
            <Button variant="ghost" aria-label={`Remover faixa ${index + 1}`} onClick={() => changeRecurring({ rows: draft.rows.filter((_, i) => i !== index) })}>Remover faixa</Button>
          </fieldset>)}
          <Button variant="outline" disabled={draft.rows.length >= 100} onClick={() => changeRecurring({ rows: [...draft.rows, { weekday: 1, startTime: "", endTime: "" }] })}>Adicionar faixa</Button>
          {!draft.rows.length && <p>Ao salvar sem faixas recorrentes, apenas horários avulsos ativos poderão oferecer capacidade. Agendamentos confirmados e histórico são preservados.</p>}
        </> : editor.exception && <>
          <p>{editor.exception.kind === "block" ? "Bloqueio de indisponibilidade" : "Horário avulso"} · Horário de Brasília. O servidor verifica conflitos; esta edição não cancela agendamentos.</p>
          <label htmlFor={prefix + "-starts"}>Início da exceção<input id={prefix + "-starts"} className="form-input" type="datetime-local" value={editor.exception.startsAt} onChange={event => changeException({ startsAt: event.target.value })} required /></label>
          <label htmlFor={prefix + "-ends"}>Fim da exceção<input id={prefix + "-ends"} className="form-input" type="datetime-local" value={editor.exception.endsAt} onChange={event => changeException({ endsAt: event.target.value })} required /></label>
          <FormTextarea label="Motivo da exceção" value={editor.exception.reason} onChange={reason => changeException({ reason })} maxLength={1200} />
        </>}
      </fieldset>
      {editor.error && <p role="alert">{editor.error}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Button type="submit" disabled={busy || fenced} loading={busy}>{draft ? "Salvar grade" : "Salvar exceção"}</Button><Button variant="ghost" disabled={busy} onClick={() => setEditor(null)}>Fechar edição</Button></div>
    </form></DataPanel>}
    <DataPanel title="Preview da disponibilidade"><div style={{ display: "grid", gap: 14, padding: 20 }}>
      <p>Consulte as datas e os horários que o servidor oferece para um serviço vinculado. Este preview não cria uma reserva.</p>
      <Button variant="outline" disabled={!data.professional || busy} loading={data.professionals.catalogPhase === "loading"} onClick={() => void data.professionals.loadCatalog(true)}>Consultar serviços vinculados</Button>
      {data.professionals.catalogError && <p role="alert">Não foi possível consultar os serviços. Consulte novamente antes de escolher.</p>}
      {data.professionals.catalogHasMore && <Button variant="outline" onClick={() => void data.professionals.loadCatalog()}>Carregar mais itens do catálogo</Button>}
      <select className="form-input" aria-label="Oferta para preview" value={choice?.variantId ?? ""} onChange={event => { const next = choices.find(item => item.variantId === event.target.value); setPreviewQuery(null); setPreviewChoice(data.context && next ? { context: data.context, productId: next.productId, variantId: next.variantId } : null); }}><option value="">Selecione serviço e variação</option>{choices.map(item => <option key={item.variantId} value={item.variantId}>{item.label}</option>)}</select>
      <Button variant="outline" disabled={!choice || busy} onClick={previewDates}>Consultar datas disponíveis</Button>
      {preview.status === "loading" && <p role="status">Consultando disponibilidade…</p>}
      {preview.status === "error" && <p role="alert">Não foi possível consultar a disponibilidade. Confira o período e consulte novamente.</p>}
      {preview.status === "empty" && <p>Nenhum horário disponível no período consultado.</p>}
      {preview.status === "stale" && <p role="alert">A disponibilidade mudou. Consulte novamente antes de escolher.</p>}
      {preview.status === "ready" && preview.data && <>
        <p>{preview.data.timeZone} · {preview.data.durationMinutes} min · Consulta em {preview.data.asOf}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{preview.data.dates.map(date => <Button key={date} variant="outline" onClick={() => { if (choice) void vm.loadAvailableSlots({ productId: choice.productId, variantId: choice.variantId }, date); }}>{date.split("-").reverse().join("/")}</Button>)}</div>
        {"slots" in preview.data && <ul>{preview.data.slots.map(slot => <li key={slot.startsAt}>{slot.date.split("-").reverse().join("/")} · {slot.startTime} · {slot.durationMinutes} min · {slot.timeZone}</li>)}</ul>}
      </>}
    </div></DataPanel>
    <ConfirmDialog open={Boolean(removal)} title="Desativar exceção?" description="O intervalo deixará de ser aplicado à oferta de novos horários. Os agendamentos já confirmados e o histórico serão mantidos." confirmLabel="Confirmar desativação" busy={busy} error={removal?.error} onCancel={() => { if (!busy) setRemoval(null); }} onConfirm={() => void remove()} />
    <ConfirmDialog open={Boolean(withdrawal)} title="Retirar grade recorrente?" description="As faixas recorrentes deixarão de oferecer novos horários. Os agendamentos confirmados, os horários avulsos e o histórico serão preservados." confirmLabel="Confirmar retirada" busy={busy} error={withdrawal?.error} onCancel={() => { if (!busy) setWithdrawal(null); }} onConfirm={() => void withdrawRecurring()} />
  </div>;
}
