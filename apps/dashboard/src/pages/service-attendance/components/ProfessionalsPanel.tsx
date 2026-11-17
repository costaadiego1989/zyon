import React, { useEffect, useId, useRef, useState } from "react";
import { Users } from "lucide-react";
import type { MerchantProfile } from "../../../api-client.js";
import type { ServiceAttendanceErrorKind, ServiceProfessionalDTO } from "../../../api/endpoints/service-attendance.js";
import { createIdempotencyKey } from "../../../api/http/idempotency.js";
import { Button } from "../../../components/Button.js";
import { DataPanel } from "../../../components/DataPanel.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { FormField, FormTextarea } from "../../../components/FormField.js";
import { Modal } from "../../../components/Modal.js";
import { ConfirmDialog } from "../../../components/ConfirmDialog.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { createProfessionalDraft, professionalFormError, professionalFormPayload, type ProfessionalDraft } from "./professional-form.js";
import { useProfessionalsPanelData } from "./useProfessionalsPanelData.js";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
interface Editor { contextKey: string; token: object; idempotencyKey: string; draft: ProfessionalDraft; error: string | null }
interface Deactivation { contextKey: string; token: object; idempotencyKey: string; professional: ServiceProfessionalDTO; error: string | null }
function commandError(kind: ServiceAttendanceErrorKind): string {
  if (kind === "conflict") return "Os dados foram alterados. Seu rascunho foi preservado. Atualize a lista e reabra o profissional para conferir a nova versão.";
  if (kind === "network" || kind === "invalid_response") return "Não foi possível confirmar o resultado. Confira a lista antes de tentar novamente.";
  if (kind === "not_found") return "Não foi possível localizar este profissional. O rascunho foi preservado.";
  if (kind === "forbidden" || kind === "unauthorized") return "Sua permissão para alterar este profissional não está disponível.";
  return "Não foi possível salvar. Confira os dados e tente novamente.";
}
export function ProfessionalsPanel({ me, vm }: { me: MerchantProfile | null; vm: ViewModel }) {
  const data = useProfessionalsPanelData(me, vm);
  const switchId = useId(), reactivateId = switchId + "-reactivate", publishedId = switchId + "-published";
  const [editorState, setEditor] = useState<Editor | null>(null), [deactivationState, setDeactivation] = useState<Deactivation | null>(null);
  const [notice, setNotice] = useState<{ contextKey: string; text: string; error?: boolean } | null>(null);
  const currentKey = useRef(data.contextKey); currentKey.current = data.contextKey;
  const currentEditor = useRef(editorState); currentEditor.current = editorState;
  const currentDeactivation = useRef(deactivationState); currentDeactivation.current = deactivationState;
  const submitting = useRef<{ contextKey: string; token: object } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editor = editorState?.contextKey === data.contextKey ? editorState : null;
  const deactivation = deactivationState?.contextKey === data.contextKey ? deactivationState : null;
  const busy = vm.command.status === "saving" || vm.loadState.status === "loading";
  const panel = useRef<HTMLDivElement>(null), focusAfterDeactivation = useRef<{ contextKey: string; id: string } | null>(null);
  useEffect(() => {
    const pending = focusAfterDeactivation.current;
    if (!pending || deactivation) return;
    focusAfterDeactivation.current = null;
    if (currentKey.current !== pending.contextKey) return;
    const row = Array.from(panel.current?.querySelectorAll<HTMLLIElement>('li[data-professional-id]') ?? []).find(item => item.dataset.professionalId === pending.id);
    (row?.querySelector<HTMLButtonElement>('button') ?? panel.current?.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [deactivation]);

  function openEditor(professional: ServiceProfessionalDTO | null) {
    if (!data.allowed || busy || professional && professional.merchantId !== me?.id) return;
    try {
      setNotice(null); setDeactivation(null);
      setEditor({ contextKey: data.contextKey, token: {}, idempotencyKey: createIdempotencyKey(), draft: createProfessionalDraft(professional), error: null });
      void data.loadCatalog(true);
    } catch { setNotice({ contextKey: data.contextKey, text: "Não foi possível editar o perfil público deste profissional. Atualize a lista e confira os dados.", error: true }); }
  }
  function updateDraft(change: Partial<ProfessionalDraft>) {
    if (!editor || busy || currentKey.current !== editor.contextKey) return;
    const token = editor.token;
    setEditor(previous => previous?.token === token ? { ...previous, draft: { ...previous.draft, ...change }, error: null } : previous);
  }
  function selectService(id: string, checked: boolean) {
    if (!editor || busy || currentKey.current !== editor.contextKey) return;
    const token = editor.token;
    setEditor(previous => {
      if (!previous || previous.token !== token) return previous;
      const current = previous.draft.productIds;
      const productIds = checked ? current.includes(id) ? current : [...current, id] : current.filter(item => item !== id);
      return { ...previous, draft: { ...previous.draft, productIds }, error: null };
    });
  }
  async function save() {
    const active = editor;
    if (!active || !data.allowed || busy || submitting.current?.contextKey === active.contextKey || currentKey.current !== active.contextKey) return;
    const invalid = professionalFormError(active.draft);
    if (invalid) { setEditor(previous => previous?.token === active.token ? { ...previous, error: invalid } : previous); return; }
    const submission = { contextKey: active.contextKey, token: active.token }; submitting.current = submission;
    try {
      const payload = professionalFormPayload(active.draft), options = { idempotencyKey: active.idempotencyKey };
      const result = active.draft.original ? await vm.actions.updateProfessional(active.draft.original.id, { ...payload, expectedVersion: active.draft.original.version }, options)
        : await vm.actions.createProfessional(payload, options);
      if (!mounted.current || currentKey.current !== active.contextKey || currentEditor.current?.token !== active.token) return;
      if (result.status === "success") { setEditor(null); setNotice({ contextKey: active.contextKey, text: "Profissional salvo." }); }
      else if (result.status === "error") setEditor(previous => previous?.token === active.token ? { ...previous, error: commandError(result.kind) } : previous);
    } finally { if (submitting.current === submission) submitting.current = null; }
  }
  async function deactivate() {
    const active = deactivation;
    if (!active || !data.allowed || busy || submitting.current?.contextKey === active.contextKey || currentKey.current !== active.contextKey) return;
    const submission = { contextKey: active.contextKey, token: active.token }; submitting.current = submission;
    try {
      const result = await vm.actions.deactivateProfessional(active.professional.id, active.professional.version, { idempotencyKey: active.idempotencyKey });
      if (!mounted.current || currentKey.current !== active.contextKey || currentDeactivation.current?.token !== active.token) return;
      if (result.status === "success") { focusAfterDeactivation.current = { contextKey: active.contextKey, id: active.professional.id }; setDeactivation(null); setNotice({ contextKey: active.contextKey, text: "Profissional desativado." }); }
      else if (result.status === "error") setDeactivation(previous => previous?.token === active.token ? { ...previous, error: commandError(result.kind) } : previous);
    } finally { if (submitting.current === submission) submitting.current = null; }
  }

  if (!data.allowed) return <EmptyState icon={Users} title="Sem permissão para gerenciar profissionais" description="A administração de profissionais está disponível para administradores de empresas de serviços." />;
  const draft = editor?.draft;
  const knownIds = new Set(data.services.map(service => service.id));
  const offPageIds = draft ? [...new Set([...(draft.original?.services.map(link => link.productId) ?? []), ...draft.productIds])].filter(id => !knownIds.has(id)) : [];
  const choices = [...data.services.map(service => ({ id: service.id, name: service.name, isActive: service.isActive, loaded: true })),
    ...offPageIds.map(id => ({ id, name: `Serviço vinculado (${id})`, isActive: undefined, loaded: false }))];
  return <div ref={panel} style={{ display: "grid", gap: 16, minWidth: 0 }}>
    {notice?.contextKey === data.contextKey && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    <DataPanel title="Profissionais" trailing={<Button disabled={busy} onClick={() => openEditor(null)}>Novo profissional</Button>}
      isEmpty={vm.loadState.status !== "loading" && !data.listError && data.rows.length === 0}
      empty={{ icon: Users, title: "Nenhum profissional cadastrado", description: "Cadastre quem realiza os serviços da empresa." }}>
      {vm.loadState.status === "loading" && !vm.loadState.data ? <p role="status">Carregando profissionais…</p> : data.listError || vm.loadState.status === "error" ?
        <EmptyState icon={Users} title="Não foi possível carregar os profissionais" description="Atualize para conferir os dados da empresa." action={<Button variant="outline" onClick={() => void vm.refresh()}>Atualizar lista</Button>} /> :
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{data.rows.map(row => <li key={row.id} data-professional-id={row.id} style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center", padding: 16, borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ minWidth: 0 }}><strong style={{ overflowWrap: "anywhere" }}>{row.publicName}</strong><p>{row.timeZone}</p><span>{!row.isActive ? "Inativo" : row.isPublished ? "Publicado" : "Não publicado"}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button variant="outline" disabled={busy} aria-label={`Editar ${row.publicName}`} onClick={() => openEditor(row)}>Editar</Button>
            {row.isActive && <Button variant="ghost" disabled={busy} aria-label={`Desativar ${row.publicName}`} onClick={() => {
              setEditor(null); setNotice(null); setDeactivation({ contextKey: data.contextKey, token: {}, idempotencyKey: createIdempotencyKey(), professional: row, error: null });
            }}>Desativar</Button>}</div>
        </li>)}</ul>}
    </DataPanel>
    {data.nextCursor && <Button variant="outline" loading={data.listLoading} onClick={() => void data.loadMoreProfessionals()}>Carregar mais profissionais</Button>}
    <Button variant="ghost" disabled={busy} onClick={() => void vm.refresh()}>Atualizar lista</Button>
    <Modal isOpen={Boolean(editor)} title={draft?.original ? "Editar profissional" : "Novo profissional"} subtitle="Preencha os dados públicos e os serviços realizados." onClose={() => { if (!busy) setEditor(null); }}>
      {draft && <form onSubmit={event => { event.preventDefault(); void save(); }} style={{ display: "grid", gap: 16 }}>
        <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: "grid", gap: 16 }}>
          <FormField label="Nome público" value={draft.publicName} onChange={publicName => updateDraft({ publicName })} maxLength={120} inputProps={{ required: true }} />
          <FormField label="Fuso horário" value={draft.timeZone} onChange={timeZone => updateDraft({ timeZone })} placeholder="America/Sao_Paulo" maxLength={80} hint="Informe o fuso IANA usado para os horários deste profissional." inputProps={{ required: true }} />
          <FormTextarea label="Apresentação pública" value={draft.description} onChange={description => updateDraft({ description })} maxLength={1200} />
          <FormTextarea label="Especialidades" value={draft.specialtiesText} onChange={specialtiesText => updateDraft({ specialtiesText })} hint="Uma especialidade por linha, até 20." />
          {draft.original && !draft.original.isActive && <div style={{ display: "flex", gap: 10, alignItems: "center" }}><ToggleSwitch id={reactivateId} checked={draft.isActive} disabled={busy} onChange={isActive => updateDraft({ isActive })} /><label htmlFor={reactivateId}>Reativar profissional</label></div>}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><ToggleSwitch id={publishedId} disabled={busy || !draft.isActive} checked={draft.isActive && draft.isPublished} onChange={isPublished => updateDraft({ isPublished })} /><label htmlFor={publishedId}>Publicado para clientes</label></div>
          <fieldset style={{ minWidth: 0, margin: 0, padding: 0, border: 0 }}><legend style={{ padding: 0, marginBottom: 8, fontWeight: 600 }}>Serviços realizados</legend>
            {data.catalogPhase === "loading" && <p role="status">Carregando serviços…</p>}
            {data.catalogError && <p role="alert">Não foi possível carregar os serviços.</p>}
            {data.catalogPhase === "ready" && data.services.length === 0 && <p>{data.catalogHasMore ? "Nenhum serviço nesta página. Carregue mais itens do catálogo." : "Nenhum serviço encontrado nas páginas carregadas."}</p>}
            <div style={{ display: "grid", gap: 8 }}>{choices.map((choice, index) => {
              const serviceId = `${switchId}-service-${index}`;
              return <div key={choice.id} style={{ display: "flex", gap: 16, alignItems: "center", minHeight: 44, minWidth: 0, padding: "8px 0", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  <label htmlFor={serviceId} style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--color-text)" }}>Vincular {choice.name}</label>
                  {choice.loaded && !choice.isActive && <small>Inativo</small>}
                  {!choice.loaded && <small>Ainda não carregado. O vínculo será preservado.</small>}
                </div>
                <ToggleSwitch id={serviceId} checked={draft.productIds.includes(choice.id)} disabled={busy} onChange={checked => selectService(choice.id, checked)} />
              </div>;
            })}</div>
            {data.catalogError ? <Button variant="outline" onClick={() => void data.loadCatalog()}>Tentar carregar serviços</Button> : data.catalogHasMore && <Button variant="outline" loading={data.catalogPhase === "loading"} onClick={() => void data.loadCatalog()}>Carregar mais itens do catálogo</Button>}
          </fieldset>
        </fieldset>
        {editor.error && <p role="alert">{editor.error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "end" }}><Button variant="outline" disabled={busy} onClick={() => setEditor(null)}>Cancelar</Button><Button type="submit" loading={busy}>Salvar profissional</Button></div>
      </form>}
    </Modal>
    <ConfirmDialog open={Boolean(deactivation)} title="Desativar profissional?" confirmLabel="Desativar profissional" busy={busy} error={deactivation?.error}
      description="O profissional deixará de aparecer para novos agendamentos. Os agendamentos já confirmados serão mantidos, assim como o histórico de atendimentos."
      onCancel={() => setDeactivation(null)} onConfirm={() => void deactivate()} />
  </div>;
}
